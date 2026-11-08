import type { Decision } from '../types.ts';
import type { Work } from './work.ts';

/** §4.2 — first matching row wins. */
export function taskStatus(work: Work): Decision {
  if (work.openReady.length > 0) return { status: 'inReview', reason: `PR #${work.openReady[0]} opened (not draft)` };
  if (work.openDraft.length > 0) return { status: 'inProgress', reason: `draft PR #${work.openDraft[0]} open` };
  if (work.activeMerged.length > 0) {
    return { status: 'done', reason: `PR #${work.activeMerged[0].number} merged into develop` };
  }
  if (work.branches.length > 0) return { status: 'inProgress', reason: `branch ${work.branches[0]} exists` };
  if (work.reverted.length > 0) return { status: 'new', reason: `PR #${work.reverted.at(-1)} reverted` };
  return { status: 'new', reason: 'no branches or pull requests' };
}
