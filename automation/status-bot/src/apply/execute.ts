import type { Action, ProjectMeta } from '../types.ts';

export interface Clients {
  /** GraphQL with PROJECT_TOKEN */
  projectGql: (query: string, vars: Record<string, unknown>) => Promise<unknown>;
  /** REST with GITHUB_TOKEN */
  rest: { request: (route: string, params: Record<string, unknown>) => Promise<unknown> };
}
export interface RunResult {
  done: Action[];
  errors: { action: Action; message: string }[];
  /** item ids of issues added to the Project in this run (placeholders in a dry run) */
  added: { issue: number; itemId: string }[];
}

const ADD_ITEM = `mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}`;
const SET_STATUS = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
  ) { projectV2Item { id } }
}`;

/** Runs one action; for addToProject, returns the new item's id. */
async function run(
  action: Action,
  clients: Clients,
  meta: ProjectMeta,
  owner: string,
  repo: string,
): Promise<string | void> {
  const base = { owner, repo };
  switch (action.kind) {
    case 'addToProject': {
      const res = (await clients.projectGql(ADD_ITEM, { projectId: meta.projectId, contentId: action.nodeId })) as {
        addProjectV2ItemById?: { item?: { id?: string } };
      };
      const id = res.addProjectV2ItemById?.item?.id;
      if (!id) throw new Error(`addProjectV2ItemById returned no item id for #${action.issue}`);
      return id;
    }
    case 'setStatus':
      await clients.projectGql(SET_STATUS, {
        projectId: meta.projectId,
        itemId: action.itemId,
        fieldId: meta.statusFieldId,
        optionId: meta.optionIds[action.status],
      });
      return;
    case 'writeCard':
      if (action.commentId === null) {
        await clients.rest.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          ...base,
          issue_number: action.issue,
          body: action.body,
        });
      } else {
        await clients.rest.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
          ...base,
          comment_id: action.commentId,
          body: action.body,
        });
      }
      return;
    case 'setState':
      await clients.rest.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
        ...base,
        issue_number: action.issue,
        ...(action.state.open
          ? { state: 'open' }
          : { state: 'closed', state_reason: action.state.reason ?? 'completed' }),
      });
      return;
    case 'setAssignees':
      await clients.rest.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
        ...base,
        issue_number: action.issue,
        assignees: action.assignees,
      });
      return;
  }
}

/** §6.1 / §6.4 — actions run in order; an error skips the rest of that issue's actions only. */
export async function execute(
  actions: Action[],
  clients: Clients,
  meta: ProjectMeta,
  repo: string,
  dryRun: boolean,
): Promise<RunResult> {
  if (dryRun) {
    const added = actions.filter((a) => a.kind === 'addToProject').map((a) => ({ issue: a.issue, itemId: `dry-run:${a.issue}` }));
    return { done: [...actions], errors: [], added };
  }
  const [owner, name] = repo.split('/');
  const result: RunResult = { done: [], errors: [], added: [] };
  const failed = new Set<number>();
  for (const action of actions) {
    if (failed.has(action.issue)) continue;
    try {
      const itemId = await run(action, clients, meta, owner, name);
      if (action.kind === 'addToProject' && itemId) result.added.push({ issue: action.issue, itemId });
      result.done.push(action);
    } catch (error) {
      failed.add(action.issue);
      result.errors.push({ action, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
