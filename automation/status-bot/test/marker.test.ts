import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory, findCard, isBotLogin, parseMarker, renderCard } from '../src/collect/marker.ts';
import type { HistoryEntry } from '../src/types.ts';
import { marker, testConfig } from './helpers.ts';

const m = marker({
  status: 'inReview',
  history: [{ at: '2026-11-07T10:12:03Z', from: 'inProgress', to: 'inReview', reason: 'PR #52 opened (not draft)' }],
});
const body = renderCard(
  m,
  'PR #52 opened (not draft)',
  ['Branch feature/49-modal does not match the type of issue #49 (bug) — ignored'],
  testConfig.statuses,
);

test('renderCard: shows status, reason, warning and history row', () => {
  assert.match(body, /^🤖 Status: In Review$/m);
  assert.match(body, /^Reason: PR #52 opened \(not draft\)$/m);
  assert.match(body, /^⚠️ Branch feature\/49-modal/m);
  assert.match(body, /\| 11-07 10:12 \| In Progress \| In Review \| PR #52 opened \(not draft\) \|/);
});

test('parseMarker: round-trips renderCard', () => assert.deepEqual(parseMarker(body), m));

test('parseMarker: malformed JSON gives null', () => assert.equal(parseMarker('<!-- status-bot: {oops -->'), null));

test('parseMarker: a card written before `held` existed reads held as null', () =>
  assert.equal(
    parseMarker(
      '<!-- status-bot: {"v":1,"status":"done","source":"manual","epoch":null,"at":"2026-11-05T00:00:00Z","verifyAssigned":false,"history":[]} -->',
    )?.held,
    null,
  ));

test('parseMarker: held round-trips', () => {
  const held = marker({ status: 'inReview', held: 'done' });
  assert.equal(parseMarker(renderCard(held, 'x', [], testConfig.statuses))?.held, 'done');
});

test('isBotLogin: GraphQL and REST spellings', () => {
  assert.ok(isBotLogin('github-actions'));
  assert.ok(isBotLogin('github-actions[bot]'));
  assert.ok(!isBotLogin('Black-Blood'));
});

test('findCard: ignores a forged card from a human', () =>
  assert.equal(findCard([{ id: 1, author: 'mallory', createdAt: '2026-11-07T00:00:00Z', body }]), null));

test('findCard: picks the newest bot card', () => {
  const older = renderCard(marker({ status: 'new' }), 'x', [], testConfig.statuses);
  const card = findCard([
    { id: 1, author: 'github-actions', createdAt: '2026-11-01T00:00:00Z', body: older },
    { id: 2, author: 'github-actions[bot]', createdAt: '2026-11-07T00:00:00Z', body },
  ]);
  assert.equal(card?.commentId, 2);
  assert.equal(card?.marker.status, 'inReview');
});

test('appendHistory: newest first, capped at size', () => {
  let h: HistoryEntry[] = [];
  for (let i = 0; i < 25; i++) {
    h = appendHistory(h, { at: `2026-11-0${(i % 9) + 1}T00:00:00Z`, from: null, to: 'new', reason: `r${i}` }, 20);
  }
  assert.equal(h.length, 20);
  assert.equal(h[0].reason, 'r24');
});
