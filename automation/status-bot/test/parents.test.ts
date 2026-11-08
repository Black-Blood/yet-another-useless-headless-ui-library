import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyStatus } from '../src/rules/story.ts';
import { usecaseStatus } from '../src/rules/usecase.ts';
import { crStatus } from '../src/rules/cr.ts';
import { marker } from './helpers.ts';

const manualDone = marker({ status: 'done', source: 'manual' });

test('storyStatus: no tasks → New', () => assert.equal(storyStatus([], [], null).status, 'new'));
test('storyStatus: some task in progress → In Progress', () =>
  assert.equal(storyStatus(['done', 'inProgress'], [], null).status, 'inProgress'));
test('storyStatus: all tasks New → New', () => assert.equal(storyStatus(['new', 'new'], [], null).status, 'new'));
test('storyStatus: accepted manually, all done → Done', () =>
  assert.equal(storyStatus(['done', 'done'], ['done'], manualDone).status, 'done'));
test('storyStatus: open bug after manual Done → In Review', () =>
  assert.equal(storyStatus(['done'], ['new'], manualDone).status, 'inReview'));
test('storyStatus: all tasks done, no manual Done → In Review', () =>
  assert.equal(storyStatus(['done'], [], null).status, 'inReview'));
test('storyStatus: a new task next to done ones → In Progress', () =>
  assert.equal(storyStatus(['done', 'new'], [], null).status, 'inProgress'));
test('storyStatus: Done set by the bot is not a manual Done', () =>
  assert.equal(storyStatus(['done'], [], marker({ status: 'done', source: 'bot' })).status, 'inReview'));

test('usecaseStatus: no stories → New', () => assert.equal(usecaseStatus([]).status, 'new'));
test('usecaseStatus: all stories done → Done', () => assert.equal(usecaseStatus(['done', 'done']).status, 'done'));
test('usecaseStatus: some story started → In Progress', () =>
  assert.equal(usecaseStatus(['done', 'new']).status, 'inProgress'));
test('usecaseStatus: all stories New → New', () => assert.equal(usecaseStatus(['new']).status, 'new'));

test('crStatus: nothing linked → New', () => assert.equal(crStatus([]).status, 'new'));
test('crStatus: all linked done → Done', () => assert.equal(crStatus(['done']).status, 'done'));
test('crStatus: linked but New → In Progress', () => assert.equal(crStatus(['new']).status, 'inProgress'));
test('crStatus: mixed → In Progress', () => assert.equal(crStatus(['done', 'inReview']).status, 'inProgress'));
