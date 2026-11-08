import { assertEquals } from '@std/assert';
import { pickQa } from '../src/rules/qa.ts';

Deno.test('pickQa: author who is QA verifies their own bug', () =>
  assertEquals(pickQa('ann', ['bob', 'ann'], new Map()), 'ann'));

Deno.test('pickQa: least loaded QA otherwise', () =>
  assertEquals(pickQa('stranger', ['bob', 'ann'], new Map([['bob', 2], ['ann', 1]])), 'ann'));

Deno.test('pickQa: tie goes to list order', () => assertEquals(pickQa('stranger', ['bob', 'ann'], new Map()), 'bob'));
