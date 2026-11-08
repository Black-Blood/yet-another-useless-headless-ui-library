import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import type { BranchFact, Config, Facts, IssueFacts, Marker, PullFact } from '../src/types.ts';

export const CONFIG_PATH = fileURLToPath(new URL('../config.yml', import.meta.url));
export const REPO = 'Black-Blood/yet-another-useless-headless-ui-library';
export const testConfig: Config = loadConfig(CONFIG_PATH);

export function pull(p: Partial<PullFact> & { number: number }): PullFact {
  return {
    state: 'open',
    draft: false,
    baseRef: 'develop',
    headRef: 'feature/1-x',
    author: 'dev',
    authorIsMember: true,
    body: '',
    createdAt: '2026-11-01T00:00:00Z',
    mergedAt: null,
    closingIssues: [],
    ...p,
  };
}

export function branch(name: string, lastCommitAt = '2026-11-01T00:00:00Z'): BranchFact {
  return { name, lastCommitAt };
}

export function marker(p: Partial<Marker> = {}): Marker {
  return {
    v: 1,
    status: 'new',
    source: 'bot',
    epoch: null,
    held: null,
    at: '2026-11-01T00:00:00Z',
    verifyAssigned: false,
    history: [],
    ...p,
  };
}

export function issue(p: Partial<IssueFacts> & { number: number }): IssueFacts {
  return {
    nodeId: `I_${p.number}`,
    itemId: `PVTI_${p.number}`,
    type: 'task',
    typeProblem: null,
    state: { open: true, reason: null },
    stateChangedAt: null,
    author: 'dev',
    authorIsMember: true,
    assignees: [],
    createdAt: '2026-11-01T00:00:00Z',
    parent: null,
    children: [],
    blockedBy: [],
    projectStatus: null,
    projectStatusUpdatedAt: null,
    projectStatusUpdatedBy: null,
    card: null,
    ...p,
  };
}

export function facts(
  issues: IssueFacts[],
  pulls: PullFact[] = [],
  branches: BranchFact[] = [],
  now = '2026-11-08T12:00:00Z',
): Facts {
  return { now, repo: REPO, issues: new Map(issues.map((i) => [i.number, i])), pulls, branches };
}
