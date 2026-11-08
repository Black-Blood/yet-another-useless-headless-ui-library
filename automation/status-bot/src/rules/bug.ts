import type { Decision } from '../types.ts';
import { taskStatus } from './task.ts';
import type { Work } from './work.ts';

/** §4.3 — the task rows, except that an active merged PR means In Review (verification). */
export function bugStatus(work: Work): Decision & { verification: boolean } {
  const decision = taskStatus(work);
  if (decision.status !== 'done') return { ...decision, verification: false };
  return {
    status: 'inReview',
    reason: `PR #${work.activeMerged[0].number} merged into develop — awaiting verification`,
    verification: true,
  };
}
