import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWorkflows,
  extractSecretRefs,
  extractVariableRefs,
  extractEnvironmentRefs,
  extractActionRefs,
  extractExpressions,
} from '../src/parser.ts';
import { makeWorkflow, makeTmpRepo, cleanup } from './helpers.ts';
import * as fx from './fixtures.ts';

describe('loadWorkflows', () => {
  test('discovers both .yml and .yaml files', async () => {
    const dir = await makeTmpRepo({
      'ci.yml': fx.CLEAN_WORKFLOW,
      'deploy.yaml': fx.WITH_SECRETS,
    });
    try {
      const wfs = await loadWorkflows(dir);
      assert.equal(wfs.length, 2);
      const names = wfs.map((w) => w.relativePath).sort();
      assert.deepEqual(names, [
        '.github/workflows/ci.yml',
        '.github/workflows/deploy.yaml',
      ]);
      for (const wf of wfs) assert.equal(wf.parseError, undefined);
    } finally {
      await cleanup(dir);
    }
  });

  test('returns parseError for broken YAML without throwing', async () => {
    const dir = await makeTmpRepo({
      'good.yml': fx.CLEAN_WORKFLOW,
      'broken.yml': fx.BROKEN_YAML,
    });
    try {
      const wfs = await loadWorkflows(dir);
      assert.equal(wfs.length, 2);
      const broken = wfs.find((w) => w.relativePath.endsWith('broken.yml'))!;
      const good = wfs.find((w) => w.relativePath.endsWith('good.yml'))!;
      assert.ok(broken.parseError, 'broken.yml should have parseError set');
      assert.equal(good.parseError, undefined);
    } finally {
      await cleanup(dir);
    }
  });

  test('returns empty array when no workflow files exist', async () => {
    const dir = await makeTmpRepo({});
    try {
      const wfs = await loadWorkflows(dir);
      assert.equal(wfs.length, 0);
    } finally {
      await cleanup(dir);
    }
  });
});

describe('extractSecretRefs', () => {
  test('finds workflow-level and step-level secrets with context', () => {
    const wf = makeWorkflow(fx.WITH_SECRETS);
    const refs = extractSecretRefs(wf);

    const names = refs.map((r) => r.name).sort();
    assert.deepEqual(names, ['API_KEY', 'GLOBAL']);

    const global = refs.find((r) => r.name === 'GLOBAL')!;
    assert.equal(global.job, undefined);
    assert.equal(global.step, undefined);

    const apiKey = refs.find((r) => r.name === 'API_KEY')!;
    assert.equal(apiKey.job, 'build');
    assert.equal(apiKey.step, 'Use secret');
  });

  test('returns empty array when no secret refs', () => {
    const wf = makeWorkflow(fx.CLEAN_WORKFLOW);
    assert.deepEqual(extractSecretRefs(wf), []);
  });
});

describe('extractVariableRefs', () => {
  test('finds vars refs with job/step context from step id', () => {
    const wf = makeWorkflow(fx.WITH_VARIABLES);
    const refs = extractVariableRefs(wf);
    assert.equal(refs.length, 2);
    for (const r of refs) {
      assert.equal(r.job, 'build');
      assert.equal(r.step, 'configure');
    }
    const names = refs.map((r) => r.name).sort();
    assert.deepEqual(names, ['NODE_VERSION', 'REGION']);
  });
});

describe('extractEnvironmentRefs', () => {
  test('handles string, object, and skips dynamic refs', () => {
    const wf = makeWorkflow(fx.WITH_ENVIRONMENTS);
    const refs = extractEnvironmentRefs(wf);
    const byJob = new Map(refs.map((r) => [r.job, r.name]));
    assert.equal(byJob.get('prod'), 'production');
    assert.equal(byJob.get('stg'), 'staging');
    assert.equal(byJob.has('dynamic'), false, 'dynamic ref should be skipped');
  });
});

describe('extractActionRefs', () => {
  test('skips local (./) and docker:// refs', () => {
    const wf = makeWorkflow(fx.WITH_ACTIONS);
    const refs = extractActionRefs(wf);
    const actionRefs = refs.map((r) => r.ref).sort();
    assert.deepEqual(actionRefs, [
      'actions/checkout@v4',
      'actions/setup-node@v2',
      'actions/upload-artifact@main',
    ]);
    for (const r of refs) assert.equal(r.job, 'build');
  });
});

describe('extractExpressions', () => {
  test('returns every ${{ }} with line numbers and job context', () => {
    const wf = makeWorkflow(fx.WITH_EXPRESSIONS);
    const exprs = extractExpressions(wf);
    assert.ok(exprs.length >= 4, `got ${exprs.length} expressions`);
    const empty = exprs.find((e) => e.expr === '');
    assert.ok(empty, 'empty expression should be captured');
    assert.equal(empty.job, 'j');
    for (const e of exprs) assert.ok(e.line > 0);
  });
});
