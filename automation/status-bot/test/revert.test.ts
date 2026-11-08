import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMerged, revertTargets } from '../src/collect/revert.ts';
import { pull, REPO as repo } from './helpers.ts';

const merged = (n: number, body = '', baseRef = 'develop') =>
  pull({ number: n, state: 'merged', mergedAt: '2026-11-02T00:00:00Z', body, baseRef });
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

test('revertTargets: short and full forms, same repo only', () =>
  assert.deepEqual(revertTargets(`Reverts #5\nReverts ${repo}#7\nReverts other/repo#9`, repo), [5, 7]));

test('activeMerged: plain merged PR is active', () =>
  assert.deepEqual(sorted(activeMerged([merged(5)], 'develop', repo)), [5]));

test('activeMerged: merged revert deactivates the target', () =>
  assert.deepEqual(sorted(activeMerged([merged(5), merged(6, 'Reverts #5')], 'develop', repo)), [6]));

test('activeMerged: revert of a revert reactivates', () =>
  assert.deepEqual(
    sorted(activeMerged([merged(5), merged(6, 'Reverts #5'), merged(7, 'Reverts #6')], 'develop', repo)),
    [5, 7],
  ));

test('activeMerged: open revert PR does not count', () =>
  assert.ok(activeMerged([merged(5), pull({ number: 6, body: 'Reverts #5' })], 'develop', repo).has(5)));

test('activeMerged: revert merged into main does not count', () =>
  assert.ok(activeMerged([merged(5), merged(6, 'Reverts #5', 'main')], 'develop', repo).has(5)));

test('activeMerged: PR merged into main is not active', () =>
  assert.equal(activeMerged([merged(5, '', 'main')], 'develop', repo).size, 0));
