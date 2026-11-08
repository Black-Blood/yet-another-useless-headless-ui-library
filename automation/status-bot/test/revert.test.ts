import { assert, assertEquals } from '@std/assert';
import { activeMerged, revertTargets } from '../src/collect/revert.ts';
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
