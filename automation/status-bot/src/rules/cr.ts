import type { Decision, Status } from '../types.ts';

/** §4.6 — `linked` are the statuses of active user stories / use cases in "Blocked by". */
export function crStatus(linked: Status[]): Decision {
  if (linked.length === 0) return { status: 'new', reason: 'no linked issues' };
  if (linked.every((s) => s === 'done')) return { status: 'done', reason: 'all linked issues done' };
  return { status: 'inProgress', reason: 'linked issues in progress' };
}
