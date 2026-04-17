// SECURITY: This module NEVER reads, requests, or stores secret VALUES.
// The GitHub REST API endpoints used here return metadata only —
// secret NAMES, variable NAMES, environment NAMES. Secret values are
// never available through the API and must never be fetched, logged,
// or persisted by this tool. See CLAUDE.md ("Never read secret VALUES").

import { execSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import type { RepoContext } from './types';

const TOKEN_INSTRUCTIONS = [
  'No GitHub token found. Authenticate with one of:',
  '  1. gh CLI: run `gh auth login` (recommended)',
  '  2. Env var: export GITHUB_TOKEN=<your token>',
  '  3. Env var: export GH_TOKEN=<your token>',
].join('\n');

export function getGhToken(): string {
  try {
    const token = execSync('gh auth token', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (token) return token;
  } catch {
    // gh CLI not installed or not authenticated — fall through to env vars
  }

  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (envToken && envToken.trim()) return envToken.trim();

  throw new Error(TOKEN_INSTRUCTIONS);
}

export interface RepoInfo {
  owner: string;
  repo: string;
}

export function getRepoInfo(cwd: string = process.cwd()): RepoInfo {
  let remoteUrl: string;
  try {
    remoteUrl = execSync('git remote get-url origin', {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Not a git repository or no "origin" remote configured (cwd: ${cwd}).\n` +
        `Run this tool from inside a git repo with a GitHub remote.\n` +
        `Detail: ${detail}`,
    );
  }

  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    throw new Error(
      `Could not parse GitHub owner/repo from remote URL: ${remoteUrl}\n` +
        `Expected SSH (git@github.com:owner/repo.git) or HTTPS (https://github.com/owner/repo.git).`,
    );
  }
  return parsed;
}

export function parseGitHubRemote(remoteUrl: string): RepoInfo | null {
  const url = remoteUrl.trim().replace(/\.git$/, '');

  // SSH: git@github.com:owner/repo
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo  (optionally with user@ / token@)
  const httpsMatch = url.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+)$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // git protocol: git://github.com/owner/repo
  const gitProtoMatch = url.match(/^git:\/\/github\.com\/([^/]+)\/(.+)$/);
  if (gitProtoMatch) return { owner: gitProtoMatch[1], repo: gitProtoMatch[2] };

  // ssh:// form: ssh://git@github.com/owner/repo
  const sshUrlMatch = url.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/);
  if (sshUrlMatch) return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };

  return null;
}

export interface BuildRepoContextResult {
  octokit: Octokit;
  context: RepoContext;
}

export function createOctokit(token: string): Octokit {
  const silence = () => {};
  return new Octokit({
    auth: token,
    log: { debug: silence, info: silence, warn: silence, error: silence },
  });
}

export async function buildRepoContext(
  owner: string,
  repo: string,
  token: string,
): Promise<BuildRepoContextResult> {
  const octokit = createOctokit(token);

  const [repoRes, secretsRes, variablesRes, envsRes, orgSecretsRes, orgVarsRes] =
    await Promise.allSettled([
      octokit.repos.get({ owner, repo }),
      octokit.paginate(octokit.actions.listRepoSecrets, { owner, repo, per_page: 100 }),
      octokit.paginate(octokit.actions.listRepoVariables, { owner, repo, per_page: 100 }),
      octokit.repos.getAllEnvironments({ owner, repo }),
      octokit.paginate(octokit.actions.listOrgSecrets, { org: owner, per_page: 100 }),
      octokit.paginate(octokit.actions.listOrgVariables, { org: owner, per_page: 100 }),
    ]);

  const defaultBranch =
    repoRes.status === 'fulfilled' ? repoRes.value.data.default_branch : 'main';

  const secrets = new Set<string>(['GITHUB_TOKEN']);
  if (secretsRes.status === 'fulfilled') {
    for (const s of secretsRes.value) secrets.add(s.name);
  }
  if (orgSecretsRes.status === 'fulfilled') {
    for (const s of orgSecretsRes.value) secrets.add(s.name);
  }

  const variables = new Set<string>();
  if (variablesRes.status === 'fulfilled') {
    for (const v of variablesRes.value) variables.add(v.name);
  }
  if (orgVarsRes.status === 'fulfilled') {
    for (const v of orgVarsRes.value) variables.add(v.name);
  }

  const environments = new Set<string>();
  if (envsRes.status === 'fulfilled') {
    const envs = envsRes.value.data.environments ?? [];
    for (const env of envs) environments.add(env.name);
  }

  const context: RepoContext = {
    owner,
    repo,
    defaultBranch,
    secrets,
    variables,
    environments,
    environmentSecrets: new Map(),
    environmentVariables: new Map(),
  };

  return { octokit, context };
}

export interface ActionExistsResult {
  exists: boolean;
  error?: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export async function checkActionExists(
  octokit: Octokit,
  actionRef: string,
): Promise<ActionExistsResult> {
  // Local actions: ./path or ../path — static analysis can't validate remote existence.
  if (actionRef.startsWith('./') || actionRef.startsWith('../')) {
    return { exists: true };
  }
  // Docker actions: docker://image — not a GitHub repo reference.
  if (actionRef.startsWith('docker://')) {
    return { exists: true };
  }

  const atIdx = actionRef.lastIndexOf('@');
  if (atIdx === -1) {
    return {
      exists: false,
      error: `Action reference "${actionRef}" is missing a version (e.g. @v4 or @<sha>).`,
    };
  }

  const repoPart = actionRef.slice(0, atIdx);
  const ref = actionRef.slice(atIdx + 1);

  if (!ref) {
    return { exists: false, error: `Action reference "${actionRef}" has an empty version.` };
  }

  const segments = repoPart.split('/');
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    return {
      exists: false,
      error: `Action reference "${actionRef}" is not in owner/repo[/path]@ref form.`,
    };
  }
  const owner = segments[0];
  const repo = segments[1];

  try {
    await octokit.repos.get({ owner, repo });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return {
        exists: false,
        error: `Action repo "${owner}/${repo}" not found (404).`,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { exists: false, error: `Failed to fetch "${owner}/${repo}": ${msg}` };
  }

  if (SHA_PATTERN.test(ref)) {
    try {
      await octokit.git.getCommit({ owner, repo, commit_sha: ref });
      return { exists: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 422) {
        return { exists: false, error: `Commit SHA "${ref}" not found in ${owner}/${repo}.` };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { exists: false, error: `Failed to verify SHA "${ref}": ${msg}` };
    }
  }

  const tagOk = await refExists(octokit, owner, repo, `tags/${ref}`);
  if (tagOk) return { exists: true };

  const branchOk = await refExists(octokit, owner, repo, `heads/${ref}`);
  if (branchOk) return { exists: true };

  return {
    exists: false,
    error: `Ref "${ref}" is not a tag, branch, or full SHA in ${owner}/${repo}.`,
  };
}

async function refExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<boolean> {
  try {
    await octokit.git.getRef({ owner, repo, ref });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return false;
    // Other errors (rate limit, network) — treat as unknown / not found, surface upstream.
    return false;
  }
}
