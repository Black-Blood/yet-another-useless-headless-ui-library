import { STATUSES, ISSUE_TYPES } from '../types.ts';
import type { Config, Facts, IssueFacts, IssueState, IssueType, ProjectMeta, PullFact, Status } from '../types.ts';
import type { RawIssue, RawProject, RawRepo } from './github.ts';
import { parseBranch } from './branch-name.ts';
import { findCard } from './marker.ts';

const MEMBER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

function issueState(raw: RawIssue): IssueState {
  if (raw.state === 'OPEN') return { open: true, reason: null };
  return { open: false, reason: raw.stateReason === 'NOT_PLANNED' || raw.stateReason === 'DUPLICATE' ? 'not_planned' : 'completed' };
}

/** Pure mapping of API results to Facts (+ the ids needed to write the Status field). */
export function toFacts(
  raw: { project: RawProject; repo: RawRepo },
  config: Config,
  repo: string,
  now: string,
): { facts: Facts; meta: ProjectMeta } {
  const field = raw.project.field;
  if (!field) throw new Error(`Status field "${config.project.statusField}" not found in the Project`);
  const optionIds = {} as Record<Status, string>;
  for (const s of STATUSES) {
    const option = field.options.find((o) => o.name === config.statuses[s]);
    if (!option) throw new Error(`Status option "${config.statuses[s]}" not found in field ${config.project.statusField}`);
    optionIds[s] = option.id;
  }
  const meta: ProjectMeta = { projectId: raw.project.id, statusFieldId: field.id, optionIds };

  const statusByName = new Map(STATUSES.map((s) => [config.statuses[s], s]));
  const typeByLabel = new Map(ISSUE_TYPES.map((t) => [config.typeLabels[t], t]));

  const items = new Map<number, RawProject['items'][number]>();
  for (const item of raw.project.items) {
    const n = item.content?.number;
    if (n !== undefined && item.content?.repository?.nameWithOwner === repo) items.set(n, item);
  }

  const issues = new Map<number, IssueFacts>();
  for (const r of raw.repo.issues) {
    const typeLabels = r.labels.nodes.map((l) => l.name).filter((name) => typeByLabel.has(name));
    const type: IssueType | null = typeLabels.length === 1 ? typeByLabel.get(typeLabels[0])! : null;
    const typeProblem =
      typeLabels.length === 0 ? 'no type label' : typeLabels.length > 1 ? `several type labels: ${typeLabels.join(', ')}` : null;
    const item = items.get(r.number);
    const value = item?.fieldValueByName ?? null;
    issues.set(r.number, {
      number: r.number,
      nodeId: r.id,
      itemId: item?.id ?? null,
      type,
      typeProblem,
      state: issueState(r),
      stateChangedAt: r.timelineItems.nodes[0]?.createdAt ?? null,
      author: r.author?.login ?? 'ghost',
      authorIsMember: MEMBER.has(r.authorAssociation),
      assignees: r.assignees.nodes.map((a) => a.login),
      createdAt: r.createdAt,
      parent: r.parent?.number ?? null,
      children: r.subIssues.nodes.map((c) => c.number),
      blockedBy: r.blockedBy.nodes.map((c) => c.number),
      projectStatus: value ? (statusByName.get(value.name) ?? null) : null,
      projectStatusUpdatedAt: value?.updatedAt ?? null,
      projectStatusUpdatedBy: value?.creator?.login ?? null,
      card: findCard(
        r.comments.nodes.map((c) => ({ id: c.databaseId, author: c.author?.login ?? '', createdAt: c.createdAt, body: c.body })),
      ),
    });
  }

  const pulls: PullFact[] = raw.repo.pulls.map((p) => ({
    number: p.number,
    state: p.state === 'OPEN' ? 'open' : p.state === 'MERGED' ? 'merged' : 'closed',
    draft: p.isDraft,
    baseRef: p.baseRefName,
    headRef: p.headRefName,
    author: p.author?.login ?? 'ghost',
    authorIsMember: MEMBER.has(p.authorAssociation),
    body: p.body,
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    mergeCommit: p.state === 'MERGED' ? (p.mergeCommit?.oid ?? null) : null,
    closingIssues: p.closingIssuesReferences.nodes.map((i) => i.number),
  }));

  const branches = raw.repo.refs
    .filter((r) => parseBranch(r.name, config.branchPrefix) !== null)
    .map((r) => ({ name: r.name, lastCommitAt: r.target?.committedDate ?? '1970-01-01T00:00:00Z' }));

  return { facts: { now, repo, issues, pulls, branches }, meta };
}
