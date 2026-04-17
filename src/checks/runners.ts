import type { CheckFunction, CheckResult } from '../types';

const DEPRECATED_RUNNERS: Record<string, string> = {
  'ubuntu-18.04': 'ubuntu-22.04 (or ubuntu-latest, ubuntu-24.04)',
  'ubuntu-16.04': 'ubuntu-22.04 (or ubuntu-latest, ubuntu-24.04)',
  'macos-10.15': 'macos-14 (or macos-latest, macos-15)',
  'macos-11': 'macos-14 (or macos-latest, macos-15)',
  'windows-2016': 'windows-2022 (or windows-latest)',
  'windows-2019': 'windows-2022 (or windows-latest)',
};

const VALID_HOSTED = new Set([
  'ubuntu-latest',
  'ubuntu-22.04',
  'ubuntu-24.04',
  'macos-latest',
  'macos-14',
  'macos-15',
  'windows-latest',
  'windows-2022',
]);

function isDynamic(value: string): boolean {
  return value.includes('${{');
}

function checkLabel(
  label: string,
  file: string,
  jobName: string,
  results: CheckResult[],
): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  if (isDynamic(trimmed)) return;

  const replacement = DEPRECATED_RUNNERS[trimmed];
  if (replacement) {
    results.push({
      check: 'runners',
      severity: 'warning',
      message: `Deprecated runner image "${trimmed}"`,
      file,
      job: jobName,
      fix: `Replace with ${replacement}.`,
    });
    return;
  }

  if (trimmed.startsWith('self-hosted')) return;
  if (VALID_HOSTED.has(trimmed)) return;
  results.push({
    check: 'runners',
    severity: 'info',
    message: `Unrecognized runner label "${trimmed}" — assuming self-hosted or custom`,
    file,
    job: jobName,
    fix: `If hosted, use one of: ${Array.from(VALID_HOSTED).join(', ')}.`,
  });
}

export const runnersCheck: CheckFunction = {
  name: 'runners',
  description: 'Validate runs-on values and flag deprecated runner images',
  async run({ workflows }) {
    const results: CheckResult[] = [];

    for (const wf of workflows) {
      if (wf.parseError) continue;
      const jobs = wf.parsed.jobs ?? {};
      for (const [jobName, job] of Object.entries(jobs)) {
        if (!job || typeof job !== 'object') continue;
        const runsOn = job['runs-on'];
        if (runsOn === undefined) continue;

        if (typeof runsOn === 'string') {
          if (isDynamic(runsOn)) continue;
          checkLabel(runsOn, wf.relativePath, jobName, results);
        } else if (Array.isArray(runsOn)) {
          const strs = runsOn.filter((l): l is string => typeof l === 'string');
          if (strs.some((l) => l === 'self-hosted' || l.startsWith('self-hosted'))) continue;
          for (const label of strs) {
            checkLabel(label, wf.relativePath, jobName, results);
          }
        } else if (runsOn && typeof runsOn === 'object') {
          // { group: ..., labels: [...] } — custom runner group, don't flag individual labels
          continue;
        }
      }
    }

    return results;
  },
};
