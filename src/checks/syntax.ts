import type { CheckFunction, CheckResult, WorkflowDefinition } from '../types';

function hasTopLevelKey(doc: WorkflowDefinition, key: string): boolean {
  if (!doc || typeof doc !== 'object') return false;
  // YAML's "on" can get parsed as `true` in some YAML 1.1 modes — js-yaml (1.2) keeps it as "on",
  // but we still check for both string "on" and boolean true to be safe.
  if (key === 'on' && Object.prototype.hasOwnProperty.call(doc, true as unknown as string)) {
    return true;
  }
  return Object.prototype.hasOwnProperty.call(doc, key);
}

export const syntaxCheck: CheckFunction = {
  name: 'syntax',
  description: 'Report YAML parse errors and missing required workflow keys',
  async run({ workflows }) {
    const results: CheckResult[] = [];

    for (const wf of workflows) {
      if (wf.parseError) {
        results.push({
          check: 'syntax',
          severity: 'error',
          message: `YAML parse error: ${wf.parseError}`,
          file: wf.relativePath,
          fix: 'Fix the YAML syntax (indentation, missing colons, unclosed quotes) and re-run.',
        });
        continue;
      }

      const doc = wf.parsed;

      if (!hasTopLevelKey(doc, 'on')) {
        results.push({
          check: 'syntax',
          severity: 'error',
          message: 'Missing required top-level key "on:" (trigger)',
          file: wf.relativePath,
          fix: 'Add an "on:" trigger — e.g. `on: push` or `on: [push, pull_request]`.',
        });
      }

      if (!hasTopLevelKey(doc, 'jobs')) {
        results.push({
          check: 'syntax',
          severity: 'error',
          message: 'Missing required top-level key "jobs:"',
          file: wf.relativePath,
          fix: 'Add a "jobs:" mapping with at least one job.',
        });
      }

      if (!doc.name || typeof doc.name !== 'string' || !doc.name.trim()) {
        results.push({
          check: 'syntax',
          severity: 'warning',
          message: 'Workflow has no "name:" key — it will be displayed by filename',
          file: wf.relativePath,
          fix: 'Add a "name:" key at the top of the workflow for clearer UI and notifications.',
        });
      }

      const jobs = doc.jobs;
      if (jobs && typeof jobs === 'object' && !Array.isArray(jobs)) {
        for (const [jobName, job] of Object.entries(jobs)) {
          if (!job || typeof job !== 'object' || Array.isArray(job)) {
            results.push({
              check: 'syntax',
              severity: 'error',
              message: 'Job is not a mapping',
              file: wf.relativePath,
              job: jobName,
              fix: `Define "${jobName}:" as a mapping with runs-on, steps, etc.`,
            });
            continue;
          }

          const isReusable = typeof job.uses === 'string' && job.uses.length > 0;

          if (!isReusable && job['runs-on'] === undefined) {
            results.push({
              check: 'syntax',
              severity: 'error',
              message: 'Missing "runs-on:"',
              file: wf.relativePath,
              job: jobName,
              fix: 'Add "runs-on: ubuntu-latest" (or appropriate runner).',
            });
          }

          if (!isReusable && job.steps === undefined) {
            results.push({
              check: 'syntax',
              severity: 'error',
              message: 'Missing "steps:"',
              file: wf.relativePath,
              job: jobName,
              fix: 'Add a "steps:" list, or replace with a reusable-workflow "uses:" call.',
            });
          } else if (!isReusable && Array.isArray(job.steps) && job.steps.length === 0) {
            results.push({
              check: 'syntax',
              severity: 'warning',
              message: 'Empty "steps:" list',
              file: wf.relativePath,
              job: jobName,
              fix: 'Add at least one step to this job.',
            });
          }
        }
      }
    }

    return results;
  },
};
