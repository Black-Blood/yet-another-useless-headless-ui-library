import { assertEquals } from '@std/assert';
import { parseBranch } from '../src/collect/branch-name.ts';
import { testConfig } from './helpers.ts';

const p = testConfig.branchPrefix;

Deno.test('parseBranch: feature branch', () =>
  assertEquals(parseBranch('feat/46-login-form', p), { kind: 'task', number: 46 }));

Deno.test('parseBranch: fix branch', () => assertEquals(parseBranch('fix/49-modal', p), { kind: 'bug', number: 49 }));

Deno.test('parseBranch: slug is required', () => assertEquals(parseBranch('feat/46', p), null));

Deno.test('parseBranch: hash is not allowed', () => assertEquals(parseBranch('feat/#46-x', p), null));

Deno.test('parseBranch: non-numeric id', () => assertEquals(parseBranch('feat/abc-x', p), null));

Deno.test('parseBranch: other branches', () => {
  for (const b of ['main', 'develop', 'patch-1', 'docs/status-bot-spec']) assertEquals(parseBranch(b, p), null);
});

Deno.test('parseBranch: GitHub "Create a branch" names without a prefix', () =>
  assertEquals(parseBranch('2-test-status-bot', p), { kind: null, number: 2 }));

Deno.test('parseBranch: other prefixes are not accepted', () => {
  for (const b of ['chore/2-x', 'revert-4-feat/2-x', 'release/2-x', 'feature/2-x']) assertEquals(parseBranch(b, p), null);
});
