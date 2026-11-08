/**
 * Entry point. Run with `deno task start`; permissions are limited to the listed environment variables,
 * reading config.yml and network access to api.github.com. The run report goes to stdout.
 */
import { execute } from './apply/execute.ts';
import type { Clients, RunResult } from './apply/execute.ts';
import { buildPlan, planAdditions, planIssue, withAddedItems } from './apply/plan.ts';
import { renderSummary } from './apply/summary.ts';
import { createClient } from './client.ts';
import { toFacts } from './collect/facts.ts';
import { fetchProject, fetchRepo } from './collect/github.ts';
import { loadConfig } from './config.ts';
import { reconcile } from './rules/reconcile.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`${name} is required`);
    Deno.exit(1);
  }
  return value;
}

async function main(): Promise<number> {
  const token = required('GITHUB_TOKEN');
  const projectToken = required('PROJECT_TOKEN');
  const repo = required('GITHUB_REPOSITORY');
  const dryRun = Deno.env.get('DRY_RUN') === 'true';
  const force = Deno.env.get('FORCE') === 'true';
  const config = loadConfig(new URL('../config.yml', import.meta.url));
  const [owner, name] = repo.split('/');

  const repoClient = createClient({ token });
  const projectClient = createClient({ token: projectToken });
  const clients: Clients = { projectGql: projectClient.graphql, rest: { request: repoClient.request } };
  const collect = async () =>
    toFacts(
      {
        project: await fetchProject(projectClient, config.project.owner, config.project.number, config.project.statusField),
        repo: await fetchRepo(repoClient, owner, name),
      },
      config,
      repo,
      new Date().toISOString(),
    );

  const collected = await collect();
  const meta = collected.meta;
  let facts = collected.facts;
  const result: RunResult = { done: [], errors: [], added: [] };
  const merge = (r: RunResult) => {
    result.done.push(...r.done);
    result.errors.push(...r.errors);
    result.added.push(...r.added);
  };

  // §6.2 — add members' issues first and reconcile them in this run, using the item ids GitHub returned.
  const additions = planAdditions(facts);
  if (additions.length > 0) {
    merge(await execute(additions, clients, meta, repo, dryRun));
    facts = withAddedItems(facts, result.added);
  }

  const desired = reconcile(facts, config);
  const plan = buildPlan(
    desired.map((d) => planIssue(facts.issues.get(d.number)!, d, config)),
    config.maxChangesPerRun,
    force,
  );
  if (!plan.blocked) merge(await execute(plan.actions, clients, meta, repo, dryRun));

  console.log(
    renderSummary({
      result,
      blocked: plan.blocked,
      dryRun,
      planned: [...additions, ...plan.actions],
      skipped: desired.filter((d) => d.status === null).map((d) => ({ issue: d.number, reason: d.reason })),
    }),
  );
  return plan.blocked || result.errors.length > 0 ? 1 : 0;
}

Deno.exitCode = await main();
