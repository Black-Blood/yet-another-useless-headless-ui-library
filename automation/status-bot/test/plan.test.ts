import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, planAdditions, planIssue } from '../src/apply/plan.ts';
import { renderCard } from '../src/collect/marker.ts';
import type { Action, Desired, IssueFacts } from '../src/types.ts';
import { facts, issue, marker, testConfig } from './helpers.ts';

const m = marker({ status: 'inProgress' });
const desired = (p: Partial<Desired> = {}): Desired => ({
  number: 46,
  status: 'inProgress',
  state: { open: true, reason: null },
  assignees: null,
  marker: m,
  reason: 'branch feature/46-x exists',
  warnings: [],
  ...p,
});
const body = renderCard(m, 'branch feature/46-x exists', [], testConfig.statuses);
const inSync = (p: Partial<IssueFacts> = {}) =>
  issue({ number: 46, projectStatus: 'inProgress', card: { commentId: 7, body, marker: m }, ...p });
const kinds = (a: Action[]) => a.map((x) => x.kind);

test('planIssue: nothing to do when everything matches', () =>
  assert.deepEqual(planIssue(inSync(), desired(), testConfig), []));

test('planIssue: action order', () => {
  const current = inSync({
    projectStatus: 'new',
    state: { open: false, reason: 'completed' },
    assignees: ['a'],
    card: { commentId: 7, body: 'old', marker: m },
  });
  assert.deepEqual(kinds(planIssue(current, desired({ assignees: ['b'] }), testConfig)), [
    'writeCard',
    'setStatus',
    'setState',
    'setAssignees',
  ]);
});

test('planIssue: sets status when project status is null', () =>
  assert.deepEqual(planIssue(inSync({ projectStatus: null }), desired(), testConfig), [
    { kind: 'setStatus', issue: 46, itemId: 'PVTI_46', status: 'inProgress' },
  ]));

test('planIssue: creates the card when there is none', () =>
  assert.deepEqual(planIssue(inSync({ card: null }), desired(), testConfig), [
    { kind: 'writeCard', issue: 46, commentId: null, body },
  ]));

test('planIssue: null fields produce no action', () =>
  assert.deepEqual(
    planIssue(inSync({ projectStatus: 'done', state: { open: false, reason: 'completed' } }), desired({ status: null, state: null }), testConfig),
    [],
  ));

test('planIssue: assignee order does not matter', () =>
  assert.deepEqual(planIssue(inSync({ assignees: ['a', 'b'] }), desired({ assignees: ['b', 'a'] }), testConfig), []));

test('planAdditions: only open issues by members that are not in the project', () => {
  const f = facts([
    issue({ number: 1, itemId: null }),
    issue({ number: 2, itemId: null, authorIsMember: false }),
    issue({ number: 3, itemId: null, state: { open: false, reason: 'completed' } }),
    issue({ number: 4 }),
  ]);
  assert.deepEqual(planAdditions(f), [{ kind: 'addToProject', issue: 1, nodeId: 'I_1' }]);
});

const writes = (n: number): Action[][] =>
  Array.from({ length: n }, (_, i) => [{ kind: 'writeCard', issue: i + 1, commentId: null, body: 'x' }]);

test('buildPlan: 31 changed issues are blocked', () => {
  const p = buildPlan([...writes(31), []], 30, false);
  assert.equal(p.changedIssues, 31);
  assert.equal(p.blocked, true);
});

test('buildPlan: force overrides the limit', () => assert.equal(buildPlan(writes(31), 30, true).blocked, false));

test('buildPlan: 30 changed issues pass', () => {
  const p = buildPlan(writes(30), 30, false);
  assert.equal(p.blocked, false);
  assert.equal(p.actions.length, 30);
});
