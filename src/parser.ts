import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import type {
  WorkflowFile,
  WorkflowDefinition,
  StepDefinition,
} from './types';

export interface SecretRef {
  name: string;
  job?: string;
  step?: string;
}

export interface VariableRef {
  name: string;
  job?: string;
  step?: string;
}

export interface EnvironmentRef {
  name: string;
  job: string;
}

export interface ActionRef {
  ref: string;
  job: string;
  step?: string;
}

export interface ExpressionRef {
  expr: string;
  line: number;
  job?: string;
}

export async function findRepoRoot(start: string = process.cwd()): Promise<string> {
  let dir = path.resolve(start);
  while (true) {
    try {
      await fs.stat(path.join(dir, '.git'));
      return dir;
    } catch {
      // no .git here — keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

export async function loadWorkflows(repoRoot?: string): Promise<WorkflowFile[]> {
  const root = repoRoot ? path.resolve(repoRoot) : await findRepoRoot();
  const workflowDir = path.join(root, '.github', 'workflows');

  const found = new Set<string>();
  for (const pat of ['*.yml', '*.yaml']) {
    const matches = await glob(pat, {
      cwd: workflowDir,
      absolute: true,
      nodir: true,
    });
    for (const m of matches) found.add(m);
  }

  const results: WorkflowFile[] = [];
  for (const filePath of Array.from(found).sort()) {
    const raw = await fs.readFile(filePath, 'utf8');
    const relativePath = path.relative(root, filePath);
    let parsed: WorkflowDefinition = {};
    let parseError: string | undefined;
    try {
      const doc = yaml.load(raw);
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        parsed = doc as WorkflowDefinition;
      } else if (doc !== null && doc !== undefined) {
        parseError = `Top-level workflow must be a mapping (got ${Array.isArray(doc) ? 'array' : typeof doc}).`;
      } else {
        parseError = 'Workflow file is empty.';
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    results.push({ path: filePath, relativePath, raw, parsed, parseError });
  }
  return results;
}

function walkStrings(obj: unknown, visit: (s: string) => void): void {
  if (typeof obj === 'string') {
    visit(obj);
  } else if (Array.isArray(obj)) {
    for (const v of obj) walkStrings(v, visit);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) walkStrings(v, visit);
  }
}

function stepIdentifier(step: StepDefinition, idx: number): string {
  if (typeof step.name === 'string' && step.name.trim()) return step.name.trim();
  if (typeof step.id === 'string' && step.id.trim()) return step.id.trim();
  if (typeof step.uses === 'string' && step.uses.trim()) return step.uses.trim();
  return `step-${idx + 1}`;
}

interface WalkContext {
  job?: string;
  step?: string;
}

function walkWorkflow(
  parsed: WorkflowDefinition,
  visit: (value: string, ctx: WalkContext) => void,
): void {
  const { jobs, ...workflowRest } = parsed;
  walkStrings(workflowRest, (s) => visit(s, {}));

  for (const [jobName, job] of Object.entries(jobs ?? {})) {
    if (!job || typeof job !== 'object') continue;
    const { steps, ...jobRest } = job;
    walkStrings(jobRest, (s) => visit(s, { job: jobName }));

    if (Array.isArray(steps)) {
      steps.forEach((step, idx) => {
        if (!step || typeof step !== 'object') return;
        const stepName = stepIdentifier(step, idx);
        walkStrings(step, (s) => visit(s, { job: jobName, step: stepName }));
      });
    }
  }
}

function contextPayload(ctx: WalkContext): { job?: string; step?: string } {
  const out: { job?: string; step?: string } = {};
  if (ctx.job) out.job = ctx.job;
  if (ctx.step) out.step = ctx.step;
  return out;
}

const SECRET_RE = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const VAR_RE = /\$\{\{\s*vars\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const EXPR_RE = /\$\{\{([\s\S]*?)\}\}/g;

export function extractSecretRefs(workflow: WorkflowFile): SecretRef[] {
  const refs: SecretRef[] = [];
  walkWorkflow(workflow.parsed, (value, ctx) => {
    for (const m of value.matchAll(SECRET_RE)) {
      refs.push({ name: m[1], ...contextPayload(ctx) });
    }
  });
  return refs;
}

export function extractVariableRefs(workflow: WorkflowFile): VariableRef[] {
  const refs: VariableRef[] = [];
  walkWorkflow(workflow.parsed, (value, ctx) => {
    for (const m of value.matchAll(VAR_RE)) {
      refs.push({ name: m[1], ...contextPayload(ctx) });
    }
  });
  return refs;
}

export function extractEnvironmentRefs(workflow: WorkflowFile): EnvironmentRef[] {
  const refs: EnvironmentRef[] = [];
  const jobs = workflow.parsed.jobs ?? {};
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue;
    const env = job.environment;
    let envName: string | undefined;
    if (typeof env === 'string') {
      envName = env;
    } else if (env && typeof env === 'object' && !Array.isArray(env)) {
      const nameField = (env as { name?: unknown }).name;
      if (typeof nameField === 'string') envName = nameField;
    }
    if (!envName) continue;
    if (envName.includes('${{')) continue;
    refs.push({ name: envName, job: jobName });
  }
  return refs;
}

export function extractActionRefs(workflow: WorkflowFile): ActionRef[] {
  const refs: ActionRef[] = [];
  const jobs = workflow.parsed.jobs ?? {};
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object') continue;

    if (typeof job.uses === 'string') {
      const u = job.uses.trim();
      if (u && !u.startsWith('./') && !u.startsWith('../') && !u.startsWith('docker://')) {
        refs.push({ ref: u, job: jobName });
      }
    }

    const steps = job.steps;
    if (!Array.isArray(steps)) continue;
    steps.forEach((step, idx) => {
      if (!step || typeof step !== 'object') return;
      if (typeof step.uses !== 'string') return;
      const useRef = step.uses.trim();
      if (!useRef) return;
      if (useRef.startsWith('./') || useRef.startsWith('../')) return;
      if (useRef.startsWith('docker://')) return;
      refs.push({ ref: useRef, job: jobName, step: stepIdentifier(step, idx) });
    });
  }
  return refs;
}

export function extractExpressions(workflow: WorkflowFile): ExpressionRef[] {
  const raw = workflow.raw;
  const lines = raw.split('\n');

  const lineStartOffsets: number[] = new Array(lines.length);
  {
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      lineStartOffsets[i] = offset;
      offset += lines[i].length + 1; // +1 for the \n
    }
  }

  // Track which job each line belongs to (for expressions under `jobs:`).
  const jobByLine: (string | undefined)[] = new Array(lines.length);
  {
    let currentJob: string | undefined;
    let inJobs = false;
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/#.*$/, '').replace(/\s+$/, '');
      if (!inJobs) {
        if (/^jobs:\s*$/.test(stripped)) inJobs = true;
      } else if (stripped.length > 0 && /^\S/.test(stripped)) {
        // Left the jobs block (new top-level key)
        inJobs = false;
        currentJob = undefined;
      } else {
        const m = stripped.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
        if (m) currentJob = m[1];
      }
      jobByLine[i] = currentJob;
    }
  }

  const findLineIndex = (pos: number): number => {
    let lo = 0;
    let hi = lineStartOffsets.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStartOffsets[mid] <= pos) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };

  const results: ExpressionRef[] = [];
  for (const m of raw.matchAll(EXPR_RE)) {
    const pos = m.index ?? 0;
    const lineIdx = findLineIndex(pos);
    const job = jobByLine[lineIdx];
    const entry: ExpressionRef = { expr: m[1].trim(), line: lineIdx + 1 };
    if (job) entry.job = job;
    results.push(entry);
  }
  return results;
}
