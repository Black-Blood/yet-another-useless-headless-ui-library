import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/apply/execute.ts';
import type { Clients } from '../src/apply/execute.ts';
import { renderSummary } from '../src/apply/summary.ts';
import type { Action, ProjectMeta } from '../src/types.ts';
import { REPO } from './helpers.ts';

const meta: ProjectMeta = {
  projectId: 'PVT_1',
  statusFieldId: 'F_1',
  optionIds: { new: 'o-new', inProgress: 'o-prog', inReview: 'o-rev', done: 'o-done', canceled: 'o-can' },
};

function fakeClients(failOn: (call: string) => boolean = () => false) {
  const calls: { call: string; params: Record<string, unknown> }[] = [];
  const clients: Clients = {
    projectGql: async (query, vars) => {
      const call = /mutation[^{]*\{\s*(\w+)/.exec(query)?.[1] ?? 'unknown';
      calls.push({ call, params: vars });
      if (failOn(call)) throw new Error(`${call} failed`);
      return {};
    },
    rest: {
      request: async (route, params) => {
        calls.push({ call: route, params });
        if (failOn(route)) throw new Error(`${route} failed`);
        return {};
      },
    },
  };
  return { clients, calls };
}

const all: Action[] = [
  { kind: 'addToProject', issue: 1, nodeId: 'I_1' },
  { kind: 'writeCard', issue: 2, commentId: null, body: 'new card' },
  { kind: 'writeCard', issue: 3, commentId: 77, body: 'edited card' },
  { kind: 'setStatus', issue: 3, itemId: 'PVTI_3', status: 'inReview' },
  { kind: 'setState', issue: 3, state: { open: false, reason: 'not_planned' } },
  { kind: 'setState', issue: 4, state: { open: true, reason: null } },
  { kind: 'setAssignees', issue: 4, assignees: ['qa'] },
];

test('execute: dry run makes no calls', async () => {
  const { clients, calls } = fakeClients();
  const r = await execute(all, clients, meta, REPO, true);
  assert.equal(calls.length, 0);
  assert.equal(r.done.length, all.length);
  assert.deepEqual(r.errors, []);
});

test('execute: maps each action to its API call', async () => {
  const { clients, calls } = fakeClients();
  await execute(all, clients, meta, REPO, false);
  const base = { owner: 'Black-Blood', repo: 'yet-another-useless-headless-ui-library' };
  assert.deepEqual(calls, [
    { call: 'addProjectV2ItemById', params: { projectId: 'PVT_1', contentId: 'I_1' } },
    { call: 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments', params: { ...base, issue_number: 2, body: 'new card' } },
    { call: 'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', params: { ...base, comment_id: 77, body: 'edited card' } },
    {
      call: 'updateProjectV2ItemFieldValue',
      params: { projectId: 'PVT_1', itemId: 'PVTI_3', fieldId: 'F_1', optionId: 'o-rev' },
    },
    {
      call: 'PATCH /repos/{owner}/{repo}/issues/{issue_number}',
      params: { ...base, issue_number: 3, state: 'closed', state_reason: 'not_planned' },
    },
    { call: 'PATCH /repos/{owner}/{repo}/issues/{issue_number}', params: { ...base, issue_number: 4, state: 'open' } },
    { call: 'PATCH /repos/{owner}/{repo}/issues/{issue_number}', params: { ...base, issue_number: 4, assignees: ['qa'] } },
  ]);
});

test('execute: an error skips the rest of that issue only', async () => {
  const { clients, calls } = fakeClients((c) => c === 'updateProjectV2ItemFieldValue');
  const r = await execute(all, clients, meta, REPO, false);
  assert.equal(calls.filter((c) => c.params.issue_number === 3 && 'state' in c.params).length, 0);
  assert.equal(calls.filter((c) => c.params.issue_number === 4).length, 2);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].action.kind, 'setStatus');
  assert.match(r.errors[0].message, /updateProjectV2ItemFieldValue failed/);
});

test('renderSummary: lists changes, skips and errors', () => {
  const md = renderSummary({
    result: { done: [all[3]], errors: [{ action: all[6], message: 'boom' }] },
    blocked: false,
    dryRun: false,
    planned: all,
    skipped: [{ issue: 5, reason: 'no type label' }],
  });
  assert.match(md, /#3 \| set status → inReview/);
  assert.match(md, /#5: no type label/);
  assert.match(md, /#4 set assignees → qa: boom/);
});

test('renderSummary: says nothing was written when blocked or dry run', () => {
  const base = { result: { done: [], errors: [] }, planned: all, skipped: [] };
  assert.match(renderSummary({ ...base, blocked: true, dryRun: false }), /Nothing was written/);
  assert.match(renderSummary({ ...base, blocked: false, dryRun: true }), /Nothing was written/);
});
