import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { secretsCheck } from '../src/checks/secrets.ts';
import { variablesCheck } from '../src/checks/variables.ts';
import { environmentsCheck } from '../src/checks/environments.ts';
import { makeActionsCheck } from '../src/checks/actions.ts';
import { expressionsCheck } from '../src/checks/expressions.ts';
import { permissionsCheck } from '../src/checks/permissions.ts';
import { runnersCheck } from '../src/checks/runners.ts';
import { jobsCheck } from '../src/checks/jobs.ts';
import { syntaxCheck } from '../src/checks/syntax.ts';
import { levenshtein, suggestTypo } from '../src/checks/utils.ts';
import type { CheckResult } from '../src/types.ts';
import { makeWorkflow, makeRepoCtx, makePermissiveOctokit } from './helpers.ts';
import * as fx from './fixtures.ts';

function severities(results: CheckResult[]): Record<string, number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const r of results) counts[r.severity]++;
  return counts;
}

function messages(results: CheckResult[]): string[] {
  return results.map((r) => r.message);
}

describe('utils', () => {
  test('levenshtein distances', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('abc', 'abc'), 0);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('abc', ''), 3);
  });

  test('suggestTypo returns close match within threshold', () => {
    assert.equal(suggestTypo('DEPLY_KEY', ['DEPLOY_KEY', 'OTHER']), 'DEPLOY_KEY');
    assert.equal(suggestTypo('WILDLY_OFF', ['DEPLOY_KEY']), undefined);
    assert.equal(suggestTypo('EXACT', ['EXACT']), undefined, 'exact match returns undefined');
  });
});

describe('secretsCheck', () => {
  test('passes when all refs are defined', async () => {
    const wf = makeWorkflow(fx.WITH_SECRETS);
    const results = await secretsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ secrets: new Set(['GITHUB_TOKEN', 'GLOBAL', 'API_KEY']) }),
    });
    assert.deepEqual(results, []);
  });

  test('flags missing secrets with job/step context', async () => {
    const wf = makeWorkflow(fx.WITH_SECRETS);
    const results = await secretsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ secrets: new Set(['GITHUB_TOKEN']) }),
    });
    assert.equal(results.length, 2);
    for (const r of results) assert.equal(r.severity, 'error');
    const apiKey = results.find((r) => r.message.includes('API_KEY'))!;
    assert.equal(apiKey.job, 'build');
    assert.equal(apiKey.step, 'Use secret');
    assert.ok(apiKey.fix?.includes('gh secret set'));
  });

  test('skips GITHUB_TOKEN (always available)', async () => {
    const wf = makeWorkflow(`name: T
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ secrets.GITHUB_TOKEN }}
`);
    const results = await secretsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.deepEqual(results, []);
  });

  test('suggests close Levenshtein match on typo', async () => {
    const wf = makeWorkflow(`name: T
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ secrets.DEPLY_KEY }}
`);
    const results = await secretsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ secrets: new Set(['GITHUB_TOKEN', 'DEPLOY_KEY']) }),
    });
    assert.equal(results.length, 1);
    assert.ok(results[0].fix?.includes('DEPLOY_KEY'));
  });
});

describe('variablesCheck', () => {
  test('flags missing vars and suggests close match', async () => {
    const wf = makeWorkflow(fx.WITH_VARIABLES);
    const results = await variablesCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ variables: new Set(['REGIN', 'NODE_VERSION']) }),
    });
    assert.equal(results.length, 1);
    assert.ok(results[0].message.includes('REGION'));
    assert.ok(results[0].fix?.includes('REGIN'), 'should suggest typo match');
  });

  test('passes when all vars are defined', async () => {
    const wf = makeWorkflow(fx.WITH_VARIABLES);
    const results = await variablesCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ variables: new Set(['REGION', 'NODE_VERSION']) }),
    });
    assert.deepEqual(results, []);
  });
});

describe('environmentsCheck', () => {
  test('flags missing environments as errors', async () => {
    const wf = makeWorkflow(fx.WITH_ENVIRONMENTS);
    const results = await environmentsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ environments: new Set(['production']) }),
    });
    const byJob = new Map(results.map((r) => [r.job, r]));
    const stg = byJob.get('stg')!;
    assert.equal(stg.severity, 'error');
  });

  test('flags case mismatch as warning with exact fix', async () => {
    const wf = makeWorkflow(`name: C
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    environment: Prod
    steps: [{ run: echo }]
`);
    const results = await environmentsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ environments: new Set(['prod']) }),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.ok(results[0].fix?.includes('prod'));
  });

  test('passes when environment exists', async () => {
    const wf = makeWorkflow(fx.WITH_ENVIRONMENTS);
    const results = await environmentsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx({ environments: new Set(['production', 'staging']) }),
    });
    assert.deepEqual(results, []);
  });
});

describe('actionsCheck (local logic only)', () => {
  test('flags deprecated versions and branch pins', async () => {
    const wf = makeWorkflow(fx.WITH_ACTIONS);
    const results = await makeActionsCheck(makePermissiveOctokit()).run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const msgs = messages(results).join('\n');
    assert.ok(msgs.includes('deprecated version "v2"'), `missing deprecation for v2: ${msgs}`);
    assert.ok(msgs.includes('pinned to branch "main"'), `missing branch-pin warning: ${msgs}`);
    for (const r of results) assert.equal(r.severity, 'warning');
  });

  test('passes a clean workflow with current pins', async () => {
    const wf = makeWorkflow(fx.CLEAN_WORKFLOW);
    const results = await makeActionsCheck(makePermissiveOctokit()).run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.deepEqual(results, []);
  });
});

describe('expressionsCheck', () => {
  test('flags unknown function with typo suggestion', async () => {
    const wf = makeWorkflow(fx.WITH_EXPRESSIONS);
    const results = await expressionsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const typo = results.find((r) => r.message.includes('contain'));
    assert.ok(typo, 'should flag contain() as unknown');
    assert.ok(typo.fix?.includes('contains'));
  });

  test('flags empty expression', async () => {
    const wf = makeWorkflow(fx.WITH_EXPRESSIONS);
    const results = await expressionsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const empty = results.find((r) => r.message.includes('Empty expression'));
    assert.ok(empty);
    assert.equal(empty.severity, 'error');
  });

  test('passes on valid expressions', async () => {
    const wf = makeWorkflow(`name: V
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    if: \${{ github.event_name == 'push' }}
    steps:
      - if: \${{ contains(github.ref, 'main') }}
        run: echo
`);
    const results = await expressionsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.deepEqual(results, []);
  });
});

describe('permissionsCheck', () => {
  test('flags write-all at workflow and job levels', async () => {
    const wf = makeWorkflow(fx.WITH_BAD_PERMISSIONS);
    const results = await permissionsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const writeAllWarnings = results.filter((r) => r.message.includes('write-all'));
    assert.ok(writeAllWarnings.length >= 1, 'should flag write-all');
  });

  test('flags invalid scope and invalid value', async () => {
    const wf = makeWorkflow(fx.WITH_BAD_PERMISSIONS);
    const results = await permissionsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const msgs = messages(results).join('\n');
    assert.ok(msgs.includes('bogus-scope'), `should flag invalid scope: ${msgs}`);
    assert.ok(msgs.includes('wrong-value'), `should flag invalid value: ${msgs}`);
  });

  test('passes on a valid explicit permissions block', async () => {
    const wf = makeWorkflow(`name: P
on: push
permissions:
  contents: read
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`);
    const results = await permissionsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.deepEqual(results, []);
  });
});

describe('runnersCheck', () => {
  test('flags deprecated ubuntu-18.04 and macos-10.15', async () => {
    const wf = makeWorkflow(fx.WITH_DEPRECATED_RUNNERS);
    const results = await runnersCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const warnings = results.filter((r) => r.severity === 'warning');
    assert.equal(warnings.length, 2);
    assert.ok(warnings.some((r) => r.message.includes('ubuntu-18.04')));
    assert.ok(warnings.some((r) => r.message.includes('macos-10.15')));
  });

  test('skips dynamic matrix expressions', async () => {
    const wf = makeWorkflow(fx.WITH_DEPRECATED_RUNNERS);
    const results = await runnersCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.ok(!results.some((r) => r.job === 'matrix'), 'matrix should be skipped');
  });

  test('skips self-hosted labels', async () => {
    const wf = makeWorkflow(fx.WITH_DEPRECATED_RUNNERS);
    const results = await runnersCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.ok(!results.some((r) => r.job === 'self'), 'self-hosted should be skipped');
  });

  test('passes on ubuntu-latest', async () => {
    const wf = makeWorkflow(fx.CLEAN_WORKFLOW);
    const results = await runnersCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.deepEqual(results, []);
  });
});

describe('jobsCheck', () => {
  test('detects circular dependencies', async () => {
    const wf = makeWorkflow(fx.WITH_CIRCULAR_NEEDS);
    const results = await jobsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const cycle = results.find((r) => r.message.includes('Circular'));
    assert.ok(cycle, 'should detect cycle');
    assert.equal(cycle.severity, 'error');
    assert.ok(cycle.message.includes('→'));
  });

  test('detects missing needs ref and suggests typo', async () => {
    const wf = makeWorkflow(`name: X
on: push
jobs:
  a:
    needs: bild
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
  build:
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
`);
    const results = await jobsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const missing = results.find((r) => r.message.includes('"bild"'));
    assert.ok(missing);
    assert.equal(missing.job, 'a');
    assert.ok(missing.fix?.includes('build'), 'fix should suggest "build"');
  });

  test('warns on needs pointing to continue-on-error job', async () => {
    const wf = makeWorkflow(fx.WITH_CONTINUE_ON_ERROR_NEEDS);
    const results = await jobsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const coe = results.find((r) => r.message.includes('continue-on-error'));
    assert.ok(coe, 'should warn about continue-on-error dependency');
    assert.equal(coe.severity, 'warning');
    assert.equal(coe.job, 'downstream');
  });

  test('passes on acyclic graph with valid refs', async () => {
    const wf = makeWorkflow(`name: G
on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
  b:
    needs: a
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
`);
    const results = await jobsCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.deepEqual(results, []);
  });
});

describe('syntaxCheck', () => {
  test('reports YAML parse errors as error severity', async () => {
    const wf = makeWorkflow(fx.BROKEN_YAML, 'broken.yml');
    const results = await syntaxCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const parseErr = results.find((r) => r.message.includes('YAML parse error'));
    assert.ok(parseErr);
    assert.equal(parseErr.severity, 'error');
  });

  test('reports missing on: and jobs: keys', async () => {
    const wf = makeWorkflow(fx.MISSING_REQUIRED_KEYS);
    const results = await syntaxCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const msgs = messages(results).join('\n');
    assert.ok(msgs.includes('"on:"'), `missing on: error not found: ${msgs}`);
    assert.ok(msgs.includes('"jobs:"'), `missing jobs: error not found: ${msgs}`);
  });

  test('reports missing runs-on and steps per job', async () => {
    const wf = makeWorkflow(fx.JOB_MISSING_RUNS_ON);
    const results = await syntaxCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const runsOn = results.find((r) => r.message.includes('runs-on'));
    assert.ok(runsOn);
    assert.equal(runsOn.job, 'build');
  });

  test('exempts reusable-workflow jobs from runs-on/steps requirements', async () => {
    const wf = makeWorkflow(fx.REUSABLE_WORKFLOW_CALL);
    const results = await syntaxCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    assert.ok(
      !results.some((r) => r.message.includes('runs-on')),
      'reusable workflow should not trigger runs-on error',
    );
    assert.ok(
      !results.some((r) => r.message.includes('steps')),
      'reusable workflow should not trigger steps error',
    );
  });

  test('warns on missing top-level name', async () => {
    const wf = makeWorkflow(`on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
`);
    const results = await syntaxCheck.run({
      workflows: [wf],
      repo: makeRepoCtx(),
    });
    const nameWarn = results.find((r) => r.message.includes('name'));
    assert.ok(nameWarn);
    assert.equal(nameWarn.severity, 'warning');
  });
});

describe('comprehensive fixture', () => {
  test('exercises multiple checks with expected severity mix', async () => {
    const wf = makeWorkflow(fx.COMPREHENSIVE_BAD, 'comprehensive.yml');
    const ctx = {
      workflows: [wf],
      repo: makeRepoCtx({
        secrets: new Set(['GITHUB_TOKEN']),
        variables: new Set(),
        environments: new Set(['production']),
      }),
    };
    const all: CheckResult[] = [];
    all.push(...(await syntaxCheck.run(ctx)));
    all.push(...(await secretsCheck.run(ctx)));
    all.push(...(await variablesCheck.run(ctx)));
    all.push(...(await environmentsCheck.run(ctx)));
    all.push(...(await expressionsCheck.run(ctx)));
    all.push(...(await permissionsCheck.run(ctx)));
    all.push(...(await runnersCheck.run(ctx)));
    all.push(...(await jobsCheck.run(ctx)));

    const counts = severities(all);
    assert.ok(counts.error > 0, 'expected some errors');
    assert.ok(counts.warning > 0, 'expected some warnings');

    const checkNames = new Set(all.map((r) => r.check));
    for (const expected of [
      'secrets',
      'variables',
      'environments',
      'expressions',
      'permissions',
      'runners',
      'jobs',
      'syntax',
    ]) {
      assert.ok(checkNames.has(expected), `expected a result from ${expected}`);
    }
  });
});
