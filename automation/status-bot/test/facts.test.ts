import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert';
import { toFacts } from '../src/collect/facts.ts';
import type { RawProject, RawRepo } from '../src/collect/github.ts';
import { REPO, testConfig } from './helpers.ts';

const load = <T>(name: string): T => JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const project = load<RawProject>('project.json');
const repo = load<RawRepo>('repo.json');
const { facts, meta } = toFacts({ project, repo }, testConfig, REPO, '2026-11-08T12:00:00Z');
const get = (n: number) => {
  const i = facts.issues.get(n);
  assert(i, `issue #${n} missing`);
  return i;
};

Deno.test('toFacts: status options map to config statuses', () => {
  assertEquals(meta.projectId, 'PVT_1');
  assertEquals(meta.statusFieldId, 'PVTSSF_1');
  assertEquals(meta.optionIds.inProgress, 'opt-progress');
  assertEquals(meta.optionIds.canceled, 'opt-canceled');
});

Deno.test('toFacts: missing status option throws', () => {
  const broken: RawProject = { ...project, field: { ...project.field!, options: project.field!.options.slice(0, 4) } };
  assertMatch(assertThrows(() => toFacts({ project: broken, repo }, testConfig, REPO, '2026-11-08T12:00:00Z'), Error).message, /Canceled/);
});

Deno.test('toFacts: type from labels', () => {
  assertEquals(get(1).type, 'task');
  assertEquals(get(3).type, 'story');
  assertEquals(get(4).type, null);
  assertEquals(get(4).typeProblem, 'several type labels: Task, Bug');
  assertEquals(get(5).typeProblem, 'no type label');
});

Deno.test('toFacts: DUPLICATE maps to not_planned', () => {
  assertEquals(get(2).state, { open: false, reason: 'not_planned' });
  assertEquals(get(2).stateChangedAt, '2026-11-07T00:00:00Z');
});

Deno.test('toFacts: membership from authorAssociation', () => {
  assertEquals(get(1).authorIsMember, true);
  assertEquals(get(4).authorIsMember, true);
  assertEquals(get(2).authorIsMember, false);
});

Deno.test('toFacts: items from other repositories and pull request items are ignored', () => {
  assertEquals(get(4).itemId, null);
  assertEquals([...facts.issues.values()].filter((i) => i.itemId).map((i) => i.number), [1, 2, 3]);
});

Deno.test('toFacts: project status and its author', () => {
  assertEquals(get(1).projectStatus, 'inProgress');
  assertEquals(get(1).projectStatusUpdatedAt, '2026-11-06T00:00:00Z');
  assertEquals(get(1).projectStatusUpdatedBy, 'Black-Blood');
  assertEquals(get(2).projectStatus, null);
});

Deno.test('toFacts: relationships', () => {
  assertEquals(get(1).parent, 3);
  assertEquals(get(3).children, [1]);
  assertEquals(get(5).blockedBy, [3]);
  assertEquals(get(1).assignees, ['dev']);
});

Deno.test('toFacts: pull requests', () => {
  assertEquals(
    facts.pulls.map((p) => [p.number, p.state, p.draft, p.authorIsMember, p.closingIssues]),
    [
      [10, 'open', false, true, []],
      [11, 'merged', false, false, [2]],
      [12, 'closed', true, false, []],
    ],
  );
});

Deno.test('toFacts: only branches that name an issue are kept', () =>
  assertEquals(facts.branches, [
    { name: 'feature/1-a', lastCommitAt: '2026-11-03T00:00:00Z' },
    { name: 'fix/2-b', lastCommitAt: '2026-11-04T00:00:00Z' },
    { name: '3-from-button', lastCommitAt: '2026-11-05T00:00:00Z' },
  ]));

Deno.test('toFacts: bot card is found', () => {
  assertEquals(get(1).card?.commentId, 102);
  assertEquals(get(1).card?.marker.status, 'inProgress');
  assertEquals(get(3).card, null);
});

Deno.test('toFacts: issues not in the project have itemId null', () => assertEquals(get(5).itemId, null));

Deno.test('toFacts: merge commit SHA of merged PRs', () =>
  assertEquals(
    facts.pulls.map((p) => [p.number, p.mergeCommit]),
    [
      [10, null],
      [11, 'abc1234def5678901234567890abcdef12345678'],
      [12, null],
    ],
  ));
