import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const BEGIN_MARKER = '# preflight-ci:begin';
const END_MARKER = '# preflight-ci:end';

const HOOK_BLOCK = `${BEGIN_MARKER}
# Validate GitHub Actions workflows before push. Remove with: preflight hook uninstall
npx --yes preflight-ci || exit $?
${END_MARKER}`;

const DEFAULT_HOOK = `#!/bin/sh
${HOOK_BLOCK}
`;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findHooksDir(cwd: string = process.cwd()): string {
  let raw: string;
  try {
    raw = execSync('git rev-parse --git-path hooks', {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Not a git repository (cwd: ${cwd}).\n` +
        `Run this from inside a git repo.\nDetail: ${detail}`,
    );
  }
  return path.isAbsolute(raw) ? raw : path.join(cwd, raw);
}

export type InstallAction = 'created' | 'appended' | 'already-installed';

export interface InstallResult {
  action: InstallAction;
  hookPath: string;
  backup?: string;
}

export async function installHook(cwd: string = process.cwd()): Promise<InstallResult> {
  const hooksDir = findHooksDir(cwd);
  await fs.mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-push');

  let existing: string | null = null;
  try {
    existing = await fs.readFile(hookPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (existing === null) {
    await fs.writeFile(hookPath, DEFAULT_HOOK, { mode: 0o755 });
    return { action: 'created', hookPath };
  }

  if (existing.includes(BEGIN_MARKER)) {
    // Ensure executable bit is set even if a previous write lost it.
    await fs.chmod(hookPath, 0o755);
    return { action: 'already-installed', hookPath };
  }

  // Insert our block after the shebang line (if any) so our checks run first,
  // preserving the rest of the user's hook.
  const lines = existing.split('\n');
  const insertAt = lines.length > 0 && lines[0].startsWith('#!') ? 1 : 0;
  const newContent = [
    ...lines.slice(0, insertAt),
    HOOK_BLOCK,
    ...lines.slice(insertAt),
  ].join('\n');

  const backup = `${hookPath}.preflight-backup`;
  await fs.writeFile(backup, existing, { mode: 0o755 });
  await fs.writeFile(hookPath, newContent, { mode: 0o755 });
  return { action: 'appended', hookPath, backup };
}

export type UninstallAction = 'removed' | 'deleted' | 'not-installed' | 'no-hook';

export interface UninstallResult {
  action: UninstallAction;
  hookPath: string;
}

export async function uninstallHook(cwd: string = process.cwd()): Promise<UninstallResult> {
  const hooksDir = findHooksDir(cwd);
  const hookPath = path.join(hooksDir, 'pre-push');

  let content: string;
  try {
    content = await fs.readFile(hookPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { action: 'no-hook', hookPath };
    }
    throw err;
  }

  if (!content.includes(BEGIN_MARKER)) {
    return { action: 'not-installed', hookPath };
  }

  const blockRe = new RegExp(
    `\\n?${escapeRegex(BEGIN_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}\\n?`,
    'g',
  );
  const stripped = content.replace(blockRe, '\n').replace(/\n{3,}/g, '\n\n');

  // If only a shebang + whitespace remain, the hook is effectively empty — delete it.
  const nonShebang = stripped.replace(/^#![^\n]*\n?/, '').trim();
  if (nonShebang === '') {
    await fs.unlink(hookPath);
    return { action: 'deleted', hookPath };
  }

  await fs.writeFile(hookPath, stripped, { mode: 0o755 });
  return { action: 'removed', hookPath };
}
