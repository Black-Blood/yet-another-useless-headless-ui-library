import { assert, assertEquals, assertFalse } from '@std/assert';
import { activeMerged, revertedShas, revertTargets } from '../src/collect/revert.ts';
import { pull, REPO as repo } from './helpers.ts';

const merged = (n: number, body = '', baseRef = 'develop') =>
  pull({ number: n, state: 'merged', mergedAt: '2026-11-02T00:00:00Z', body, baseRef });
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

Deno.test('revertTargets: short and full forms, same repo only', () =>
  assertEquals(revertTargets(`Reverts #5\nReverts ${repo}#7\nReverts other/repo#9`, repo), [5, 7]));

Deno.test('activeMerged: plain merged PR is active', () =>
  assertEquals(sorted(activeMerged([merged(5)], 'develop', repo)), [5]));

Deno.test('activeMerged: merged revert deactivates the target', () =>
  assertEquals(sorted(activeMerged([merged(5), merged(6, 'Reverts #5')], 'develop', repo)), [6]));

Deno.test('activeMerged: revert of a revert reactivates', () =>
  assertEquals(
    sorted(activeMerged([merged(5), merged(6, 'Reverts #5'), merged(7, 'Reverts #6')], 'develop', repo)),
    [5, 7],
  ));

Deno.test('activeMerged: open revert PR does not count', () =>
  assert(activeMerged([merged(5), pull({ number: 6, body: 'Reverts #5' })], 'develop', repo).has(5)));

Deno.test('activeMerged: revert merged into main does not count', () =>
  assert(activeMerged([merged(5), merged(6, 'Reverts #5', 'main')], 'develop', repo).has(5)));

Deno.test('activeMerged: PR merged into main is not active', () =>
  assertEquals(activeMerged([merged(5, '', 'main')], 'develop', repo).size, 0));

// The GitHub Revert button (and `git revert`) writes the reverted commit's SHA, not the PR number.
const SHA4 = '6766a7bf75d3f03ec01672e15afe9cac1fd3f7fd';
const SHA5 = 'b215c4125794d109b612018ffe1ac4dfb17fb15f';
const pr4 = pull({ number: 4, state: 'merged', mergedAt: '2026-11-08T17:51:24Z', mergeCommit: SHA4 });
const revert = (n: number, body: string, mergeCommit: string | null = null) =>
  pull({ number: n, state: 'merged', mergedAt: '2026-11-08T18:02:05Z', body, mergeCommit });

Deno.test('activeMerged: "This reverts commit <sha>" deactivates the reverted PR', () => {
  const active = activeMerged([pr4, revert(5, `This reverts commit ${SHA4}.`, SHA5)], 'develop', repo);
  assertFalse(active.has(4));
  assert(active.has(5));
});

Deno.test('activeMerged: an abbreviated SHA also counts', () =>
  assertFalse(activeMerged([pr4, revert(5, 'This reverts commit 6766a7b.')], 'develop', repo).has(4)));

Deno.test('activeMerged: revert of a revert by SHA reactivates', () => {
  const pulls = [pr4, revert(5, `This reverts commit ${SHA4}.`, SHA5), revert(6, `This reverts commit ${SHA5}.`)];
  assert(activeMerged(pulls, 'develop', repo).has(4));
});

Deno.test('activeMerged: a SHA that matches no merged PR changes nothing', () =>
  assert(activeMerged([pr4, revert(5, 'This reverts commit 1234567.')], 'develop', repo).has(4)));

Deno.test('revertedShas: full and short SHAs, case-insensitive', () =>
  assertEquals(revertedShas(`This reverts commit ${SHA4}.\nthis reverts commit B215C41`), [SHA4, 'b215c41']));
