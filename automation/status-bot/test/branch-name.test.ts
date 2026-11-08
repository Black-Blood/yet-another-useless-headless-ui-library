import { assertEquals } from '@std/assert';
import { parseBranch } from '../src/collect/branch-name.ts';
import { testConfig } from './helpers.ts';

const p = testConfig.branchPrefix;

Deno.test('parseBranch: feature branch', () =>
  assertEquals(parseBranch('feature/46-login-form', p), { kind: 'task', number: 46 }));

Deno.test('parseBranch: fix branch', () => assertEquals(parseBranch('fix/49-modal', p), { kind: 'bug', number: 49 }));

Deno.test('parseBranch: slug is required', () => assertEquals(parseBranch('feature/46', p), null));

Deno.test('parseBranch: hash is not allowed', () => assertEquals(parseBranch('feature/#46-x', p), null));

Deno.test('parseBranch: non-numeric id', () => assertEquals(parseBranch('feature/abc-x', p), null));

Deno.test('parseBranch: other branches', () => {
  for (const b of ['main', 'develop', 'patch-1', 'docs/status-bot-spec']) assertEquals(parseBranch(b, p), null);
});
