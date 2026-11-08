import type { PullFact } from '../types.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** PR numbers named by `Reverts #N` / `Reverts owner/repo#N` lines (same repository only). */
export function revertTargets(body: string, repo: string): number[] {
  const re = new RegExp(`^Reverts (?:${escape(repo)})?#(\\d+)\\b`, 'gm');
  return [...body.matchAll(re)].map((m) => Number(m[1]));
}

/** Commit SHAs named by `This reverts commit <sha>` (the GitHub Revert button and `git revert`), lower-cased. */
export function revertedShas(body: string): string[] {
  return [...body.matchAll(/This reverts commit ([0-9a-f]{7,40})\b/gi)].map((m) => m[1].toLowerCase());
}

/** PRs merged into the integration branch that are not (effectively) reverted. */
export function activeMerged(pulls: PullFact[], integrationBranch: string, repo: string): Set<number> {
  const merged = pulls.filter((p) => p.state === 'merged' && p.baseRef === integrationBranch);
  const bySha = (sha: string) => merged.filter((p) => p.mergeCommit?.toLowerCase().startsWith(sha)).map((p) => p.number);

  const revertedBy = new Map<number, number[]>();
  for (const r of merged) {
    const targets = new Set([...revertTargets(r.body, repo), ...revertedShas(r.body).flatMap(bySha)]);
    targets.delete(r.number);
    for (const target of targets) revertedBy.set(target, [...(revertedBy.get(target) ?? []), r.number]);
  }

  const memo = new Map<number, boolean>();
  const visiting = new Set<number>();
  const isReverted = (n: number): boolean => {
    const known = memo.get(n);
    if (known !== undefined) return known;
    if (visiting.has(n)) return false;
    visiting.add(n);
    const result = (revertedBy.get(n) ?? []).some((r) => !isReverted(r));
    visiting.delete(n);
    memo.set(n, result);
    return result;
  };

  return new Set(merged.filter((p) => !isReverted(p.number)).map((p) => p.number));
}
