import { assertEquals, assertMatch, assertThrows } from '@std/assert';
import { parseConfig, loadConfig } from '../src/config.ts';
import { CONFIG_PATH } from './helpers.ts';

const text = Deno.readTextFileSync(CONFIG_PATH);
const withoutKey = (key: string) => text.replace(new RegExp(`^${key}:.*$`, 'm'), '');
const withQa = (qa: string[]) => text.replace(/^qa:\n( {2}- .*\n)+/m, `qa: ${JSON.stringify(qa)}\n`);
const withoutStatus = (key: string) => text.replace(new RegExp(`^  ${key}:.*$`, 'm'), '');

Deno.test('parseConfig: reads the repository config', () => {
  const c = loadConfig(CONFIG_PATH);
  assertEquals(c.project.number, 4);
  assertEquals(c.statuses.inProgress, 'In Progress');
  assertEquals(c.branchPrefix, { task: 'feature', bug: 'fix' });
  assertEquals(c.typeLabels.story, 'User Story');
  assertEquals(c.qa, ['Black-Blood']);
  assertEquals(c.maxChangesPerRun, 30);
  assertEquals(c.historySize, 20);
});

Deno.test('parseConfig: missing integrationBranch throws', () =>
  assertMatch(assertThrows(() => parseConfig(withoutKey('integrationBranch')), Error).message, /integrationBranch/));

Deno.test('parseConfig: empty qa throws', () => assertMatch(assertThrows(() => parseConfig(withQa([])), Error).message, /qa/));

Deno.test('parseConfig: missing a status name throws', () =>
  assertMatch(assertThrows(() => parseConfig(withoutStatus('canceled')), Error).message, /statuses\.canceled/));
