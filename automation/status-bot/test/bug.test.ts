import { assertEquals } from '@std/assert';
import { bugStatus } from '../src/rules/bug.ts';
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
const merged = [pull({ number: 52, state: 'merged', mergedAt: '2026-11-02T00:00:00Z', headRef: 'fix/49-x' })];

Deno.test('bugStatus: merged → In Review (verification)', () =>
  assertEquals(bugStatus(work({ activeMerged: merged })), {
    status: 'inReview',
    reason: 'PR #52 merged into develop — awaiting verification',
    verification: true,
  }));

Deno.test('bugStatus: open ready PR → In Review (code review)', () =>
  assertEquals(bugStatus(work({ openReady: [52] })), {
    status: 'inReview',
    reason: 'PR #52 opened (not draft)',
    verification: false,
  }));

Deno.test('bugStatus: draft + merged → In Progress', () =>
  assertEquals(bugStatus(work({ openDraft: [53], activeMerged: merged })), {
    status: 'inProgress',
    reason: 'draft PR #53 open',
    verification: false,
  }));

Deno.test('bugStatus: branch only → In Progress', () =>
  assertEquals(bugStatus(work({ branches: ['fix/49-x'] })).status, 'inProgress'));

Deno.test('bugStatus: nothing → New', () => assertEquals(bugStatus(work({})).status, 'new'));
