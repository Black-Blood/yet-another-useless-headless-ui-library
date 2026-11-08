import { assertEquals } from '@std/assert';
import { storyStatus } from '../src/rules/story.ts';
import { usecaseStatus } from '../src/rules/usecase.ts';
import { crStatus } from '../src/rules/cr.ts';
Deno.test('storyStatus: no tasks → New', () => assertEquals(storyStatus([], [], false).status, 'new'));
Deno.test('storyStatus: some task in progress → In Progress', () =>
  assertEquals(storyStatus(['done', 'inProgress'], [], false).status, 'inProgress'));
Deno.test('storyStatus: all tasks New → New', () => assertEquals(storyStatus(['new', 'new'], [], false).status, 'new'));
Deno.test('storyStatus: accepted Done holds, all done → Done', () =>
  assertEquals(storyStatus(['done', 'done'], ['done'], true).status, 'done'));
Deno.test('storyStatus: open bug after accepted Done → In Review', () =>
  assertEquals(storyStatus(['done'], ['new'], true).status, 'inReview'));
Deno.test('storyStatus: all tasks done, no accepted Done → In Review', () =>
  assertEquals(storyStatus(['done'], [], false).status, 'inReview'));
Deno.test('storyStatus: a new task next to done ones → In Progress', () =>
  assertEquals(storyStatus(['done', 'new'], [], false).status, 'inProgress'));

Deno.test('usecaseStatus: no stories → New', () => assertEquals(usecaseStatus([]).status, 'new'));
Deno.test('usecaseStatus: all stories done → Done', () => assertEquals(usecaseStatus(['done', 'done']).status, 'done'));
Deno.test('usecaseStatus: some story started → In Progress', () =>
  assertEquals(usecaseStatus(['done', 'new']).status, 'inProgress'));
Deno.test('usecaseStatus: all stories New → New', () => assertEquals(usecaseStatus(['new']).status, 'new'));

Deno.test('crStatus: nothing linked → New', () => assertEquals(crStatus([]).status, 'new'));
Deno.test('crStatus: all linked done → Done', () => assertEquals(crStatus(['done']).status, 'done'));
Deno.test('crStatus: linked but New → In Progress', () => assertEquals(crStatus(['new']).status, 'inProgress'));
Deno.test('crStatus: mixed → In Progress', () => assertEquals(crStatus(['done', 'inReview']).status, 'inProgress'));
