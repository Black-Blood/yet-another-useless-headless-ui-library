import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig, loadConfig } from '../src/config.ts';
import { CONFIG_PATH } from './helpers.ts';

const text = readFileSync(CONFIG_PATH, 'utf8');
const withoutKey = (key: string) => text.replace(new RegExp(`^${key}:.*$`, 'm'), '');
const withQa = (qa: string[]) => text.replace(/^qa:\n(  - .*\n)+/m, `qa: ${JSON.stringify(qa)}\n`);
const withoutStatus = (key: string) => text.replace(new RegExp(`^  ${key}:.*$`, 'm'), '');

test('parseConfig: reads the repository config', () => {
  const c = loadConfig(CONFIG_PATH);
  assert.equal(c.project.number, 4);
  assert.equal(c.statuses.inProgress, 'In Progress');
  assert.deepEqual(c.branchPrefix, { task: 'feature', bug: 'fix' });
  assert.equal(c.typeLabels.story, 'User Story');
  assert.deepEqual(c.qa, ['Black-Blood']);
  assert.equal(c.maxChangesPerRun, 30);
  assert.equal(c.historySize, 20);
});

test('parseConfig: missing integrationBranch throws', () =>
  assert.throws(() => parseConfig(withoutKey('integrationBranch')), /integrationBranch/));

test('parseConfig: empty qa throws', () => assert.throws(() => parseConfig(withQa([])), /qa/));

test('parseConfig: missing a status name throws', () =>
  assert.throws(() => parseConfig(withoutStatus('canceled')), /statuses\.canceled/));
