import type { CheckFunction, CheckResult, JobDefinition } from '../types';
import { suggestTypo } from './utils';

function normalizeNeeds(needs: unknown): string[] {
  if (!needs) return [];
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs)) return needs.filter((n): n is string => typeof n === 'string');
  return [];
}

function findCycle(jobs: Record<string, JobDefinition>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();

  const dfs = (node: string, path: string[]): string[] | null => {
    color.set(node, GRAY);
    path.push(node);
    const needs = normalizeNeeds(jobs[node]?.needs);
    for (const next of needs) {
      if (!jobs[next]) continue; // missing ref handled elsewhere
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const idx = path.indexOf(next);
        return path.slice(idx).concat(next);
      }
      if (c === WHITE) {
        const found = dfs(next, path);
        if (found) return found;
      }
    }
    path.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const job of Object.keys(jobs)) {
    if ((color.get(job) ?? WHITE) === WHITE) {
      const cycle = dfs(job, []);
      if (cycle) return cycle;
    }
  }
  return null;
}

function stepContinueOnError(job: JobDefinition): boolean {
  if (job['continue-on-error'] === true || job['continue-on-error'] === 'true') return true;
  for (const step of job.steps ?? []) {
    if (step?.['continue-on-error'] === true || step?.['continue-on-error'] === 'true') {
      return true;
    }
  }
  return false;
}

export const jobsCheck: CheckFunction = {
  name: 'jobs',
  description: 'Validate job dependency graph (needs:), cycles, missing refs, empty jobs',
  async run({ workflows }) {
    const results: CheckResult[] = [];

    for (const wf of workflows) {
      if (wf.parseError) continue;
      const jobs = wf.parsed.jobs;
      if (!jobs || typeof jobs !== 'object') continue;

      const jobNames = Object.keys(jobs);
      const jobNameSet = new Set(jobNames);

      for (const [jobName, job] of Object.entries(jobs)) {
        if (!job || typeof job !== 'object') continue;

        for (const needed of normalizeNeeds(job.needs)) {
          if (!jobNameSet.has(needed)) {
            const suggestion = suggestTypo(needed, jobNames);
            results.push({
              check: 'jobs',
              severity: 'error',
              message: `needs "${needed}", which is not defined in this workflow`,
              file: wf.relativePath,
              job: jobName,
              fix: suggestion
                ? `Did you mean "${suggestion}"?`
                : `Define job "${needed}" or remove it from the needs: list.`,
            });
          } else if (needed === jobName) {
            results.push({
              check: 'jobs',
              severity: 'error',
              message: 'Job lists itself in needs:',
              file: wf.relativePath,
              job: jobName,
              fix: `Remove "${jobName}" from its own needs: list.`,
            });
          }
        }

        const hasSteps = Array.isArray(job.steps) && job.steps.length > 0;
        const isReusable = typeof job.uses === 'string' && job.uses.length > 0;
        if (!hasSteps && !isReusable) {
          results.push({
            check: 'jobs',
            severity: 'warning',
            message: 'Job has no steps and no reusable workflow call',
            file: wf.relativePath,
            job: jobName,
            fix: 'Add steps to this job or remove it.',
          });
        }

        for (const needed of normalizeNeeds(job.needs)) {
          const neededJob = jobs[needed];
          if (!neededJob) continue;
          if (stepContinueOnError(neededJob)) {
            results.push({
              check: 'jobs',
              severity: 'warning',
              message: `depends on "${needed}", which can fail silently (continue-on-error)`,
              file: wf.relativePath,
              job: jobName,
              fix: `Either remove continue-on-error from "${needed}", or guard this job with an explicit if: needs.${needed}.result == 'success'.`,
            });
          }
        }
      }

      const cycle = findCycle(jobs as Record<string, JobDefinition>);
      if (cycle) {
        results.push({
          check: 'jobs',
          severity: 'error',
          message: `Circular dependency in needs: ${cycle.join(' → ')}`,
          file: wf.relativePath,
          fix: `Break the cycle by removing one of the needs: edges between ${cycle[0]} and ${cycle[cycle.length - 2]}.`,
        });
      }
    }

    return results;
  },
};
