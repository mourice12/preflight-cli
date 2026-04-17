#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'node:path';
import {
  loadWorkflows,
  getAllChecks,
  CHECK_NAMES,
  createOctokit,
  buildRepoContext,
  getGhToken,
  getRepoInfo,
  diagnoseToString,
  type CheckResult,
} from 'preflight-ci';

const VERSION = '0.1.0';

interface ScanMeta {
  workflowCount: number;
  note?: string;
}

function summarize(results: CheckResult[], meta: ScanMeta) {
  const counts = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const r of results) counts[r.severity]++;
  return { ...meta, ...counts, total: results.length };
}

function formatResults(
  results: CheckResult[],
  meta: ScanMeta,
  format: 'json' | 'text',
): string {
  const summary = summarize(results, meta);

  if (format === 'json') {
    return JSON.stringify({ summary, results }, null, 2);
  }

  const lines: string[] = [];
  lines.push(
    `Workflow files: ${meta.workflowCount} · Errors: ${summary.error} · Warnings: ${summary.warning} · Info: ${summary.info}`,
  );
  if (meta.note) lines.push(meta.note);
  lines.push('');
  for (const r of results) {
    const ctxParts: string[] = [];
    if (r.job) ctxParts.push(`job: ${r.job}`);
    if (r.step) ctxParts.push(`step: ${r.step}`);
    if (r.line) ctxParts.push(`line ${r.line}`);
    const ctx = ctxParts.length ? ` (${ctxParts.join(', ')})` : '';
    const loc = r.file ? ` [${r.file}]` : '';
    lines.push(`[${r.severity}] [${r.check}] ${r.message}${loc}${ctx}`);
    if (r.fix) {
      for (const fixLine of r.fix.split('\n')) lines.push(`    Fix: ${fixLine}`);
    }
  }
  return lines.join('\n');
}

async function runScan(args: {
  path?: string;
  checks?: string[];
  format?: 'json' | 'text';
}): Promise<string> {
  const cwd = path.resolve(args.path ?? process.cwd());
  const format = args.format ?? 'json';

  const repoInfo = getRepoInfo(cwd);
  const token = getGhToken();
  const workflows = await loadWorkflows(cwd);

  if (workflows.length === 0) {
    return formatResults([], { workflowCount: 0, note: 'No workflow files found.' }, format);
  }

  const { octokit, context } = await buildRepoContext(repoInfo.owner, repoInfo.repo, token);

  let checks = getAllChecks(octokit);
  if (args.checks?.length) {
    const wanted = new Set(args.checks);
    const invalid = [...wanted].filter((n) => !(CHECK_NAMES as readonly string[]).includes(n));
    if (invalid.length) {
      throw new Error(
        `Unknown check(s): ${invalid.join(', ')}. Valid: ${CHECK_NAMES.join(', ')}`,
      );
    }
    checks = checks.filter((c) => wanted.has(c.name));
  }

  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      results.push(...(await check.run({ workflows, repo: context })));
    } catch (err) {
      results.push({
        check: check.name,
        severity: 'error',
        message: `Check "${check.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return formatResults(results, { workflowCount: workflows.length }, format);
}

async function runCheckWorkflow(args: { file: string; path?: string }): Promise<string> {
  const cwd = path.resolve(args.path ?? process.cwd());
  const targetAbs = path.isAbsolute(args.file) ? args.file : path.resolve(cwd, args.file);

  const repoInfo = getRepoInfo(cwd);
  const token = getGhToken();
  const workflows = await loadWorkflows(cwd);
  const matched = workflows.find((w) => path.resolve(w.path) === targetAbs);
  if (!matched) {
    throw new Error(
      `Workflow file "${args.file}" not found. Available workflows: ` +
        (workflows.map((w) => w.relativePath).join(', ') || '(none)'),
    );
  }

  const { octokit, context } = await buildRepoContext(repoInfo.owner, repoInfo.repo, token);

  const results: CheckResult[] = [];
  for (const check of getAllChecks(octokit)) {
    try {
      const r = await check.run({ workflows, repo: context });
      for (const x of r) {
        if (!x.file || x.file === matched.relativePath) results.push(x);
      }
    } catch (err) {
      results.push({
        check: check.name,
        severity: 'error',
        message: `Check "${check.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        file: matched.relativePath,
      });
    }
  }

  return formatResults(
    results,
    { workflowCount: 1, note: `Scoped to ${matched.relativePath}.` },
    'json',
  );
}

async function runDiagnose(args: { runId?: number; path?: string }): Promise<string> {
  const cwd = path.resolve(args.path ?? process.cwd());
  return diagnoseToString({ cwd, runId: args.runId });
}

async function main(): Promise<void> {
  const server = new McpServer({ name: 'preflight', version: VERSION });

  server.registerTool(
    'preflight_scan',
    {
      title: 'Preflight: scan workflows',
      description:
        'Run preflight checks on a GitHub Actions workflow repo. Validates secrets, variables, environments, action refs, permissions, expressions, runners, job graphs, and YAML syntax against the live GitHub repo config. Requires gh CLI auth or GITHUB_TOKEN/GH_TOKEN in the server process env.',
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            "Absolute path to the repo. Defaults to the MCP server's working directory (usually the repo you're working in).",
          ),
        checks: z
          .array(z.enum(CHECK_NAMES as unknown as [string, ...string[]]))
          .optional()
          .describe(
            'Subset of check names to run. Omit to run all. Slow checks: "actions" hits the GitHub API per action ref.',
          ),
        format: z
          .enum(['json', 'text'])
          .optional()
          .describe('Output format. "json" (default) is recommended for programmatic consumption.'),
      },
    },
    async (args) => {
      try {
        const text = await runScan(args);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'preflight_check_workflow',
    {
      title: 'Preflight: check a single workflow file',
      description:
        'Run preflight against the whole repo, then return only the results for the specified workflow file. Cross-file checks (circular needs, etc.) naturally drop out since they never reference a single file.',
      inputSchema: {
        file: z
          .string()
          .describe(
            'Path to the workflow YAML file. Absolute, or relative to the repo root (e.g. ".github/workflows/ci.yml").',
          ),
        path: z
          .string()
          .optional()
          .describe("Absolute path to the repo. Defaults to the MCP server's working directory."),
      },
    },
    async (args) => {
      try {
        const text = await runCheckWorkflow(args);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'preflight_diagnose',
    {
      title: 'Preflight: AI-powered failure diagnosis',
      description:
        "Diagnose a failed GitHub Actions run using Claude Sonnet. Fetches the run's workflow YAML + failed-job logs, sends them to Claude, returns a ROOT CAUSE / DIAGNOSIS / FIX breakdown. Requires ANTHROPIC_API_KEY in the server process env (plus gh CLI auth or GITHUB_TOKEN for the run data).",
      inputSchema: {
        runId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Specific workflow run ID to diagnose. Omit to diagnose the most recent failed run on the current branch.',
          ),
        path: z
          .string()
          .optional()
          .describe("Absolute path to the repo. Defaults to the MCP server's working directory."),
      },
    },
    async (args) => {
      try {
        const text = await runDiagnose(args);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(
    `mcp-preflight fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
