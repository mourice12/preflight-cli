import type { CheckFunction, CheckResult } from '../types';
import { extractEnvironmentRefs } from '../parser';
import { suggestTypo } from './utils';

export const environmentsCheck: CheckFunction = {
  name: 'environments',
  description: 'Validate environment: references exist in the repo',
  async run({ workflows, repo }) {
    const results: CheckResult[] = [];

    const lowercaseMap = new Map<string, string>();
    for (const name of repo.environments) lowercaseMap.set(name.toLowerCase(), name);

    for (const wf of workflows) {
      if (wf.parseError) continue;
      for (const ref of extractEnvironmentRefs(wf)) {
        if (repo.environments.has(ref.name)) continue;

        const actualCase = lowercaseMap.get(ref.name.toLowerCase());
        if (actualCase) {
          results.push({
            check: 'environments',
            severity: 'warning',
            message: `Environment "${ref.name}" has a case mismatch with repo environment "${actualCase}"`,
            file: wf.relativePath,
            job: ref.job,
            fix: `Change "environment: ${ref.name}" to "environment: ${actualCase}".`,
          });
          continue;
        }

        const suggestion = suggestTypo(ref.name, repo.environments);
        const fixParts = [
          `Create the environment: https://github.com/${repo.owner}/${repo.repo}/settings/environments/new`,
        ];
        if (suggestion) {
          fixParts.push(`Or did you mean "${suggestion}"?`);
        }

        results.push({
          check: 'environments',
          severity: 'error',
          message: `Environment "${ref.name}" is not defined in the repo`,
          file: wf.relativePath,
          job: ref.job,
          fix: fixParts.join('\n'),
        });
      }
    }
    return results;
  },
};
