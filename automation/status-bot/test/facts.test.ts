import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toFacts } from '../src/collect/facts.ts';
import type { RawProject, RawRepo } from '../src/collect/github.ts';
import { REPO, testConfig } from './helpers.ts';

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const project = load<RawProject>('project.json');
const repo = load<RawRepo>('repo.json');
const { facts, meta } = toFacts({ project, repo }, testConfig, REPO, '2026-11-08T12:00:00Z');
const get = (n: number) => {
  const i = facts.issues.get(n);
  assert.ok(i, `issue #${n} missing`);
  return i;
};

test('toFacts: status options map to config statuses', () => {
  assert.equal(meta.projectId, 'PVT_1');
  assert.equal(meta.statusFieldId, 'PVTSSF_1');
  assert.equal(meta.optionIds.inProgress, 'opt-progress');
  assert.equal(meta.optionIds.canceled, 'opt-canceled');
});

test('toFacts: missing status option throws', () => {
  const broken: RawProject = { ...project, field: { ...project.field!, options: project.field!.options.slice(0, 4) } };
  assert.throws(() => toFacts({ project: broken, repo }, testConfig, REPO, '2026-11-08T12:00:00Z'), /Canceled/);
});

test('toFacts: type from labels', () => {
  assert.equal(get(1).type, 'task');
  assert.equal(get(3).type, 'story');
  assert.equal(get(4).type, null);
  assert.equal(get(4).typeProblem, 'several type labels: Task, Bug');
  assert.equal(get(5).typeProblem, 'no type label');
});

test('toFacts: DUPLICATE maps to not_planned', () => {
  assert.deepEqual(get(2).state, { open: false, reason: 'not_planned' });
  assert.equal(get(2).stateChangedAt, '2026-11-07T00:00:00Z');
});

test('toFacts: membership from authorAssociation', () => {
  assert.equal(get(1).authorIsMember, true);
  assert.equal(get(4).authorIsMember, true);
  assert.equal(get(2).authorIsMember, false);
});

test('toFacts: items from other repositories and pull request items are ignored', () => {
  assert.equal(get(4).itemId, null);
  assert.deepEqual([...facts.issues.values()].filter((i) => i.itemId).map((i) => i.number), [1, 2, 3]);
});

test('toFacts: project status and its author', () => {
  assert.equal(get(1).projectStatus, 'inProgress');
  assert.equal(get(1).projectStatusUpdatedAt, '2026-11-06T00:00:00Z');
  assert.equal(get(1).projectStatusUpdatedBy, 'Black-Blood');
  assert.equal(get(2).projectStatus, null);
});

test('toFacts: relationships', () => {
  assert.equal(get(1).parent, 3);
  assert.deepEqual(get(3).children, [1]);
  assert.deepEqual(get(5).blockedBy, [3]);
  assert.deepEqual(get(1).assignees, ['dev']);
});

test('toFacts: pull requests', () => {
  assert.deepEqual(
    facts.pulls.map((p) => [p.number, p.state, p.draft, p.authorIsMember, p.closingIssues]),
    [
      [10, 'open', false, true, []],
      [11, 'merged', false, false, [2]],
      [12, 'closed', true, false, []],
    ],
  );
});

test('toFacts: only feature/ and fix/ branches are kept', () =>
  assert.deepEqual(facts.branches, [
    { name: 'feature/1-a', lastCommitAt: '2026-11-03T00:00:00Z' },
    { name: 'fix/2-b', lastCommitAt: '2026-11-04T00:00:00Z' },
  ]));

test('toFacts: bot card is found', () => {
  assert.equal(get(1).card?.commentId, 102);
  assert.equal(get(1).card?.marker.status, 'inProgress');
  assert.equal(get(3).card, null);
});

test('toFacts: issues not in the project have itemId null', () => assert.equal(get(5).itemId, null));
