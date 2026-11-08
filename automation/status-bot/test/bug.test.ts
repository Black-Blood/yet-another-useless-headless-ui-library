import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bugStatus } from '../src/rules/bug.ts';
import type { Work } from '../src/rules/work.ts';
import { pull } from './helpers.ts';

const work = (w: Partial<Work>): Work => ({
  openReady: [],
  openDraft: [],
  activeMerged: [],
  allActiveMerged: [],
  branches: [],
  warnings: [],
  ...w,
});
const merged = [pull({ number: 52, state: 'merged', mergedAt: '2026-11-02T00:00:00Z', headRef: 'fix/49-x' })];

test('bugStatus: merged → In Review (verification)', () =>
  assert.deepEqual(bugStatus(work({ activeMerged: merged })), {
    status: 'inReview',
    reason: 'PR #52 merged into develop — awaiting verification',
    verification: true,
  }));

test('bugStatus: open ready PR → In Review (code review)', () =>
  assert.deepEqual(bugStatus(work({ openReady: [52] })), {
    status: 'inReview',
    reason: 'PR #52 opened (not draft)',
    verification: false,
  }));

test('bugStatus: draft + merged → In Progress', () =>
  assert.deepEqual(bugStatus(work({ openDraft: [53], activeMerged: merged })), {
    status: 'inProgress',
    reason: 'draft PR #53 open',
    verification: false,
  }));

test('bugStatus: branch only → In Progress', () =>
  assert.equal(bugStatus(work({ branches: ['fix/49-x'] })).status, 'inProgress'));

test('bugStatus: nothing → New', () => assert.equal(bugStatus(work({})).status, 'new'));
