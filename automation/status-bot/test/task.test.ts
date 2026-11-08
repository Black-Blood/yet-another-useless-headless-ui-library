import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskStatus } from '../src/rules/task.ts';
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
const merged = [pull({ number: 52, state: 'merged', mergedAt: '2026-11-02T00:00:00Z' })];

test('taskStatus: open ready PR → In Review', () =>
  assert.deepEqual(taskStatus(work({ openReady: [52] })), { status: 'inReview', reason: 'PR #52 opened (not draft)' }));

test('taskStatus: draft PR → In Progress', () =>
  assert.deepEqual(taskStatus(work({ openDraft: [52] })), { status: 'inProgress', reason: 'draft PR #52 open' }));

test('taskStatus: merged → Done', () =>
  assert.deepEqual(taskStatus(work({ activeMerged: merged })), { status: 'done', reason: 'PR #52 merged into develop' }));

test('taskStatus: branch only → In Progress', () =>
  assert.deepEqual(taskStatus(work({ branches: ['feature/46-x'] })), {
    status: 'inProgress',
    reason: 'branch feature/46-x exists',
  }));

test('taskStatus: nothing → New', () =>
  assert.deepEqual(taskStatus(work({})), { status: 'new', reason: 'no branches or pull requests' }));

test('taskStatus: open ready + merged → In Review', () =>
  assert.equal(taskStatus(work({ openReady: [53], activeMerged: merged })).status, 'inReview'));

test('taskStatus: draft + merged → In Progress', () =>
  assert.equal(taskStatus(work({ openDraft: [53], activeMerged: merged })).status, 'inProgress'));

test('taskStatus: merged + leftover branch → Done', () =>
  assert.equal(taskStatus(work({ activeMerged: merged, branches: ['feature/46-x'] })).status, 'done'));
