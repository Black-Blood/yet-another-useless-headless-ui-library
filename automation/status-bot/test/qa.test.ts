import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickQa } from '../src/rules/qa.ts';

test('pickQa: author who is QA verifies their own bug', () =>
  assert.equal(pickQa('ann', ['bob', 'ann'], new Map()), 'ann'));

test('pickQa: least loaded QA otherwise', () =>
  assert.equal(pickQa('stranger', ['bob', 'ann'], new Map([['bob', 2], ['ann', 1]])), 'ann'));

test('pickQa: tie goes to list order', () => assert.equal(pickQa('stranger', ['bob', 'ann'], new Map()), 'bob'));
