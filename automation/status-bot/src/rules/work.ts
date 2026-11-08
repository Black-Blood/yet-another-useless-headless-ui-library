import { parseBranch } from '../collect/branch-name.ts';
import type { Config, Facts, PullFact } from '../types.ts';

export interface Work {
  /** open, not draft, linked, base = integration branch */
  openReady: number[];
  openDraft: number[];
  /** active merged PRs, after the epoch filter */
  activeMerged: PullFact[];
  /** active merged PRs, ignoring the epoch (used by the Canceled guard) */
  allActiveMerged: number[];
  /** matching branches, after the epoch filter */
  branches: string[];
  warnings: string[];
}

/** Branches and PRs that belong to a task or bug (§3.4), with the epoch filter of §4.1. */
export function collectWork(
  issue: number,
  kind: 'task' | 'bug',
  facts: Facts,
  active: Set<number>,
  config: Config,
  epoch: string | null,
): Work {
  const warnings = new Set<string>();
  const after = (time: string) => epoch === null || Date.parse(time) > Date.parse(epoch);
  const mismatch = (name: string) =>
    warnings.add(`Branch ${name} does not match the type of issue #${issue} (${kind}) — ignored`);

  const belongs = (headRef: string, closingIssues: number[]): boolean => {
    const parsed = parseBranch(headRef, config.branchPrefix);
    if (!parsed) return closingIssues.includes(issue);
    if (parsed.number !== issue) return false;
    if (parsed.kind !== kind) {
      mismatch(headRef);
      return false;
    }
    return true;
  };

  const work: Work = { openReady: [], openDraft: [], activeMerged: [], allActiveMerged: [], branches: [], warnings: [] };
  for (const p of [...facts.pulls].sort((a, b) => a.number - b.number)) {
    if (!belongs(p.headRef, p.closingIssues)) continue;
    if (p.baseRef !== config.integrationBranch) {
      if (p.state === 'open') {
        warnings.add(`PR #${p.number} targets ${p.baseRef}, not ${config.integrationBranch} — ignored`);
      }
      continue;
    }
    if (p.state === 'open') {
      (p.draft ? work.openDraft : work.openReady).push(p.number);
    } else if (p.state === 'merged' && active.has(p.number)) {
      work.allActiveMerged.push(p.number);
      if (p.mergedAt !== null && after(p.mergedAt)) work.activeMerged.push(p);
    }
  }

  for (const b of facts.branches) {
    const parsed = parseBranch(b.name, config.branchPrefix);
    if (!parsed || parsed.number !== issue) continue;
    if (parsed.kind !== kind) mismatch(b.name);
    else if (after(b.lastCommitAt)) work.branches.push(b.name);
  }

  work.warnings = [...warnings];
  return work;
}
