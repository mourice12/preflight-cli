import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { Octokit } from '@octokit/rest';
import type { WorkflowFile, WorkflowDefinition, RepoContext } from '../src/types.ts';

export function makeWorkflow(raw: string, filename = 'test.yml'): WorkflowFile {
  let parsed: WorkflowDefinition = {};
  let parseError: string | undefined;
  try {
    const doc = yaml.load(raw);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      parsed = doc as WorkflowDefinition;
    } else if (doc !== null && doc !== undefined) {
      parseError = `Top-level workflow must be a mapping.`;
    } else {
      parseError = 'Workflow file is empty.';
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }
  return {
    path: filename,
    relativePath: filename,
    raw,
    parsed,
    parseError,
  };
}

export function makeRepoCtx(overrides: Partial<RepoContext> = {}): RepoContext {
  return {
    owner: 'acme',
    repo: 'widget',
    defaultBranch: 'main',
    secrets: new Set(['GITHUB_TOKEN']),
    variables: new Set(),
    environments: new Set(),
    environmentSecrets: new Map(),
    environmentVariables: new Map(),
    ...overrides,
  };
}

export async function makeTmpRepo(
  files: Record<string, string>,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-test-'));
  await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, '.github', 'workflows', name), content);
  }
  return dir;
}

export async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// Minimal Octokit shape for the actions check; it returns "success" for every
// repo/ref lookup so existence-check branches never fire, letting us isolate
// the deprecation/branch-pin logic per CLAUDE.md ("do not mock the GitHub API").
export function makePermissiveOctokit(): Octokit {
  return {
    repos: {
      get: async () => ({ data: { default_branch: 'main' } }),
    },
    git: {
      getCommit: async () => ({ data: {} }),
      getRef: async () => ({ data: {} }),
    },
  } as unknown as Octokit;
}
