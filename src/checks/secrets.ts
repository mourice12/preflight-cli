import type { CheckFunction, CheckResult } from '../types';
import { extractSecretRefs } from '../parser';
import { suggestTypo } from './utils';

export const secretsCheck: CheckFunction = {
  name: 'secrets',
  description: 'Validate ${{ secrets.X }} references exist in the repo',
  async run({ workflows, repo }) {
    const results: CheckResult[] = [];
    const pool = Array.from(repo.secrets).filter((s) => s !== 'GITHUB_TOKEN');

    for (const wf of workflows) {
      if (wf.parseError) continue;
      const seen = new Set<string>();
      for (const ref of extractSecretRefs(wf)) {
        if (ref.name === 'GITHUB_TOKEN') continue;
        if (repo.secrets.has(ref.name)) continue;

        const dedupKey = `${ref.name}::${ref.job ?? ''}::${ref.step ?? ''}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const suggestion = suggestTypo(ref.name, pool);
        const fixParts = [
          `Add the secret: gh secret set ${ref.name} --repo ${repo.owner}/${repo.repo}`,
        ];
        if (suggestion) {
          fixParts.push(`Or did you mean "${suggestion}"? (change the reference)`);
        }

        const out: CheckResult = {
          check: 'secrets',
          severity: 'error',
          message: `Secret "${ref.name}" is not defined in the repo`,
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
