import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert';
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
  ['Branch feat/49-modal does not match the type of issue #49 (bug) — ignored'],
  testConfig.statuses,
);

Deno.test('renderCard: shows status, reason, warning and history row', () => {
  assertMatch(body, /^🤖 Status: In Review$/m);
  assertMatch(body, /^Reason: PR #52 opened \(not draft\)$/m);
  assertMatch(body, /^⚠️ Branch feat\/49-modal/m);
  assertMatch(body, /\| 11-07 10:12 \| In Progress \| In Review \| PR #52 opened \(not draft\) \|/);
});

Deno.test('parseMarker: round-trips renderCard', () => assertEquals(parseMarker(body), m));

Deno.test('parseMarker: malformed JSON gives null', () => assertEquals(parseMarker('<!-- status-bot: {oops -->'), null));

Deno.test('parseMarker: a card written before `held` existed reads held as null', () =>
  assertEquals(
    parseMarker(
      '<!-- status-bot: {"v":1,"status":"done","source":"manual","epoch":null,"at":"2026-11-05T00:00:00Z","verifyAssigned":false,"history":[]} -->',
    )?.held,
    null,
  ));

Deno.test('parseMarker: held round-trips', () => {
  const held = marker({ status: 'inReview', held: 'done' });
  assertEquals(parseMarker(renderCard(held, 'x', [], testConfig.statuses))?.held, 'done');
});

Deno.test('isBotLogin: GraphQL and REST spellings', () => {
  assert(isBotLogin('github-actions'));
  assert(isBotLogin('github-actions[bot]'));
  assertFalse(isBotLogin('Black-Blood'));
});

Deno.test('findCard: ignores a forged card from a human', () =>
  assertEquals(findCard([{ id: 1, author: 'mallory', createdAt: '2026-11-07T00:00:00Z', body }]), null));

Deno.test('findCard: picks the newest bot card', () => {
  const older = renderCard(marker({ status: 'new' }), 'x', [], testConfig.statuses);
  const card = findCard([
    { id: 1, author: 'github-actions', createdAt: '2026-11-01T00:00:00Z', body: older },
    { id: 2, author: 'github-actions[bot]', createdAt: '2026-11-07T00:00:00Z', body },
  ]);
  assertEquals(card?.commentId, 2);
  assertEquals(card?.marker.status, 'inReview');
});

Deno.test('appendHistory: newest first, capped at size', () => {
  let h: HistoryEntry[] = [];
  for (let i = 0; i < 25; i++) {
    h = appendHistory(h, { at: `2026-11-0${(i % 9) + 1}T00:00:00Z`, from: null, to: 'new', reason: `r${i}` }, 20);
  }
  assertEquals(h.length, 20);
  assertEquals(h[0].reason, 'r24');
});
