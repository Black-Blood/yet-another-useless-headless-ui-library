export type Status = 'new' | 'inProgress' | 'inReview' | 'done' | 'canceled';
export type IssueType = 'bug' | 'task' | 'story' | 'usecase' | 'cr';
export interface IssueState { open: boolean; reason: 'completed' | 'not_planned' | null }

export const STATUSES: readonly Status[] = ['new', 'inProgress', 'inReview', 'done', 'canceled'];
export const ISSUE_TYPES: readonly IssueType[] = ['bug', 'task', 'story', 'usecase', 'cr'];

export interface Config {
  project: { owner: string; number: number; statusField: string };
  statuses: Record<Status, string>;
  integrationBranch: string;
  branchPrefix: { task: string; bug: string };
  typeLabels: Record<IssueType, string>;
  qa: string[];
  maxChangesPerRun: number;
  historySize: number;
}

export interface HistoryEntry { at: string; from: Status | null; to: Status; reason: string }
export interface Marker {
  v: 1;
  status: Status;
  source: 'bot' | 'manual';
  epoch: string | null;
  /** the last accepted manual status (§4.1, §4.4) */
  held: Status | null;
  at: string;
  verifyAssigned: boolean;
  history: HistoryEntry[];
}
export interface Card { commentId: number; body: string; marker: Marker }

export interface PullFact {
  number: number;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  baseRef: string;
  headRef: string;
  author: string;
  authorIsMember: boolean;
  body: string;
  createdAt: string;
  mergedAt: string | null;
  /** SHA of the commit the merge created in the base branch; null unless merged */
  mergeCommit: string | null;
  closingIssues: number[];
}
export interface BranchFact { name: string; lastCommitAt: string }

export interface IssueFacts {
  number: number;
  nodeId: string;
  itemId: string | null;
  type: IssueType | null;
  typeProblem: string | null;
  state: IssueState;
  stateChangedAt: string | null;
  author: string;
  authorIsMember: boolean;
  assignees: string[];
  createdAt: string;
  parent: number | null;
  children: number[];
  blockedBy: number[];
  projectStatus: Status | null;
  projectStatusUpdatedAt: string | null;
  projectStatusUpdatedBy: string | null;
  card: Card | null;
}
export interface Facts {
  now: string;
  repo: string;
  issues: Map<number, IssueFacts>;
  pulls: PullFact[];
  branches: BranchFact[];
}

export interface Decision { status: Status; reason: string }
export interface Desired {
  number: number;
  /** null: leave the Project status untouched */
  status: Status | null;
  /** null: leave open/closed untouched */
  state: IssueState | null;
  /** null: leave assignees untouched */
  assignees: string[] | null;
  marker: Marker;
  reason: string;
  warnings: string[];
}

export interface ProjectMeta { projectId: string; statusFieldId: string; optionIds: Record<Status, string> }
export type Action =
  | { kind: 'addToProject'; issue: number; nodeId: string }
  | { kind: 'writeCard'; issue: number; commentId: number | null; body: string }
  | { kind: 'setStatus'; issue: number; itemId: string; status: Status }
  | { kind: 'setState'; issue: number; state: IssueState }
  | { kind: 'setAssignees'; issue: number; assignees: string[] };
