import { assertEquals } from '@std/assert';
import { buildPlan, planAdditions, planIssue, withAddedItems } from '../src/apply/plan.ts';
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
  reason: 'branch feat/46-x exists',
  warnings: [],
  ...p,
});
const body = renderCard(m, 'branch feat/46-x exists', [], testConfig.statuses);
const inSync = (p: Partial<IssueFacts> = {}) =>
  issue({ number: 46, projectStatus: 'inProgress', card: { commentId: 7, body, marker: m }, ...p });
const kinds = (a: Action[]) => a.map((x) => x.kind);

Deno.test('planIssue: nothing to do when everything matches', () =>
  assertEquals(planIssue(inSync(), desired(), testConfig), []));

Deno.test('planIssue: action order — assignees before the card, so a failed write is retried', () => {
  const current = inSync({
    projectStatus: 'new',
    state: { open: false, reason: 'completed' },
    assignees: ['a'],
    card: { commentId: 7, body: 'old', marker: m },
  });
  assertEquals(kinds(planIssue(current, desired({ assignees: ['b'] }), testConfig)), [
    'setAssignees',
    'writeCard',
    'setStatus',
    'setState',
  ]);
});

Deno.test('planIssue: sets status when project status is null', () =>
  assertEquals(planIssue(inSync({ projectStatus: null }), desired(), testConfig), [
    { kind: 'setStatus', issue: 46, itemId: 'PVTI_46', status: 'inProgress' },
  ]));

Deno.test('planIssue: creates the card when there is none', () =>
  assertEquals(planIssue(inSync({ card: null }), desired(), testConfig), [
    { kind: 'writeCard', issue: 46, commentId: null, body },
  ]));

Deno.test('planIssue: null fields produce no action', () =>
  assertEquals(
    planIssue(inSync({ projectStatus: 'done', state: { open: false, reason: 'completed' } }), desired({ status: null, state: null }), testConfig),
    [],
  ));

Deno.test('planIssue: assignee order does not matter', () =>
  assertEquals(planIssue(inSync({ assignees: ['a', 'b'] }), desired({ assignees: ['b', 'a'] }), testConfig), []));

Deno.test('planAdditions: only open issues by members that are not in the project', () => {
  const f = facts([
    issue({ number: 1, itemId: null }),
    issue({ number: 2, itemId: null, authorIsMember: false }),
    issue({ number: 3, itemId: null, state: { open: false, reason: 'completed' } }),
    issue({ number: 4 }),
  ]);
  assertEquals(planAdditions(f), [{ kind: 'addToProject', issue: 1, nodeId: 'I_1' }]);
});

const writes = (n: number): Action[][] =>
  Array.from({ length: n }, (_, i) => [{ kind: 'writeCard', issue: i + 1, commentId: null, body: 'x' }]);

Deno.test('buildPlan: 31 changed issues are blocked', () => {
  const p = buildPlan([...writes(31), []], 30, false);
  assertEquals(p.changedIssues, 31);
  assertEquals(p.blocked, true);
});

Deno.test('buildPlan: force overrides the limit', () => assertEquals(buildPlan(writes(31), 30, true).blocked, false));

Deno.test('buildPlan: 30 changed issues pass', () => {
  const p = buildPlan(writes(30), 30, false);
  assertEquals(p.blocked, false);
  assertEquals(p.actions.length, 30);
});

Deno.test('withAddedItems: newly added issues get their item id and no status', () => {
  const before = facts([issue({ number: 1, itemId: null, projectStatus: null }), issue({ number: 2 })]);
  const after = withAddedItems(before, [{ issue: 1, itemId: 'PVTI_new' }]);
  assertEquals(after.issues.get(1)?.itemId, 'PVTI_new');
  assertEquals(after.issues.get(1)?.projectStatus, null);
  assertEquals(after.issues.get(2), before.issues.get(2));
  assertEquals(before.issues.get(1)?.itemId, null, 'the input is not mutated');
});
