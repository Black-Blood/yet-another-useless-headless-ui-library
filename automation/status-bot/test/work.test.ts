import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectWork } from '../src/rules/work.ts';
import { activeMerged } from '../src/collect/revert.ts';
import type { BranchFact, PullFact } from '../src/types.ts';
import { branch, facts, issue, pull, testConfig } from './helpers.ts';

const run = (pulls: PullFact[], branches: BranchFact[] = [], epoch: string | null = null) => {
  const f = facts([issue({ number: 46 })], pulls, branches);
  return collectWork(46, 'task', f, activeMerged(pulls, 'develop', f.repo), testConfig, epoch);
};

test('collectWork: links PRs and branches by name', () => {
  const w = run([pull({ number: 52, headRef: 'feature/46-x' })], [branch('feature/46-x')]);
  assert.deepEqual(w.openReady, [52]);
  assert.deepEqual(w.branches, ['feature/46-x']);
});

test('collectWork: Development link is a fallback for unparseable branches', () =>
  assert.deepEqual(run([pull({ number: 53, headRef: 'patch-1', closingIssues: [46] })]).openReady, [53]));

test('collectWork: branch name wins over Development link', () =>
  assert.deepEqual(run([pull({ number: 54, headRef: 'feature/47-x', closingIssues: [46] })]).openReady, []));

test('collectWork: PR into another base is ignored with a warning', () => {
  const w = run([pull({ number: 55, headRef: 'feature/46-x', baseRef: 'main' })]);
  assert.deepEqual(w.openReady, []);
  assert.match(w.warnings[0], /PR #55 targets main, not develop — ignored/);
});

test('collectWork: wrong prefix for the type is ignored with a warning', () => {
  const w = run([], [branch('fix/46-x')]);
  assert.deepEqual(w.branches, []);
  assert.match(w.warnings[0], /Branch fix\/46-x does not match the type of issue #46 \(task\) — ignored/);
});

test('collectWork: epoch filters merged PRs and stale branches, not open PRs', () => {
  const w = run(
    [
      pull({ number: 56, headRef: 'feature/46-a', state: 'merged', mergedAt: '2026-11-02T00:00:00Z' }),
      pull({ number: 57, headRef: 'feature/46-b', createdAt: '2026-11-02T00:00:00Z' }),
    ],
    [branch('feature/46-c', '2026-11-02T00:00:00Z')],
    '2026-11-05T00:00:00Z',
  );
  assert.deepEqual(w.activeMerged, []);
  assert.deepEqual(w.allActiveMerged, [56]);
  assert.deepEqual(w.branches, []);
  assert.deepEqual(w.openReady, [57]);
});

test('collectWork: draft PRs are listed separately', () =>
  assert.deepEqual(run([pull({ number: 58, headRef: 'feature/46-x', draft: true })]).openDraft, [58]));
