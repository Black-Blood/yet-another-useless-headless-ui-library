import type { Decision, Status } from '../types.ts';

/** §4.5 — `stories` are the statuses of active (not Canceled) child user stories. */
export function usecaseStatus(stories: Status[]): Decision {
  if (stories.length === 0) return { status: 'new', reason: 'no user stories' };
  if (stories.every((s) => s === 'done')) return { status: 'done', reason: 'all user stories done' };
  if (stories.some((s) => s !== 'new')) return { status: 'inProgress', reason: 'user stories in progress' };
  return { status: 'new', reason: 'all user stories are New' };
}
