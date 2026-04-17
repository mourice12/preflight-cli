import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckResult, Severity } from './types';
import type { RepoInfo } from './github';

const VERSION: string = (() => {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function termWidth(): number {
  const cols = process.stdout.columns;
  if (typeof cols === 'number' && cols >= 40) return Math.min(cols, 120);
  return 80;
}

function rule(title: string): string {
  const w = termWidth();
  const lead = '── ';
  const gap = ' ';
  const chrome = lead.length + title.length + gap.length;
  const pad = Math.max(3, w - chrome);
  return chalk.dim(lead) + chalk.bold(title) + chalk.dim(gap + '─'.repeat(pad));
}

function divider(char: string): string {
  return chalk.dim(char.repeat(termWidth()));
}

export function printHeader(repo: RepoInfo, workflowCount: number): void {
  process.stdout.write(rule(`preflight v${VERSION}`) + '\n');
  const noun = workflowCount === 1 ? 'workflow file' : 'workflow files';
  process.stdout.write(
    chalk.cyan('Scanning ') +
      chalk.bold(`${repo.owner}/${repo.repo}`) +
      chalk.dim(` — ${workflowCount} ${noun} found`) +
      '\n\n',
  );
}

export function printCheckStart(checkName: string, description: string): void {
  const arrow = chalk.dim('→');
  const name = chalk.cyan(checkName.padEnd(12));
  const desc = chalk.dim(description);
  process.stdout.write(`${arrow} ${name} ${desc}\n`);
}

const ICON: Record<Severity, string> = {
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const LABEL: Record<Severity, string> = {
  error: 'ERROR',
  warning: 'WARN ',
  info: 'INFO ',
};

const TINT: Record<Severity, chalk.Chalk> = {
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
};

const SEV_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function contextParts(r: CheckResult): string[] {
  const parts: string[] = [];
  if (r.job) parts.push(`job: ${r.job}`);
  if (r.step) parts.push(`step: ${r.step}`);
  if (typeof r.line === 'number') parts.push(`line ${r.line}`);
  if (typeof r.column === 'number') parts.push(`col ${r.column}`);
  return parts;
}

function printOne(r: CheckResult): void {
  const tint = TINT[r.severity];
  const head = tint.bold(`${ICON[r.severity]} ${LABEL[r.severity]}`);
  const tag = chalk.dim(`[${r.check}]`);
  process.stdout.write(`${head} ${tag} ${r.message}\n`);

  const ctx = contextParts(r);
  if (ctx.length) {
    process.stdout.write(chalk.dim(`  > ${ctx.join(', ')}`) + '\n');
  }

  if (r.fix) {
    const [first, ...rest] = r.fix.split('\n');
    process.stdout.write(chalk.dim(`  > Fix: ${first}`) + '\n');
    for (const line of rest) {
      process.stdout.write(chalk.dim(`         ${line}`) + '\n');
    }
  }
  process.stdout.write('\n');
}

function sortForFile(list: CheckResult[]): CheckResult[] {
  return list.slice().sort((a, b) => {
    const sev = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    if (sev !== 0) return sev;
    if (a.check !== b.check) return a.check.localeCompare(b.check);
    const aLine = typeof a.line === 'number' ? a.line : Number.MAX_SAFE_INTEGER;
    const bLine = typeof b.line === 'number' ? b.line : Number.MAX_SAFE_INTEGER;
    return aLine - bLine;
  });
}

export function printResults(results: CheckResult[]): void {
  if (results.length === 0) return;

  const byFile = new Map<string, CheckResult[]>();
  const noFile: CheckResult[] = [];
  for (const r of results) {
    if (r.file) {
      const list = byFile.get(r.file) ?? [];
      list.push(r);
      byFile.set(r.file, list);
    } else {
      noFile.push(r);
    }
  }

  for (const file of Array.from(byFile.keys()).sort()) {
    process.stdout.write('\n' + rule(file) + '\n\n');
    for (const r of sortForFile(byFile.get(file)!)) printOne(r);
  }

  if (noFile.length) {
    process.stdout.write('\n' + rule('(general)') + '\n\n');
    for (const r of sortForFile(noFile)) printOne(r);
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function plural(n: number, one: string, many: string = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function printSummary(results: CheckResult[], elapsedMs: number): void {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const r of results) counts[r.severity]++;
  const elapsed = formatElapsed(elapsedMs);

  process.stdout.write('\n' + divider('═') + '\n');

  if (results.length === 0) {
    process.stdout.write(
      chalk.green.bold('✓ All clear') +
        chalk.dim(` — 0 issues (${elapsed})`) +
        '\n',
    );
    return;
  }

  const parts: string[] = [];
  if (counts.error) parts.push(chalk.red.bold(plural(counts.error, 'error')));
  if (counts.warning) parts.push(chalk.yellow.bold(plural(counts.warning, 'warning')));
  if (counts.info) parts.push(chalk.cyan.bold(plural(counts.info, 'info', 'info')));

  const leadIcon =
    counts.error > 0
      ? chalk.red.bold('✕')
      : counts.warning > 0
        ? chalk.yellow.bold('⚠')
        : chalk.cyan.bold('ℹ');

  process.stdout.write(
    `${leadIcon} ${parts.join(chalk.dim(', '))} ${chalk.dim(`(${elapsed})`)}\n`,
  );
}

export function printJson(results: CheckResult[]): void {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}
