import type { IssueFacts, IssueState, IssueType, Status } from '../types.ts';

export interface ManualChange { to: Status; at: string; by: string | null }
export interface ManualContext {
  type: IssueType;
  from: Status;
  bugVerification: boolean;
  /** config.statuses, for reason texts */
  names: Record<Status, string>;
  /** active merged PRs in the issue's subtree (§5.3) */
  activeCodePulls: number[];
  /** story: active children */
  tasks: Status[];
  bugs: Status[];
  /** usecase: all children, Canceled included */
  stories: Status[];
  /** cr: all linked, Canceled included */
  linked: Status[];
}
export type Verdict = { accept: true } | { accept: false; reason: string };

const TYPE_NAMES: Record<IssueType, string> = {
  task: 'task',
  bug: 'bug',
  story: 'user story',
  usecase: 'use case',
  cr: 'change request',
};

/** §4.7 */
export function stateFor(status: Status): IssueState {
  if (status === 'done') return { open: false, reason: 'completed' };
  if (status === 'canceled') return { open: false, reason: 'not_planned' };
  return { open: true, reason: null };
}

const after = (time: string | null, ref: string) => time !== null && Date.parse(time) > Date.parse(ref);

/** §5.1 — a difference from the marker that happened after the bot's last write. */
export function detectManual(issue: IssueFacts): ManualChange | null {
  const marker = issue.card?.marker;
  if (!marker) return null;

  if (issue.projectStatus !== null && issue.projectStatus !== marker.status) {
    if (!after(issue.projectStatusUpdatedAt, marker.at)) return null;
    return { to: issue.projectStatus, at: issue.projectStatusUpdatedAt!, by: issue.projectStatusUpdatedBy };
  }

  const expected = stateFor(marker.status);
  const actual = issue.state;
  const sameState = actual.open === expected.open && (actual.open || (actual.reason ?? 'completed') === expected.reason);
  if (sameState || !after(issue.stateChangedAt, marker.at)) return null;
  const to: Status = actual.open ? 'new' : actual.reason === 'not_planned' ? 'canceled' : 'done';
  if (to === marker.status) return null;
  return { to, at: issue.stateChangedAt!, by: null };
}

/** §5.2 / §5.3 — is this manual change allowed? */
export function judgeManual(change: ManualChange, ctx: ManualContext): Verdict {
  const { from, type, names } = ctx;
  const { to } = change;
  const reject = (reason: string): Verdict => ({ accept: false, reason });

  if (to === 'canceled') {
    if (ctx.activeCodePulls.length > 0) {
      return reject(`revert PR ${ctx.activeCodePulls.map((n) => `#${n}`).join(', ')} first`);
    }
    if (type === 'usecase' && !ctx.stories.every((s) => s === 'canceled')) {
      return reject('all user stories must be Canceled');
    }
    if (type === 'cr' && from !== 'new' && !ctx.linked.every((s) => s === 'canceled')) {
      return reject('all linked issues must be Canceled');
    }
    return { accept: true };
  }
  if (from === 'canceled' && to === 'new') return { accept: true };
  if (type === 'bug' && from === 'inReview' && (to === 'done' || to === 'new')) {
    return ctx.bugVerification
      ? { accept: true }
      : reject(`${names.inReview} → ${names[to]} is allowed only during verification`);
  }
  if (type === 'story' && from === 'inReview' && to === 'done') {
    return [...ctx.tasks, ...ctx.bugs].every((s) => s === 'done')
      ? { accept: true }
      : reject('all tasks and bugs must be Done');
  }
  return reject(`manual change from ${names[from]} to ${names[to]} is not allowed for ${TYPE_NAMES[type]}`);
}
