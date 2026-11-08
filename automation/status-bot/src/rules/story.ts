import type { Decision, Marker, Status } from '../types.ts';

/** §4.4 — `tasks` and `bugs` are the statuses of active (not Canceled) children. */
export function storyStatus(tasks: Status[], bugs: Status[], marker: Marker | null): Decision {
  if (tasks.length === 0) return { status: 'new', reason: 'no tasks' };
  if (tasks.some((s) => s !== 'done')) {
    if (tasks.some((s) => s !== 'new')) return { status: 'inProgress', reason: 'tasks in progress' };
    return { status: 'new', reason: 'all tasks are New' };
  }
  const manualDone = marker?.status === 'done' && marker.source === 'manual';
  if (manualDone && bugs.every((s) => s === 'done')) {
    return { status: 'done', reason: 'accepted manually; all tasks and bugs done' };
  }
  return { status: 'inReview', reason: 'all tasks done — awaiting review' };
}
