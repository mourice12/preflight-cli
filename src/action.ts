// GitHub Action entry point — free tier only.
//
// IMPORTANT: this file must NEVER import `./diagnose`, `./lib`, or anything
// that transitively loads `@anthropic-ai/sdk`. The bundled dist/action.js ships
// to every user's workflow runner; the diagnose command is CLI-only and
// requires a user-supplied API key on their local machine.

import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadWorkflows } from './parser';
import { getAllChecks, CHECK_NAMES } from './checks';
import { buildRepoContext } from './github';
import type { CheckResult } from './types';

const SEVERITY_ORDER: Record<CheckResult['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

async function run(): Promise<void> {
  const checksInput = core.getInput('checks') || CHECK_NAMES.join(',');
  const verbose = core.getBooleanInput('verbose');
  const token =
    core.getInput('github-token') ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    '';

  if (!token) {
    core.setFailed(
      'No GitHub token available. Pass `github-token: ${{ github.token }}` or grant the workflow `permissions: { contents: read }`.',
    );
    return;
  }

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const { owner, repo } = github.context.repo;

  core.info(`Preflight scanning ${owner}/${repo} at ${workspace}`);

  const wanted = new Set(
    checksInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const invalid = Array.from(wanted).filter(
    (n) => !(CHECK_NAMES as readonly string[]).includes(n),
  );
  if (invalid.length) {
    core.setFailed(
      `Unknown check name(s): ${invalid.join(', ')}. Valid: ${CHECK_NAMES.join(', ')}.`,
    );
    return;
  }

  const workflows = await loadWorkflows(workspace);
  if (workflows.length === 0) {
    core.warning('No workflow files found under .github/workflows/.');
    await writeSummary([], { workflowCount: 0, ran: [], skipped: [...wanted] });
    return;
  }

  const built = await buildRepoContext(owner, repo, token);
  const activeChecks = getAllChecks(built.octokit).filter((c) => wanted.has(c.name));
  const skippedChecks = CHECK_NAMES.filter((n) => !wanted.has(n));

  const results: CheckResult[] = [];
  for (const check of activeChecks) {
    try {
      results.push(...(await check.run({ workflows, repo: built.context })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.warning(`Check "${check.name}" threw: ${message}`);
    }
  }

  results.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    const f = (a.file ?? '').localeCompare(b.file ?? '');
    if (f !== 0) return f;
    return (a.line ?? 0) - (b.line ?? 0);
  });

  for (const r of results) emitAnnotation(r);

  const counts = {
    errors: results.filter((r) => r.severity === 'error').length,
    warnings: results.filter((r) => r.severity === 'warning').length,
    info: results.filter((r) => r.severity === 'info').length,
  };

  core.setOutput('error_count', counts.errors);
  core.setOutput('warning_count', counts.warnings);
  core.setOutput('info_count', counts.info);

  await writeSummary(results, {
    workflowCount: workflows.length,
    ran: activeChecks.map((c) => c.name),
    skipped: skippedChecks,
    verbose,
  });

  if (counts.errors > 0) {
    core.setFailed(
      `Preflight found ${counts.errors} error${counts.errors === 1 ? '' : 's'}. See the annotations on the PR diff and the job summary for details.`,
    );
  }
}

function emitAnnotation(result: CheckResult): void {
  const title = `[${result.check}] ${truncate(result.message, 80)}`;
  const body = result.fix
    ? `${result.message}\n\nFix: ${result.fix}`
    : result.message;

  const props: core.AnnotationProperties = {
    title,
    ...(result.file ? { file: result.file } : {}),
    ...(typeof result.line === 'number' ? { startLine: result.line } : {}),
    ...(typeof result.column === 'number' ? { startColumn: result.column } : {}),
  };

  if (result.severity === 'error') core.error(body, props);
  else if (result.severity === 'warning') core.warning(body, props);
  else core.notice(body, props);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

async function writeSummary(
  results: CheckResult[],
  meta: {
    workflowCount: number;
    ran: string[];
    skipped: string[];
    verbose?: boolean;
  },
): Promise<void> {
  const errors = results.filter((r) => r.severity === 'error').length;
  const warnings = results.filter((r) => r.severity === 'warning').length;
  const info = results.filter((r) => r.severity === 'info').length;

  core.summary
    .addHeading('Preflight CI', 2)
    .addRaw(
      `Scanned ${meta.workflowCount} workflow file${meta.workflowCount === 1 ? '' : 's'} · ` +
        `**${errors}** error${errors === 1 ? '' : 's'}, ` +
        `**${warnings}** warning${warnings === 1 ? '' : 's'}, ` +
        `**${info}** info`,
      true,
    );

  if (results.length > 0) {
    const header = [
      { data: 'Severity', header: true },
      { data: 'Check', header: true },
      { data: 'File', header: true },
      { data: 'Location', header: true },
      { data: 'Message', header: true },
    ];
    const rows = results.map((r) => [
      { data: `\`${r.severity}\`` },
      { data: `\`${r.check}\`` },
      { data: r.file ? `\`${r.file}\`` : '-' },
      { data: formatLocation(r) },
      { data: r.message },
    ]);
    core.summary.addTable([header, ...rows]);

    if (meta.verbose) {
      core.summary.addHeading('Fixes', 3);
      for (const r of results) {
        if (!r.fix) continue;
        core.summary.addRaw(
          `\n**[${r.check}] ${r.message}**\n\n\`\`\`\n${r.fix}\n\`\`\`\n`,
          true,
        );
      }
    }
  } else {
    core.summary.addRaw('\n\n✅ All checks passed.', true);
  }

  core.summary.addHeading('Checks run', 3).addList(
    CHECK_NAMES.map((name) => {
      if (meta.skipped.includes(name)) return `~${name}~ (skipped)`;
      if (meta.ran.includes(name)) return `${name}`;
      return `${name}`;
    }),
  );

  await core.summary.write();
}

function formatLocation(r: CheckResult): string {
  const parts: string[] = [];
  if (r.job) parts.push(`job: ${r.job}`);
  if (r.step) parts.push(`step: ${r.step}`);
  if (r.line) parts.push(`line ${r.line}`);
  return parts.join(', ') || '-';
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(`Preflight Action crashed: ${message}`);
  if (err instanceof Error && err.stack) core.debug(err.stack);
});
