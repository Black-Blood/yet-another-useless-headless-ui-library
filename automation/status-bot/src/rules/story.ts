import type { Decision, Status } from '../types.ts';

/**
 * §4.4 — `tasks` and `bugs` are the statuses of active (not Canceled) children;
 * `acceptedDone` is true while a manually accepted Done still holds.
 */
export function storyStatus(tasks: Status[], bugs: Status[], acceptedDone: boolean): Decision {
  if (tasks.length === 0) return { status: 'new', reason: 'no tasks' };
  if (tasks.some((s) => s !== 'done')) {
    if (tasks.some((s) => s !== 'new')) return { status: 'inProgress', reason: 'tasks in progress' };
    return { status: 'new', reason: 'all tasks are New' };
  }
  if (acceptedDone && bugs.every((s) => s === 'done')) {
    return { status: 'done', reason: 'accepted manually; all tasks and bugs done' };
  }
  return { status: 'inReview', reason: 'all tasks done — awaiting review' };
}
