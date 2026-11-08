import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectManual, judgeManual, stateFor } from '../src/rules/manual.ts';
import type { ManualChange, ManualContext } from '../src/rules/manual.ts';
import type { IssueFacts, IssueType, Status } from '../src/types.ts';
import { issue, marker, testConfig } from './helpers.ts';

const AT = '2026-11-05T00:00:00Z';
const LATER = '2026-11-06T00:00:00Z';
const EARLIER = '2026-11-04T00:00:00Z';

const withCard = (p: Partial<IssueFacts>, status: Status = 'inProgress') =>
  issue({
    number: 46,
    projectStatus: status,
    projectStatusUpdatedAt: EARLIER,
    state: stateFor(status),
    card: { commentId: 1, body: '', marker: marker({ status, at: AT }) },
    ...p,
  });

test('stateFor: Done and Canceled close the issue, the rest keep it open', () => {
  assert.deepEqual(stateFor('done'), { open: false, reason: 'completed' });
  assert.deepEqual(stateFor('canceled'), { open: false, reason: 'not_planned' });
  assert.deepEqual(stateFor('inReview'), { open: true, reason: null });
});

test('detectManual: no card → null', () => assert.equal(detectManual(issue({ number: 46 })), null));

test('detectManual: matching status and state → null', () => assert.equal(detectManual(withCard({})), null));

test('detectManual: status changed after marker.at', () =>
  assert.deepEqual(
    detectManual(withCard({ projectStatus: 'done', projectStatusUpdatedAt: LATER, projectStatusUpdatedBy: 'ann' })),
    { to: 'done', at: LATER, by: 'ann' },
  ));

test('detectManual: unfinished bot write is not a manual change', () =>
  assert.equal(detectManual(withCard({ projectStatus: 'done', projectStatusUpdatedAt: EARLIER })), null));

test('detectManual: empty project status is not a manual change', () =>
  assert.equal(detectManual(withCard({ projectStatus: null, projectStatusUpdatedAt: null })), null));

test('detectManual: closed as completed → Done', () =>
  assert.equal(
    detectManual(withCard({ state: { open: false, reason: 'completed' }, stateChangedAt: LATER }))?.to,
    'done',
  ));

test('detectManual: closed as not planned → Canceled', () =>
  assert.equal(
    detectManual(withCard({ state: { open: false, reason: 'not_planned' }, stateChangedAt: LATER }))?.to,
    'canceled',
  ));

test('detectManual: closed as duplicate means canceled', () =>
  // toFacts maps GitHub's DUPLICATE close reason to not_planned (Task 11)
  assert.equal(
    detectManual(withCard({ state: { open: false, reason: 'not_planned' }, stateChangedAt: LATER }))?.to,
    'canceled',
  ));

test('detectManual: reopened while marker is Done → New', () =>
  assert.deepEqual(detectManual(withCard({ state: { open: true, reason: null }, stateChangedAt: LATER }, 'done')), {
    to: 'new',
    at: LATER,
    by: null,
  }));

test('detectManual: close event before marker.at is an unfinished bot write', () =>
  assert.equal(detectManual(withCard({ state: { open: false, reason: 'completed' }, stateChangedAt: EARLIER })), null));

test('detectManual: status wins over state', () =>
  assert.equal(
    detectManual(
      withCard({
        projectStatus: 'inReview',
        projectStatusUpdatedAt: LATER,
        state: { open: false, reason: 'completed' },
        stateChangedAt: LATER,
      }),
    )?.to,
    'inReview',
  ));

const ctx = (type: IssueType, from: Status, p: Partial<ManualContext> = {}): ManualContext => ({
  type,
  from,
  bugVerification: false,
  names: testConfig.statuses,
  activeCodePulls: [],
  tasks: [],
  bugs: [],
  stories: [],
  linked: [],
  ...p,
});
const change = (to: Status): ManualChange => ({ to, at: LATER, by: 'ann' });
const rejects = (r: ReturnType<typeof judgeManual>, re: RegExp) => {
  assert.equal(r.accept, false);
  if (!r.accept) assert.match(r.reason, re);
};

test('judgeManual: any type may cancel when no code is merged', () => {
  for (const t of ['task', 'bug', 'story'] as const) assert.deepEqual(judgeManual(change('canceled'), ctx(t, 'inProgress')), { accept: true });
});

test('judgeManual: any type may go from Canceled back to New', () => {
  for (const t of ['task', 'bug', 'story', 'usecase', 'cr'] as const) {
    assert.deepEqual(judgeManual(change('new'), ctx(t, 'canceled')), { accept: true });
  }
});

test('judgeManual: bug verification outcomes are accepted', () => {
  assert.deepEqual(judgeManual(change('done'), ctx('bug', 'inReview', { bugVerification: true })), { accept: true });
  assert.deepEqual(judgeManual(change('new'), ctx('bug', 'inReview', { bugVerification: true })), { accept: true });
});

test('judgeManual: story Done when all tasks and bugs are Done', () =>
  assert.deepEqual(judgeManual(change('done'), ctx('story', 'inReview', { tasks: ['done'], bugs: ['done'] })), {
    accept: true,
  }));

test('judgeManual: use case cancel when all stories are Canceled', () =>
  assert.deepEqual(judgeManual(change('canceled'), ctx('usecase', 'inProgress', { stories: ['canceled'] })), {
    accept: true,
  }));

test('judgeManual: change request cancel from New even with active links', () =>
  assert.deepEqual(judgeManual(change('canceled'), ctx('cr', 'new', { linked: ['inProgress'] })), { accept: true }));

test('judgeManual: task New → Done is rejected', () =>
  rejects(judgeManual(change('done'), ctx('task', 'new')), /manual change from New to Done is not allowed for task/));

test('judgeManual: cancel with merged code is rejected', () =>
  rejects(judgeManual(change('canceled'), ctx('task', 'done', { activeCodePulls: [12, 15] })), /revert PR #12, #15 first/));

test('judgeManual: bug Done outside verification is rejected', () =>
  rejects(judgeManual(change('done'), ctx('bug', 'inReview')), /only during verification/));

test('judgeManual: story Done with an open bug is rejected', () =>
  rejects(
    judgeManual(change('done'), ctx('story', 'inReview', { tasks: ['done'], bugs: ['new'] })),
    /all tasks and bugs must be Done/,
  ));

test('judgeManual: use case cancel with an active story is rejected', () =>
  rejects(
    judgeManual(change('canceled'), ctx('usecase', 'inProgress', { stories: ['canceled', 'inProgress'] })),
    /all user stories must be Canceled/,
  ));

test('judgeManual: change request cancel with active links is rejected', () =>
  rejects(
    judgeManual(change('canceled'), ctx('cr', 'inProgress', { linked: ['inProgress'] })),
    /all linked issues must be Canceled/,
  ));
