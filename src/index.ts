#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getGhToken, getRepoInfo, buildRepoContext } from './github';
import { loadWorkflows } from './parser';
import { getAllChecks, CHECK_NAMES } from './checks';
import {
  printHeader,
  printCheckStart,
  printResults,
  printSummary,
  printJson,
} from './reporter';
import { installHook, uninstallHook } from './hooks';
import { diagnose } from './diagnose';
import type { CheckResult } from './types';

const VERSION: string = (() => {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

interface MainOptions {
  checks?: string;
  json?: boolean;
  verbose?: boolean;
  path: string;
}

function writeErr(msg: string): void {
  process.stderr.write(chalk.red.bold('error: ') + msg + '\n');
}

function writeHint(msg: string): void {
  process.stderr.write(chalk.dim(msg) + '\n');
}

function fatal(message: string, code = 2): never {
  writeErr(message);
  process.exit(code);
}

async function runChecks(opts: MainOptions): Promise<void> {
  const startTime = Date.now();

  let wantedCheckNames: Set<string> | null = null;
  if (opts.checks) {
    const wanted = opts.checks
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const available = new Set<string>(CHECK_NAMES);
    const invalid = wanted.filter((w) => !available.has(w));
    if (invalid.length) {
      writeErr(`Unknown check name(s): ${invalid.join(', ')}`);
      writeHint(`Available checks: ${CHECK_NAMES.join(', ')}`);
      process.exit(2);
    }
    wantedCheckNames = new Set(wanted);
  }

  const resolvedPath = path.resolve(opts.path);
  if (!fs.existsSync(resolvedPath)) {
    fatal(`Path does not exist: ${resolvedPath}`);
  }

  let repoInfo;
  try {
    repoInfo = getRepoInfo(resolvedPath);
  } catch (e) {
    fatal(e instanceof Error ? e.message : String(e));
  }

  let token: string;
  try {
    token = getGhToken();
  } catch (e) {
    fatal(e instanceof Error ? e.message : String(e));
  }

  let workflows;
  try {
    workflows = await loadWorkflows(resolvedPath);
  } catch (e) {
    fatal(`Failed to load workflow files: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (workflows.length === 0) {
    fatal(
      `No workflow files found in ${path.join(resolvedPath, '.github', 'workflows')}\n` +
        'Create a workflow YAML there (e.g. .github/workflows/ci.yml) and re-run.',
    );
  }

  if (!opts.json) {
    printHeader(repoInfo, workflows.length);
  }

  let built;
  try {
    built = await buildRepoContext(repoInfo.owner, repoInfo.repo, token);
  } catch (e) {
    fatal(
      `Failed to connect to GitHub API: ${e instanceof Error ? e.message : String(e)}\n` +
        'Check your token has "repo" scope and can access ' +
        `${repoInfo.owner}/${repoInfo.repo}.`,
    );
  }

  let checks = getAllChecks(built.octokit);
  if (wantedCheckNames) {
    checks = checks.filter((c) => wantedCheckNames!.has(c.name));
  }

  const results: CheckResult[] = [];
  for (const check of checks) {
    if (!opts.json) printCheckStart(check.name, check.description);
    try {
      const checkResults = await check.run({
        workflows,
        repo: built.context,
      });
      results.push(...checkResults);
      if (opts.verbose && !opts.json) {
        const count = checkResults.length;
        const tail = count === 0 ? chalk.green('✓ no issues') : chalk.dim(`${count} issue${count === 1 ? '' : 's'}`);
        process.stdout.write(chalk.dim(`  ↳ `) + tail + '\n');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        check: check.name,
        severity: 'error',
        message: `Check "${check.name}" failed to run: ${msg}`,
        fix: 'Report this as a bug (use --verbose to get a stack trace).',
      });
      if (opts.verbose && e instanceof Error && e.stack) {
        process.stderr.write(chalk.dim(e.stack) + '\n');
      }
    }
  }

  if (opts.json) {
    printJson(results);
  } else {
    printResults(results);
    printSummary(results, Date.now() - startTime);
  }

  const hasErrors = results.some((r) => r.severity === 'error');
  process.exit(hasErrors ? 1 : 0);
}

async function runHookInstall(cwd: string): Promise<void> {
  try {
    const result = await installHook(cwd);
    const hook = chalk.bold(result.hookPath);
    if (result.action === 'created') {
      process.stdout.write(chalk.green('✓ Installed pre-push hook at ') + hook + '\n');
      process.stdout.write(
        chalk.dim('  preflight-ci will run automatically before every `git push`.\n'),
      );
    } else if (result.action === 'appended') {
      process.stdout.write(
        chalk.green('✓ Appended preflight block to existing pre-push hook: ') + hook + '\n',
      );
      if (result.backup) {
        process.stdout.write(chalk.dim(`  backup saved to ${result.backup}\n`));
      }
    } else {
      process.stdout.write(chalk.cyan('ℹ Already installed — no changes to ') + hook + '\n');
    }
  } catch (e) {
    fatal(e instanceof Error ? e.message : String(e));
  }
}

async function runHookUninstall(cwd: string): Promise<void> {
  try {
    const result = await uninstallHook(cwd);
    const hook = chalk.bold(result.hookPath);
    switch (result.action) {
      case 'removed':
        process.stdout.write(
          chalk.green('✓ Removed preflight block from ') + hook + '\n',
        );
        process.stdout.write(chalk.dim('  (other hook content preserved)\n'));
        break;
      case 'deleted':
        process.stdout.write(
          chalk.green('✓ Removed pre-push hook ') +
            hook +
            chalk.dim(' (no other content remained)\n'),
        );
        break;
      case 'not-installed':
        process.stdout.write(
          chalk.cyan('ℹ No preflight block found in ') + hook + '\n',
        );
        break;
      case 'no-hook':
        process.stdout.write(chalk.cyan('ℹ No pre-push hook exists at ') + hook + '\n');
        break;
    }
  } catch (e) {
    fatal(e instanceof Error ? e.message : String(e));
  }
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('preflight')
    .description(
      'Validate GitHub Actions workflows against the real GitHub repo config before pushing.',
    )
    .version(VERSION)
    .option('--checks <list>', 'comma-separated list of check names to run (default: all)')
    .option('--json', 'output results as JSON (suppresses progress and summary)')
    .option('--verbose', 'show extra detail and stack traces on errors')
    .option('--path <dir>', 'path to the repo to scan', process.cwd())
    .action(async (opts: MainOptions) => {
      await runChecks(opts);
    });

  const hook = program
    .command('hook')
    .description('Manage the git pre-push hook that runs preflight automatically');

  hook
    .command('install')
    .description('Install a pre-push hook that runs preflight before every push')
    .action(async () => {
      const parentOpts = program.opts<MainOptions>();
      await runHookInstall(path.resolve(parentOpts.path ?? process.cwd()));
    });

  hook
    .command('uninstall')
    .description('Remove the preflight block from the pre-push hook')
    .action(async () => {
      const parentOpts = program.opts<MainOptions>();
      await runHookUninstall(path.resolve(parentOpts.path ?? process.cwd()));
    });

  program
    .command('diagnose')
    .description(
      'Diagnose the most recent failed GitHub Actions run on the current branch using Claude (requires ANTHROPIC_API_KEY)',
    )
    .option(
      '--run-id <id>',
      'specific workflow run ID to diagnose (otherwise the most recent failed run on the current branch)',
      (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`--run-id must be a positive integer, got "${value}"`);
        }
        return n;
      },
    )
    .action(async (subOpts: { runId?: number }) => {
      const parentOpts = program.opts<MainOptions>();
      const cwd = path.resolve(parentOpts.path ?? process.cwd());
      try {
        await diagnose({
          cwd,
          runId: subOpts.runId,
          verbose: parentOpts.verbose,
        });
      } catch (e) {
        if (parentOpts.verbose && e instanceof Error && e.stack) {
          process.stderr.write(chalk.dim(e.stack) + '\n');
        }
        fatal(e instanceof Error ? e.message : String(e));
      }
    });

  return program;
}

buildProgram()
  .parseAsync(process.argv)
  .catch((e) => {
    writeErr(e instanceof Error ? e.message : String(e));
    if (process.argv.includes('--verbose') && e instanceof Error && e.stack) {
      process.stderr.write(chalk.dim(e.stack) + '\n');
    }
    process.exit(2);
  });
