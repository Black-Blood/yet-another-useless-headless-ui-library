import type { PullFact } from '../types.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** PR numbers named by `Reverts #N` / `Reverts owner/repo#N` lines (same repository only). */
export function revertTargets(body: string, repo: string): number[] {
  const re = new RegExp(`^Reverts (?:${escape(repo)})?#(\\d+)\\b`, 'gm');
  return [...body.matchAll(re)].map((m) => Number(m[1]));
}

/** PRs merged into the integration branch that are not (effectively) reverted. */
export function activeMerged(pulls: PullFact[], integrationBranch: string, repo: string): Set<number> {
  const merged = pulls.filter((p) => p.state === 'merged' && p.baseRef === integrationBranch);
  const revertedBy = new Map<number, number[]>();
  for (const r of merged) {
    for (const target of revertTargets(r.body, repo)) {
      revertedBy.set(target, [...(revertedBy.get(target) ?? []), r.number]);
    }
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
