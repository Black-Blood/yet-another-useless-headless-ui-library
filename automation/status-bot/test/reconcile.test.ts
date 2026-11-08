import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/rules/reconcile.ts';
import { stateFor } from '../src/rules/manual.ts';
import type { Desired, Facts, IssueFacts, Marker, Status } from '../src/types.ts';
import { branch, facts, issue, marker, pull, testConfig } from './helpers.ts';

const AT = '2026-11-05T00:00:00Z';
const LATER = '2026-11-06T00:00:00Z';
const EARLIER = '2026-11-04T00:00:00Z';
const NOW = '2026-11-08T12:00:00Z';

/** An issue whose card, project status and open/closed state all agree on `status`. */
const carded = (number: number, status: Status, p: Partial<IssueFacts> = {}, m: Partial<Marker> = {}) =>
  issue({
    number,
    projectStatus: status,
    projectStatusUpdatedAt: EARLIER,
    state: stateFor(status),
    card: { commentId: number, body: '', marker: marker({ status, at: AT, ...m }) },
    ...p,
  });
const run = (f: Facts) => new Map(reconcile(f, testConfig).map((d) => [d.number, d]));
const one = (f: Facts, n: number): Desired => {
  const d = run(f).get(n);
  assert.ok(d, `no desired state for #${n}`);
  return d;
};
const mergedPr = (number: number, headRef: string, p = {}) =>
  pull({ number, headRef, state: 'merged', mergedAt: EARLIER, ...p });

test('reconcile: new task gets a card with a first history entry', () => {
  const d = one(facts([issue({ number: 46 })]), 46);
  assert.equal(d.status, 'new');
  assert.deepEqual(d.state, { open: true, reason: null });
  assert.equal(d.marker.at, NOW);
  assert.deepEqual(d.marker.history, [{ at: NOW, from: null, to: 'new', reason: 'no branches or pull requests' }]);
});

test('reconcile: unchanged state keeps marker.at', () => {
  const i = carded(46, 'new');
  assert.deepEqual(one(facts([i]), 46).marker, i.card!.marker);
});

test('reconcile: branch moves task to In Progress', () => {
  const d = one(facts([carded(46, 'new')], [], [branch('feature/46-x')]), 46);
  assert.equal(d.status, 'inProgress');
  assert.deepEqual(d.marker.history[0], { at: NOW, from: 'new', to: 'inProgress', reason: 'branch feature/46-x exists' });
});

test('reconcile: forbidden manual change is reverted', () => {
  const i = carded(46, 'new', { projectStatus: 'done', projectStatusUpdatedAt: LATER, projectStatusUpdatedBy: 'ann' });
  const d = one(facts([i]), 46);
  assert.equal(d.status, 'new');
  assert.match(d.marker.history[0].reason, /^reverted manual change to Done/);
});

test('reconcile: cancel with merged code is reverted', () => {
  const i = carded(46, 'done', { projectStatus: 'canceled', projectStatusUpdatedAt: LATER });
  const d = one(facts([i], [mergedPr(52, 'feature/46-x')]), 46);
  assert.equal(d.status, 'done');
  assert.match(d.marker.history[0].reason, /revert PR #52 first/);
});

test('reconcile: merged bug goes to verification and QA is assigned', () => {
  const i = carded(49, 'inProgress', { type: 'bug', author: 'stranger' });
  const d = one(facts([i], [mergedPr(52, 'fix/49-x')]), 49);
  assert.equal(d.status, 'inReview');
  assert.deepEqual(d.assignees, ['Black-Blood']);
  assert.equal(d.marker.verifyAssigned, true);
});

test('reconcile: QA is not reassigned on the next run', () => {
  const i = carded(49, 'inReview', { type: 'bug', assignees: ['someone'] }, { verifyAssigned: true });
  const d = one(facts([i], [mergedPr(52, 'fix/49-x')]), 49);
  assert.equal(d.status, 'inReview');
  assert.equal(d.assignees, null);
});

test('reconcile: QA sends the bug back', () => {
  const pulls = [mergedPr(52, 'fix/49-x', { author: 'dev' })];
  const i = carded(
    49,
    'inReview',
    { type: 'bug', projectStatus: 'new', projectStatusUpdatedAt: LATER, projectStatusUpdatedBy: 'Black-Blood' },
    { verifyAssigned: true },
  );
  const d = one(facts([i], pulls), 49);
  assert.equal(d.status, 'new');
  assert.equal(d.marker.source, 'manual');
  assert.equal(d.marker.epoch, LATER);
  assert.equal(d.marker.verifyAssigned, false);
  assert.deepEqual(d.assignees, ['dev']);

  const next = carded(49, 'new', { type: 'bug', projectStatusUpdatedAt: LATER }, d.marker);
  assert.equal(one(facts([next], pulls), 49).status, 'new');
});

test('reconcile: accepted manual change records who made it', () => {
  const i = carded(46, 'canceled', { projectStatus: 'new', projectStatusUpdatedAt: LATER, projectStatusUpdatedBy: 'ann' });
  const d = one(facts([i]), 46);
  assert.equal(d.status, 'new');
  assert.equal(d.marker.history[0].reason, 'changed manually by @ann');
});

test('reconcile: story flow', () => {
  const task = issue({ number: 46, parent: 10 });
  const pulls = [mergedPr(52, 'feature/46-x')];
  const story = (status: Status, m: Partial<Marker> = {}, children = [46]) =>
    carded(10, status, { type: 'story', children }, m);

  assert.equal(one(facts([task, story('inProgress')], pulls), 10).status, 'inReview');
  assert.equal(one(facts([task, story('done', { source: 'manual' })], pulls), 10).status, 'done');
  const bug = issue({ number: 49, type: 'bug', parent: 10 });
  assert.equal(one(facts([task, bug, story('done', { source: 'manual' }, [46, 49])], pulls), 10).status, 'inReview');
});

test('reconcile: use case closes in the same run as its last story', () => {
  const f = facts(
    [
      issue({ number: 46, parent: 10 }),
      carded(10, 'done', { type: 'story', children: [46], parent: 5 }, { source: 'manual' }),
      carded(5, 'inProgress', { type: 'usecase', children: [10] }),
    ],
    [mergedPr(52, 'feature/46-x')],
  );
  assert.equal(one(f, 5).status, 'done');
});

test('reconcile: change request follows blocked-by stories', () => {
  const f = facts(
    [
      issue({ number: 46, parent: 10 }),
      carded(10, 'done', { type: 'story', children: [46] }, { source: 'manual' }),
      carded(7, 'inProgress', { type: 'cr', blockedBy: [10] }),
    ],
    [mergedPr(52, 'feature/46-x')],
  );
  assert.equal(one(f, 7).status, 'done');
});

test('reconcile: canceled is sticky', () =>
  assert.equal(one(facts([carded(46, 'canceled')], [], [branch('feature/46-x')]), 46).status, 'canceled'));

test('reconcile: issue without a type label is left alone', () => {
  const d = one(facts([issue({ number: 46, type: null, typeProblem: 'no type label' })]), 46);
  assert.equal(d.status, null);
  assert.equal(d.state, null);
  assert.deepEqual(d.warnings, ['no type label']);
});

test('reconcile: type change keeps epoch and recomputes', () => {
  const i = carded(46, 'new', { type: 'bug' }, { source: 'manual', epoch: AT });
  const d = one(facts([i], [pull({ number: 53, headRef: 'fix/46-x' })]), 46);
  assert.equal(d.status, 'inReview');
  assert.equal(d.marker.epoch, AT);
});

test('reconcile: ignores wrong child types with a warning', () => {
  const f = facts([
    carded(10, 'new', { type: 'story', children: [5] }),
    carded(5, 'new', { type: 'usecase', parent: 10 }),
  ]);
  assert.match(one(f, 10).warnings.join('\n'), /Child #5 is a use case; only tasks and bugs count here — ignored/);
});

test('reconcile: canceled story lists children that are not canceled', () => {
  const f = facts([issue({ number: 46, parent: 10 }), carded(10, 'canceled', { type: 'story', children: [46] })]);
  assert.match(one(f, 10).warnings.join('\n'), /Children not canceled: #46/);
});

test('reconcile: cancel of a story is guarded by its children\'s code', () => {
  const f = facts(
    [
      issue({ number: 46, parent: 10 }),
      carded(10, 'inReview', { type: 'story', children: [46], projectStatus: 'canceled', projectStatusUpdatedAt: LATER }),
    ],
    [mergedPr(52, 'feature/46-x')],
  );
  const d = one(f, 10);
  assert.equal(d.status, 'inReview');
  assert.match(d.marker.history[0].reason, /#52/);
});
