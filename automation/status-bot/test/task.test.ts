import { assertEquals } from '@std/assert';
import { taskStatus } from '../src/rules/task.ts';
import type { Work } from '../src/rules/work.ts';
import { pull } from './helpers.ts';

const work = (w: Partial<Work>): Work => ({
  openReady: [],
  openDraft: [],
  activeMerged: [],
  allActiveMerged: [],
  branches: [],
  reverted: [],
  warnings: [],
  ...w,
});
const merged = [pull({ number: 52, state: 'merged', mergedAt: '2026-11-02T00:00:00Z' })];

Deno.test('taskStatus: open ready PR → In Review', () =>
  assertEquals(taskStatus(work({ openReady: [52] })), { status: 'inReview', reason: 'PR #52 opened (not draft)' }));

Deno.test('taskStatus: draft PR → In Progress', () =>
  assertEquals(taskStatus(work({ openDraft: [52] })), { status: 'inProgress', reason: 'draft PR #52 open' }));

Deno.test('taskStatus: merged → Done', () =>
  assertEquals(taskStatus(work({ activeMerged: merged })), { status: 'done', reason: 'PR #52 merged into develop' }));

Deno.test('taskStatus: branch only → In Progress', () =>
  assertEquals(taskStatus(work({ branches: ['feat/46-x'] })), {
    status: 'inProgress',
    reason: 'branch feat/46-x exists',
  }));

Deno.test('taskStatus: nothing → New', () =>
  assertEquals(taskStatus(work({})), { status: 'new', reason: 'no branches or pull requests' }));

Deno.test('taskStatus: open ready + merged → In Review', () =>
  assertEquals(taskStatus(work({ openReady: [53], activeMerged: merged })).status, 'inReview'));

Deno.test('taskStatus: draft + merged → In Progress', () =>
  assertEquals(taskStatus(work({ openDraft: [53], activeMerged: merged })).status, 'inProgress'));

Deno.test('taskStatus: merged + leftover branch → Done', () =>
  assertEquals(taskStatus(work({ activeMerged: merged, branches: ['feat/46-x'] })).status, 'done'));

Deno.test('taskStatus: nothing left after a revert → New, naming the reverted PR', () =>
  assertEquals(taskStatus(work({ reverted: [4] })), { status: 'new', reason: 'PR #4 reverted' }));

Deno.test('taskStatus: a branch after a revert still means In Progress', () =>
  assertEquals(taskStatus(work({ reverted: [4], branches: ['feat/46-again'] })).status, 'inProgress'));
