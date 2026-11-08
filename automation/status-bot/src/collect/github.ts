/** Thin GraphQL I/O. Every query has exactly one paginated connection (`$cursor`). */

export interface Gql {
  paginate: <T>(query: string, vars?: Record<string, unknown>) => Promise<T>;
}

type Nodes<T> = { nodes: T[] };

export interface RawProject {
  id: string;
  field: { id: string; options: { id: string; name: string }[] } | null;
  items: RawItem[];
}
export interface RawItem {
  id: string;
  content: { number?: number; repository?: { nameWithOwner: string } } | null;
  fieldValueByName: { name: string; updatedAt: string; creator: { login: string } | null } | null;
}
export interface RawIssue {
  id: string;
  number: number;
  state: 'OPEN' | 'CLOSED';
  stateReason: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED' | null;
  createdAt: string;
  author: { login: string } | null;
  authorAssociation: string;
  labels: Nodes<{ name: string }>;
  assignees: Nodes<{ login: string }>;
  parent: { number: number } | null;
  subIssues: Nodes<{ number: number }>;
  blockedBy: Nodes<{ number: number }>;
  timelineItems: Nodes<{ createdAt?: string }>;
  comments: Nodes<{ databaseId: number; createdAt: string; body: string; author: { login: string } | null }>;
}
export interface RawPull {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  body: string;
  createdAt: string;
  mergedAt: string | null;
  author: { login: string } | null;
  authorAssociation: string;
  closingIssuesReferences: Nodes<{ number: number }>;
}
export interface RawRef { name: string; target: { committedDate?: string } | null }
export interface RawRepo { issues: RawIssue[]; pulls: RawPull[]; refs: RawRef[] }

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

const PROJECT_QUERY = `
query($owner: String!, $number: Int!, $field: String!, $cursor: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      field(name: $field) { ... on ProjectV2SingleSelectField { id options { id name } } }
      items(first: 100, after: $cursor) {
        nodes {
          id
          content { ... on Issue { number repository { nameWithOwner } } }
          fieldValueByName(name: $field) {
            ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt creator { login } }
          }
        }
        ${PAGE_INFO}
      }
    }
  }
}`;

const ISSUES_QUERY = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $cursor, states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes {
        id number state stateReason createdAt
        author { login }
        authorAssociation
        labels(first: 20) { nodes { name } }
        assignees(first: 10) { nodes { login } }
        parent { number }
        subIssues(first: 100) { nodes { number } }
        blockedBy(first: 50) { nodes { number } }
        timelineItems(itemTypes: [CLOSED_EVENT, REOPENED_EVENT], last: 1) {
          nodes { ... on ClosedEvent { createdAt } ... on ReopenedEvent { createdAt } }
        }
        comments(last: 100) { nodes { databaseId createdAt body author { login } } }
      }
      ${PAGE_INFO}
    }
  }
}`;

const PULLS_QUERY = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $cursor, states: [OPEN, CLOSED, MERGED]) {
      nodes {
        number state isDraft baseRefName headRefName body createdAt mergedAt
        author { login }
        authorAssociation
        closingIssuesReferences(first: 10) { nodes { number } }
      }
      ${PAGE_INFO}
    }
  }
}`;

const REFS_QUERY = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
      nodes { name target { ... on Commit { committedDate } } }
      ${PAGE_INFO}
    }
  }
}`;

export async function fetchProject(gql: Gql, owner: string, number: number, statusField: string): Promise<RawProject> {
  const res = await gql.paginate<{
    user: { projectV2: { id: string; field: RawProject['field']; items: Nodes<RawItem> } | null } | null;
  }>(PROJECT_QUERY, { owner, number, field: statusField });
  const p = res.user?.projectV2;
  if (!p) throw new Error(`Project ${owner}/${number} not found`);
  return { id: p.id, field: p.field && 'id' in p.field ? p.field : null, items: p.items.nodes };
}

export async function fetchRepo(gql: Gql, owner: string, repo: string): Promise<RawRepo> {
  const vars = { owner, name: repo };
  const [issues, pulls, refs] = await Promise.all([
    gql.paginate<{ repository: { issues: Nodes<RawIssue> } }>(ISSUES_QUERY, vars),
    gql.paginate<{ repository: { pullRequests: Nodes<RawPull> } }>(PULLS_QUERY, vars),
    gql.paginate<{ repository: { refs: Nodes<RawRef> } }>(REFS_QUERY, vars),
  ]);
  return {
    issues: issues.repository.issues.nodes,
    pulls: pulls.repository.pullRequests.nodes,
    refs: refs.repository.refs.nodes,
  };
}
