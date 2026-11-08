import { assert, assertEquals, assertMatch } from '@std/assert';
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
  assert(d, `no desired state for #${n}`);
  return d;
};
const mergedPr = (number: number, headRef: string, p = {}) =>
  pull({ number, headRef, state: 'merged', mergedAt: EARLIER, ...p });

Deno.test('reconcile: new task gets a card with a first history entry', () => {
  const d = one(facts([issue({ number: 46 })]), 46);
  assertEquals(d.status, 'new');
  assertEquals(d.state, { open: true, reason: null });
  assertEquals(d.marker.at, NOW);
  assertEquals(d.marker.history, [{ at: NOW, from: null, to: 'new', reason: 'no branches or pull requests' }]);
});

Deno.test('reconcile: unchanged state keeps marker.at', () => {
  const i = carded(46, 'new');
  assertEquals(one(facts([i]), 46).marker, i.card!.marker);
});

Deno.test('reconcile: branch moves task to In Progress', () => {
  const d = one(facts([carded(46, 'new')], [], [branch('feature/46-x')]), 46);
  assertEquals(d.status, 'inProgress');
  assertEquals(d.marker.history[0], { at: NOW, from: 'new', to: 'inProgress', reason: 'branch feature/46-x exists' });
});

Deno.test('reconcile: forbidden manual change is reverted', () => {
  const i = carded(46, 'new', { projectStatus: 'done', projectStatusUpdatedAt: LATER, projectStatusUpdatedBy: 'ann' });
  const d = one(facts([i]), 46);
  assertEquals(d.status, 'new');
  assertMatch(d.marker.history[0].reason, /^reverted manual change to Done/);
});

Deno.test('reconcile: cancel with merged code is reverted', () => {
  const i = carded(46, 'done', { projectStatus: 'canceled', projectStatusUpdatedAt: LATER });
  const d = one(facts([i], [mergedPr(52, 'feature/46-x')]), 46);
  assertEquals(d.status, 'done');
  assertMatch(d.marker.history[0].reason, /revert PR #52 first/);
});

Deno.test('reconcile: merged bug goes to verification and QA is assigned', () => {
  const i = carded(49, 'inProgress', { type: 'bug', author: 'stranger' });
  const d = one(facts([i], [mergedPr(52, 'fix/49-x')]), 49);
  assertEquals(d.status, 'inReview');
  assertEquals(d.assignees, ['Black-Blood']);
  assertEquals(d.marker.verifyAssigned, true);
});

Deno.test('reconcile: QA is not reassigned on the next run', () => {
  const i = carded(49, 'inReview', { type: 'bug', assignees: ['someone'] }, { verifyAssigned: true });
  const d = one(facts([i], [mergedPr(52, 'fix/49-x')]), 49);
  assertEquals(d.status, 'inReview');
  assertEquals(d.assignees, null);
});

Deno.test('reconcile: QA sends the bug back', () => {
  const pulls = [mergedPr(52, 'fix/49-x', { author: 'dev' })];
  const i = carded(
    49,
    'inReview',
    { type: 'bug', projectStatus: 'new', projectStatusUpdatedAt: LATER, projectStatusUpdatedBy: 'Black-Blood' },
    { verifyAssigned: true },
  );
  const d = one(facts([i], pulls), 49);
  assertEquals(d.status, 'new');
  assertEquals(d.marker.source, 'manual');
  assertEquals(d.marker.epoch, LATER);
  assertEquals(d.marker.verifyAssigned, false);
  assertEquals(d.assignees, ['dev']);

  const next = carded(49, 'new', { type: 'bug', projectStatusUpdatedAt: LATER }, d.marker);
  assertEquals(one(facts([next], pulls), 49).status, 'new');
});

Deno.test('reconcile: accepted manual change records who made it', () => {
  const i = carded(46, 'canceled', { projectStatus: 'new', projectStatusUpdatedAt: LATER, projectStatusUpdatedBy: 'ann' });
  const d = one(facts([i]), 46);
  assertEquals(d.status, 'new');
  assertEquals(d.marker.history[0].reason, 'changed manually by @ann');
});

Deno.test('reconcile: story flow', () => {
  const task = issue({ number: 46, parent: 10 });
  const pulls = [mergedPr(52, 'feature/46-x')];
  const story = (status: Status, m: Partial<Marker> = {}, children = [46]) =>
    carded(10, status, { type: 'story', children }, m);

  assertEquals(one(facts([task, story('inProgress')], pulls), 10).status, 'inReview');
  assertEquals(one(facts([task, story('done', { source: 'manual', held: 'done', epoch: AT })], pulls), 10).status, 'done');
  const bug = issue({ number: 49, type: 'bug', parent: 10 });
  assertEquals(one(facts([task, bug, story('done', { source: 'manual', held: 'done', epoch: AT }, [46, 49])], pulls), 10).status, 'inReview');
});

Deno.test('reconcile: use case closes in the same run as its last story', () => {
  const f = facts(
    [
      issue({ number: 46, parent: 10 }),
      carded(10, 'done', { type: 'story', children: [46], parent: 5 }, { source: 'manual', held: 'done', epoch: AT }),
      carded(5, 'inProgress', { type: 'usecase', children: [10] }),
    ],
    [mergedPr(52, 'feature/46-x')],
  );
  assertEquals(one(f, 5).status, 'done');
});

Deno.test('reconcile: change request follows blocked-by stories', () => {
  const f = facts(
    [
      issue({ number: 46, parent: 10 }),
      carded(10, 'done', { type: 'story', children: [46] }, { source: 'manual', held: 'done', epoch: AT }),
      carded(7, 'inProgress', { type: 'cr', blockedBy: [10] }),
    ],
    [mergedPr(52, 'feature/46-x')],
  );
  assertEquals(one(f, 7).status, 'done');
});

Deno.test('reconcile: canceled is sticky', () =>
  assertEquals(one(facts([carded(46, 'canceled')], [], [branch('feature/46-x')]), 46).status, 'canceled'));



Deno.test('reconcile: an unmerged PR no longer undoes an accepted bug Done', () => {
  const accepted = { held: 'done' as const, source: 'manual' as const, epoch: AT };
  const bug = (m: Partial<Marker>, status: Status) => carded(49, status, { type: 'bug' }, m);
  const prOpen = pull({ number: 70, headRef: 'fix/49-again', createdAt: LATER });
  const afterOpen = one(facts([bug(accepted, 'done')], [prOpen]), 49);
  assertEquals(afterOpen.status, 'inReview');
  const closed = { ...prOpen, state: 'closed' as const };
  assertEquals(one(facts([bug(afterOpen.marker, 'inReview')], [closed]), 49).status, 'done');
});

Deno.test('reconcile: outsider PRs do not touch a Done task', () => {
  const fork = pull({ number: 71, headRef: 'patch-1', closingIssues: [46], author: 'stranger', authorIsMember: false });
  const d = one(facts([carded(46, 'done')], [mergedPr(52, 'feature/46-x'), fork]), 46);
  assertEquals(d.status, 'done');
});

Deno.test('reconcile: member PRs still reopen a Done task', () => {
  const pr = pull({ number: 72, headRef: 'feature/46-more' });
  assertEquals(one(facts([carded(46, 'done')], [mergedPr(52, 'feature/46-x'), pr]), 46).status, 'inReview');
});

Deno.test('reconcile: an accepted story Done survives a task PR opened and closed', () => {
  const task = (status: Status) => carded(46, status, { parent: 10 });
  const merged = mergedPr(52, 'feature/46-x');
  const prOpen = pull({ number: 73, headRef: 'feature/46-more', createdAt: LATER });
  const story = (m: Partial<Marker>, status: Status) => carded(10, status, { type: 'story', children: [46] }, m);
  const first = one(facts([task('done'), story({ held: 'done', source: 'manual', epoch: AT }, 'done')], [merged, prOpen]), 10);
  assertEquals(first.status, 'inProgress');
  const closed = { ...prOpen, state: 'closed' as const };
  assertEquals(one(facts([task('done'), story(first.marker, 'inProgress')], [merged, closed]), 10).status, 'done');
});

Deno.test('reconcile: a bug created after the story was accepted needs a new manual Done', () => {
  const f = facts([
    carded(46, 'done', { parent: 10 }),
    // QA already accepted this bug as Done, so the bug itself stays Done
    carded(49, 'done', { type: 'bug', parent: 10, createdAt: LATER }, { held: 'done', source: 'manual', epoch: LATER }),
    carded(10, 'done', { type: 'story', children: [46, 49] }, { held: 'done', source: 'manual', epoch: AT }),
  ], [mergedPr(52, 'feature/46-x')]);
  assertEquals(one(f, 10).status, 'inReview');
});

Deno.test('reconcile: code merged into a child after acceptance needs a new manual Done', () => {
  const f = facts([
    carded(46, 'done', { parent: 10 }),
    carded(10, 'done', { type: 'story', children: [46] }, { held: 'done', source: 'manual', epoch: AT }),
  ], [mergedPr(52, 'feature/46-x', { mergedAt: LATER })]);
  assertEquals(one(f, 10).status, 'inReview');
});

Deno.test('reconcile: cancel guard ignores code of blockers that are not stories or use cases', () => {
  const f = facts(
    [
      carded(20, 'canceled', { type: 'story' }),
      carded(10, 'done'),
      carded(30, 'inProgress', { type: 'cr', blockedBy: [20, 10], projectStatus: 'canceled', projectStatusUpdatedAt: LATER }),
    ],
    [mergedPr(99, 'feature/10-x')],
  );
  assertEquals(one(f, 30).status, 'canceled');
});

Deno.test('reconcile: cancel guard ignores code of a task placed directly under a use case', () => {
  const f = facts(
    [
      carded(46, 'done', { parent: 5 }),
      carded(5, 'new', { type: 'usecase', children: [46], projectStatus: 'canceled', projectStatusUpdatedAt: LATER }),
    ],
    [mergedPr(52, 'feature/46-x')],
  );
  assertEquals(one(f, 5).status, 'canceled');
});

Deno.test('reconcile: cancel guard sees code merged from a wrong-prefix branch', () => {
  const i = carded(46, 'new', { projectStatus: 'canceled', projectStatusUpdatedAt: LATER });
  const d = one(facts([i], [mergedPr(52, 'fix/46-x')]), 46);
  assertEquals(d.status, 'new');
  assertMatch(d.marker.history[0].reason, /revert PR #52 first/);
});

Deno.test('reconcile: issue without a type label is left alone', () => {
  const d = one(facts([issue({ number: 46, type: null, typeProblem: 'no type label' })]), 46);
  assertEquals(d.status, null);
  assertEquals(d.state, null);
  assertEquals(d.warnings, ['no type label']);
});

Deno.test('reconcile: type change keeps epoch and recomputes', () => {
  const i = carded(46, 'new', { type: 'bug' }, { source: 'manual', epoch: AT });
  const d = one(facts([i], [pull({ number: 53, headRef: 'fix/46-x' })]), 46);
  assertEquals(d.status, 'inReview');
  assertEquals(d.marker.epoch, AT);
});

Deno.test('reconcile: ignores wrong child types with a warning', () => {
  const f = facts([
    carded(10, 'new', { type: 'story', children: [5] }),
    carded(5, 'new', { type: 'usecase', parent: 10 }),
  ]);
  assertMatch(one(f, 10).warnings.join('\n'), /Child #5 is a use case; only tasks and bugs count here — ignored/);
});

Deno.test('reconcile: canceled story lists children that are not canceled', () => {
  const f = facts([issue({ number: 46, parent: 10 }), carded(10, 'canceled', { type: 'story', children: [46] })]);
  assertMatch(one(f, 10).warnings.join('\n'), /Children not canceled: #46/);
});

Deno.test('reconcile: cancel of a story is guarded by its children\'s code', () => {
  const f = facts(
    [
      issue({ number: 46, parent: 10 }),
      carded(10, 'inReview', { type: 'story', children: [46], projectStatus: 'canceled', projectStatusUpdatedAt: LATER }),
    ],
    [mergedPr(52, 'feature/46-x')],
  );
  const d = one(f, 10);
  assertEquals(d.status, 'inReview');
  assertMatch(d.marker.history[0].reason, /#52/);
});
