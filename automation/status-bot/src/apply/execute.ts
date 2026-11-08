import type { Action, ProjectMeta } from '../types.ts';

export interface Clients {
  /** GraphQL with PROJECT_TOKEN */
  projectGql: (query: string, vars: Record<string, unknown>) => Promise<unknown>;
  /** REST with GITHUB_TOKEN */
  rest: { request: (route: string, params: Record<string, unknown>) => Promise<unknown> };
}
export interface RunResult { done: Action[]; errors: { action: Action; message: string }[] }

const ADD_ITEM = `mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}`;
const SET_STATUS = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
  ) { projectV2Item { id } }
}`;

async function run(action: Action, clients: Clients, meta: ProjectMeta, owner: string, repo: string): Promise<void> {
  const base = { owner, repo };
  switch (action.kind) {
    case 'addToProject':
      await clients.projectGql(ADD_ITEM, { projectId: meta.projectId, contentId: action.nodeId });
      return;
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
  if (dryRun) return { done: [...actions], errors: [] };
  const [owner, name] = repo.split('/');
  const result: RunResult = { done: [], errors: [] };
  const failed = new Set<number>();
  for (const action of actions) {
    if (failed.has(action.issue)) continue;
    try {
      await run(action, clients, meta, owner, name);
      result.done.push(action);
    } catch (error) {
      failed.add(action.issue);
      result.errors.push({ action, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
