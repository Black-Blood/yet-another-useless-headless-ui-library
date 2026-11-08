import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranch } from '../src/collect/branch-name.ts';
import { testConfig } from './helpers.ts';

const p = testConfig.branchPrefix;

test('parseBranch: feature branch', () =>
  assert.deepEqual(parseBranch('feature/46-login-form', p), { kind: 'task', number: 46 }));

test('parseBranch: fix branch', () => assert.deepEqual(parseBranch('fix/49-modal', p), { kind: 'bug', number: 49 }));

test('parseBranch: slug is required', () => assert.equal(parseBranch('feature/46', p), null));

test('parseBranch: hash is not allowed', () => assert.equal(parseBranch('feature/#46-x', p), null));

test('parseBranch: non-numeric id', () => assert.equal(parseBranch('feature/abc-x', p), null));

test('parseBranch: other branches', () => {
  for (const b of ['main', 'develop', 'patch-1', 'docs/status-bot-spec']) assert.equal(parseBranch(b, p), null);
});
