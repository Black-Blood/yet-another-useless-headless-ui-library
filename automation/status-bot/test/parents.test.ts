import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyStatus } from '../src/rules/story.ts';
import { usecaseStatus } from '../src/rules/usecase.ts';
import { crStatus } from '../src/rules/cr.ts';
test('storyStatus: no tasks → New', () => assert.equal(storyStatus([], [], false).status, 'new'));
test('storyStatus: some task in progress → In Progress', () =>
  assert.equal(storyStatus(['done', 'inProgress'], [], false).status, 'inProgress'));
test('storyStatus: all tasks New → New', () => assert.equal(storyStatus(['new', 'new'], [], false).status, 'new'));
test('storyStatus: accepted Done holds, all done → Done', () =>
  assert.equal(storyStatus(['done', 'done'], ['done'], true).status, 'done'));
test('storyStatus: open bug after accepted Done → In Review', () =>
  assert.equal(storyStatus(['done'], ['new'], true).status, 'inReview'));
test('storyStatus: all tasks done, no accepted Done → In Review', () =>
  assert.equal(storyStatus(['done'], [], false).status, 'inReview'));
test('storyStatus: a new task next to done ones → In Progress', () =>
  assert.equal(storyStatus(['done', 'new'], [], false).status, 'inProgress'));

test('usecaseStatus: no stories → New', () => assert.equal(usecaseStatus([]).status, 'new'));
test('usecaseStatus: all stories done → Done', () => assert.equal(usecaseStatus(['done', 'done']).status, 'done'));
test('usecaseStatus: some story started → In Progress', () =>
  assert.equal(usecaseStatus(['done', 'new']).status, 'inProgress'));
test('usecaseStatus: all stories New → New', () => assert.equal(usecaseStatus(['new']).status, 'new'));

test('crStatus: nothing linked → New', () => assert.equal(crStatus([]).status, 'new'));
test('crStatus: all linked done → Done', () => assert.equal(crStatus(['done']).status, 'done'));
test('crStatus: linked but New → In Progress', () => assert.equal(crStatus(['new']).status, 'inProgress'));
test('crStatus: mixed → In Progress', () => assert.equal(crStatus(['done', 'inReview']).status, 'inProgress'));
