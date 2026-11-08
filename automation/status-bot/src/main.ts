import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Octokit } from 'octokit';
import { execute } from './apply/execute.ts';
import type { Clients, RunResult } from './apply/execute.ts';
import { buildPlan, planAdditions, planIssue } from './apply/plan.ts';
import { renderSummary } from './apply/summary.ts';
import { toFacts } from './collect/facts.ts';
import { fetchProject, fetchRepo } from './collect/github.ts';
import { loadConfig } from './config.ts';
import { reconcile } from './rules/reconcile.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

function client(auth: string): Octokit {
  return new Octokit({
    auth,
    throttle: {
      onRateLimit: (_after: number, _options: unknown, _octokit: unknown, retryCount: number) => retryCount < 2,
      onSecondaryRateLimit: (_after: number, _options: unknown, _octokit: unknown, retryCount: number) => retryCount < 2,
    },
  });
}

async function main(): Promise<number> {
  const token = required('GITHUB_TOKEN');
  const projectToken = required('PROJECT_TOKEN');
  const repo = required('GITHUB_REPOSITORY');
  const dryRun = process.env.DRY_RUN === 'true';
  const force = process.env.FORCE === 'true';
  const config = loadConfig(fileURLToPath(new URL('../config.yml', import.meta.url)));
  const [owner, name] = repo.split('/');

  const repoKit = client(token);
  const projectKit = client(projectToken);
  const clients: Clients = {
    projectGql: (query, vars) => projectKit.graphql(query, vars),
    rest: { request: (route, params) => repoKit.request(route, params) },
  };
  const collect = async () =>
    toFacts(
      {
        project: await fetchProject(projectKit.graphql, config.project.owner, config.project.number, config.project.statusField),
        repo: await fetchRepo(repoKit.graphql, owner, name),
      },
      config,
      repo,
      new Date().toISOString(),
    );

  let { facts, meta } = await collect();
  const result: RunResult = { done: [], errors: [] };
  const merge = (r: RunResult) => {
    result.done.push(...r.done);
    result.errors.push(...r.errors);
  };

  // §6.2 — add members' issues first, then look again so they are reconciled in this run.
  const additions = planAdditions(facts);
  if (additions.length > 0) {
    merge(await execute(additions, clients, meta, repo, dryRun));
    if (!dryRun) ({ facts, meta } = await collect());
  }

  const desired = reconcile(facts, config);
  const plan = buildPlan(
    desired.map((d) => planIssue(facts.issues.get(d.number)!, d, config)),
    config.maxChangesPerRun,
    force,
  );
  if (!plan.blocked) merge(await execute(plan.actions, clients, meta, repo, dryRun));

  const summary = renderSummary({
    result,
    blocked: plan.blocked,
    dryRun,
    planned: [...additions, ...plan.actions],
    skipped: desired.filter((d) => d.status === null).map((d) => ({ issue: d.number, reason: d.reason })),
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  return plan.blocked || result.errors.length > 0 ? 1 : 0;
}

process.exitCode = await main();
