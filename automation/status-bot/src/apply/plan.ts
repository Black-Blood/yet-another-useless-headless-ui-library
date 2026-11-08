import { renderCard } from '../collect/marker.ts';
import type { Action, Config, Desired, Facts, IssueFacts, IssueState } from '../types.ts';

/** §6.2 — open issues by repository members that are not in the Project yet. */
export function planAdditions(facts: Facts): Action[] {
  return [...facts.issues.values()]
    .filter((i) => i.itemId === null && i.state.open && i.authorIsMember)
    .sort((a, b) => a.number - b.number)
    .map((i) => ({ kind: 'addToProject', issue: i.number, nodeId: i.nodeId }));
}

const sameState = (a: IssueState, b: IssueState) =>
  a.open === b.open && (a.open || (a.reason ?? 'completed') === (b.reason ?? 'completed'));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** §6.1 — the writes that turn `current` into `desired`, in write order. */
export function planIssue(current: IssueFacts, desired: Desired, config: Config): Action[] {
  const actions: Action[] = [];
  const n = current.number;
  const body = renderCard(desired.marker, desired.reason, desired.warnings, config.statuses);
  if (current.card?.body !== body) {
    actions.push({ kind: 'writeCard', issue: n, commentId: current.card?.commentId ?? null, body });
  }
  if (desired.status !== null && current.itemId !== null && current.projectStatus !== desired.status) {
    actions.push({ kind: 'setStatus', issue: n, itemId: current.itemId, status: desired.status });
  }
  if (desired.state !== null && !sameState(current.state, desired.state)) {
    actions.push({ kind: 'setState', issue: n, state: desired.state });
  }
  if (desired.assignees !== null && !sameSet(current.assignees, desired.assignees)) {
    actions.push({ kind: 'setAssignees', issue: n, assignees: desired.assignees });
  }
  return actions;
}

/** §6.3 — the change limit. */
export function buildPlan(
  perIssue: Action[][],
  limit: number,
  force: boolean,
): { actions: Action[]; changedIssues: number; blocked: boolean } {
  const changed = perIssue.filter((a) => a.length > 0);
  return { actions: changed.flat(), changedIssues: changed.length, blocked: !force && changed.length > limit };
}
