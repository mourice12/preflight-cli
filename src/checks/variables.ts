import type { CheckFunction, CheckResult } from '../types';
import { extractVariableRefs } from '../parser';
import { suggestTypo } from './utils';

export const variablesCheck: CheckFunction = {
  name: 'variables',
  description: 'Validate ${{ vars.X }} references exist in the repo',
  async run({ workflows, repo }) {
    const results: CheckResult[] = [];
    const pool = Array.from(repo.variables);

    for (const wf of workflows) {
      if (wf.parseError) continue;
      const seen = new Set<string>();
      for (const ref of extractVariableRefs(wf)) {
        if (repo.variables.has(ref.name)) continue;

        const dedupKey = `${ref.name}::${ref.job ?? ''}::${ref.step ?? ''}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const suggestion = suggestTypo(ref.name, pool);
        const fixParts = [
          `Add the variable: gh variable set ${ref.name} --repo ${repo.owner}/${repo.repo}`,
        ];
        if (suggestion) {
          fixParts.push(`Or did you mean "${suggestion}"? (change the reference)`);
        }

        const out: CheckResult = {
          check: 'variables',
          severity: 'error',
          message: `Variable "${ref.name}" is not defined in the repo`,
          file: wf.relativePath,
          fix: fixParts.join('\n'),
        };
        if (ref.job) out.job = ref.job;
        if (ref.step) out.step = ref.step;
        results.push(out);
      }
    }
    return results;
  },
};
