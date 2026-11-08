import { assertEquals, assertMatch } from '@std/assert';
import { collectWork } from '../src/rules/work.ts';
import { activeMerged } from '../src/collect/revert.ts';
import type { BranchFact, PullFact } from '../src/types.ts';
import { branch, facts, issue, pull, testConfig } from './helpers.ts';

const run = (pulls: PullFact[], branches: BranchFact[] = [], epoch: string | null = null) => {
  const f = facts([issue({ number: 46 })], pulls, branches);
  return collectWork(46, 'task', f, activeMerged(pulls, 'develop', f.repo), testConfig, epoch);
};

Deno.test('collectWork: links PRs and branches by name', () => {
  const w = run([pull({ number: 52, headRef: 'feature/46-x' })], [branch('feature/46-x')]);
  assertEquals(w.openReady, [52]);
  assertEquals(w.branches, ['feature/46-x']);
});

Deno.test('collectWork: Development link is a fallback for unparseable branches', () =>
  assertEquals(run([pull({ number: 53, headRef: 'patch-1', closingIssues: [46] })]).openReady, [53]));

Deno.test('collectWork: branch name wins over Development link', () =>
  assertEquals(run([pull({ number: 54, headRef: 'feature/47-x', closingIssues: [46] })]).openReady, []));

Deno.test('collectWork: PR into another base is ignored with a warning', () => {
  const w = run([pull({ number: 55, headRef: 'feature/46-x', baseRef: 'main' })]);
  assertEquals(w.openReady, []);
  assertMatch(w.warnings[0], /PR #55 targets main, not develop — ignored/);
});

Deno.test('collectWork: wrong prefix for the type is ignored with a warning', () => {
  const w = run([], [branch('fix/46-x')]);
  assertEquals(w.branches, []);
  assertMatch(w.warnings[0], /Branch `fix\/46-x` does not match the type of issue #46 \(task\) — ignored/);
});

Deno.test('collectWork: merged PR from a wrong-prefix branch still counts for the Canceled guard', () => {
  const w = run([pull({ number: 60, headRef: 'fix/46-x', state: 'merged', mergedAt: '2026-11-02T00:00:00Z' })]);
  assertEquals(w.allActiveMerged, [60]);
  assertEquals(w.activeMerged, []);
});

Deno.test('collectWork: closed PRs with a wrong prefix leave no warning', () =>
  assertEquals(run([pull({ number: 61, headRef: 'fix/46-x', state: 'closed' })]).warnings, []));

Deno.test('collectWork: fork branch names in warnings are code, not markup', () => {
  const w = run([pull({ number: 62, headRef: 'fix/46-@someone<!--`x' })]);
  assertEquals(w.warnings[0], 'Branch `fix/46-@someone<!--x` does not match the type of issue #46 (task) — ignored');
});

Deno.test('collectWork: epoch filters merged PRs and stale branches, not open PRs', () => {
  const w = run(
    [
      pull({ number: 56, headRef: 'feature/46-a', state: 'merged', mergedAt: '2026-11-02T00:00:00Z' }),
      pull({ number: 57, headRef: 'feature/46-b', createdAt: '2026-11-02T00:00:00Z' }),
    ],
    [branch('feature/46-c', '2026-11-02T00:00:00Z')],
    '2026-11-05T00:00:00Z',
  );
  assertEquals(w.activeMerged, []);
  assertEquals(w.allActiveMerged, [56]);
  assertEquals(w.branches, []);
  assertEquals(w.openReady, [57]);
});

Deno.test('collectWork: draft PRs are listed separately', () =>
  assertEquals(run([pull({ number: 58, headRef: 'feature/46-x', draft: true })]).openDraft, [58]));
