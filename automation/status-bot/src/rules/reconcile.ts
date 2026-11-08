import { appendHistory } from '../collect/marker.ts';
import { activeMerged } from '../collect/revert.ts';
import type { Config, Decision, Desired, Facts, HistoryEntry, IssueFacts, IssueType, Marker, Status } from '../types.ts';
import { bugStatus } from './bug.ts';
import { crStatus } from './cr.ts';
import { detectManual, judgeManual, stateFor } from './manual.ts';
import type { ManualContext } from './manual.ts';
import { pickQa } from './qa.ts';
import { storyStatus } from './story.ts';
import { taskStatus } from './task.ts';
import { usecaseStatus } from './usecase.ts';
import { collectWork } from './work.ts';

const LAYER: Record<IssueType, number> = { task: 0, bug: 0, story: 1, usecase: 2, cr: 3 };
const TYPE_NAMES: Record<IssueType, string> = {
  task: 'task',
  bug: 'bug',
  story: 'user story',
  usecase: 'use case',
  cr: 'change request',
};

/** Desired state of every issue in the Project (§4–§5), computed bottom-up. */
export function reconcile(facts: Facts, config: Config): Desired[] {
  const { now } = facts;
  const names = config.statuses;
  const active = activeMerged(facts.pulls, config.integrationBranch, facts.repo);
  const results = new Map<number, Desired>();
  const get = (n: number) => facts.issues.get(n);

  const workOf = (i: IssueFacts, epoch: string | null) =>
    collectWork(i.number, i.type === 'bug' ? 'bug' : 'task', facts, active, config, epoch);

  // Active merged PRs in an issue's subtree, for the Canceled guard (§5.3).
  const codeMemo = new Map<number, number[]>();
  const codeOf = (n: number, seen = new Set<number>()): number[] => {
    const memo = codeMemo.get(n);
    if (memo) return memo;
    const i = get(n);
    if (!i || seen.has(n)) return [];
    seen.add(n);
    // Only the relationships the rules count (§3.3): story → task/bug, usecase → story, cr → story/usecase.
    const of = (ids: number[], allowed: IssueType[]) =>
      ids.filter((c) => allowed.includes(get(c)?.type as IssueType)).flatMap((c) => codeOf(c, seen));
    let code: number[] = [];
    if (i.type === 'task' || i.type === 'bug') code = workOf(i, null).allActiveMerged;
    else if (i.type === 'story') code = of(i.children, ['task', 'bug']);
    else if (i.type === 'usecase') code = of(i.children, ['story']);
    else if (i.type === 'cr') code = of(i.blockedBy, ['story', 'usecase']);
    const unique = [...new Set(code)].sort((a, b) => a - b);
    codeMemo.set(n, unique);
    return unique;
  };

  // Children of the allowed types that have a computed status in this run.
  const childStatuses = (ids: number[], allowed: IssueType[], warnings: string[] | null) => {
    const out: { number: number; type: IssueType; status: Status }[] = [];
    for (const c of ids) {
      const child = get(c);
      if (!child || child.type === null) continue;
      if (!allowed.includes(child.type)) {
        warnings?.push(
          `Child #${c} is a ${TYPE_NAMES[child.type]}; only ${allowed.map((t) => `${TYPE_NAMES[t]}s`).join(' and ')} count here — ignored`,
        );
        continue;
      }
      const status = results.get(c)?.status;
      if (status) out.push({ number: c, type: child.type, status });
    }
    return out;
  };

  const loads = new Map<string, number>();
  for (const i of facts.issues.values()) {
    const m = i.card?.marker;
    if (i.type === 'bug' && m?.verifyAssigned && m.status === 'inReview') {
      for (const a of i.assignees) loads.set(a, (loads.get(a) ?? 0) + 1);
    }
  }

  const ordered = [...facts.issues.values()]
    .filter((i) => i.itemId !== null)
    .sort((a, b) => (a.type ? LAYER[a.type] : 9) - (b.type ? LAYER[b.type] : 9) || a.number - b.number);

  for (const issue of ordered) {
    const m0 = issue.card?.marker ?? null;

    if (issue.type === null) {
      const problem = issue.typeProblem ?? 'no type label';
      const marker: Marker = m0 ?? {
        v: 1,
        status: issue.projectStatus ?? 'new',
        source: 'bot',
        epoch: null,
        at: now,
        verifyAssigned: false,
        history: [],
      };
      results.set(issue.number, {
        number: issue.number,
        status: null,
        state: null,
        assignees: null,
        marker,
        reason: problem,
        warnings: [problem],
      });
      continue;
    }
    const type = issue.type;

    let status: Status | null = m0?.status ?? null;
    let source: Marker['source'] = m0?.source ?? 'bot';
    let epoch = m0?.epoch ?? null;
    let verifyAssigned = m0?.verifyAssigned ?? false;
    let history: HistoryEntry[] = m0?.history ?? [];
    let assignees: string[] | null = null;
    const warnings: string[] = [];
    const record = (entry: HistoryEntry) => (history = appendHistory(history, entry, config.historySize));

    const storyKids = () => childStatuses(issue.children, ['task', 'bug'], null);
    const statuses = (xs: { status: Status }[]) => xs.map((x) => x.status);
    const activeOnly = (xs: Status[]) => xs.filter((s) => s !== 'canceled');

    // §5 — manual changes
    const change = m0 ? detectManual(issue) : null;
    if (change && status) {
      const from = status;
      const kids = type === 'story' ? storyKids() : [];
      const ctx: ManualContext = {
        type,
        from,
        bugVerification: type === 'bug' && bugStatus(workOf(issue, epoch)).verification,
        names,
        activeCodePulls: codeOf(issue.number),
        tasks: activeOnly(statuses(kids.filter((k) => k.type === 'task'))),
        bugs: activeOnly(statuses(kids.filter((k) => k.type === 'bug'))),
        stories: type === 'usecase' ? statuses(childStatuses(issue.children, ['story'], null)) : [],
        linked: type === 'cr' ? statuses(childStatuses(issue.blockedBy, ['story', 'usecase'], null)) : [],
      };
      const verdict = judgeManual(change, ctx);
      if (verdict.accept) {
        record({ at: change.at, from, to: change.to, reason: `changed manually${change.by ? ` by @${change.by}` : ''}` });
        if (type === 'bug' && from === 'inReview' && change.to === 'new') {
          const work = workOf(issue, epoch);
          const latest = facts.pulls
            .filter((p) => work.allActiveMerged.includes(p.number))
            .sort((a, b) => Date.parse(b.mergedAt ?? '') - Date.parse(a.mergedAt ?? ''))[0];
          if (latest?.authorIsMember) assignees = [latest.author];
          verifyAssigned = false;
        }
        status = change.to;
        source = 'manual';
        epoch = change.at;
      } else {
        record({ at: now, from: change.to, to: from, reason: `reverted manual change to ${names[change.to]}: ${verdict.reason}` });
      }
    }

    // §4 — computed status
    let decision: Decision;
    let verification = false;
    if (status === 'canceled') {
      decision = { status: 'canceled', reason: 'canceled' };
      if (type === 'story') {
        const open = storyKids().filter((k) => k.status !== 'canceled');
        if (open.length > 0) warnings.push(`Children not canceled: ${open.map((k) => `#${k.number}`).join(', ')}`);
      }
    } else if (type === 'task' || type === 'bug') {
      const work = workOf(issue, epoch);
      warnings.push(...work.warnings);
      if (type === 'task') decision = taskStatus(work);
      else ({ verification, ...decision } = bugStatus(work));
      if (source === 'manual' && decision.status === 'new' && status !== null) {
        decision = { status, reason: 'kept manual status — nothing changed since' };
      }
    } else if (type === 'story') {
      const kids = childStatuses(issue.children, ['task', 'bug'], warnings).filter((k) => k.status !== 'canceled');
      const current = status ? ({ status, source } as Marker) : null;
      decision = storyStatus(
        statuses(kids.filter((k) => k.type === 'task')),
        statuses(kids.filter((k) => k.type === 'bug')),
        current,
      );
    } else if (type === 'usecase') {
      decision = usecaseStatus(activeOnly(statuses(childStatuses(issue.children, ['story'], warnings))));
    } else {
      decision = crStatus(activeOnly(statuses(childStatuses(issue.blockedBy, ['story', 'usecase'], null))));
    }

    if (type === 'bug') {
      if (verification && !verifyAssigned) {
        const qa = pickQa(issue.author, config.qa, loads);
        assignees = [qa];
        loads.set(qa, (loads.get(qa) ?? 0) + 1);
        verifyAssigned = true;
      } else if (!verification) {
        verifyAssigned = false;
      }
    }

    if (decision.status !== status) {
      record({ at: now, from: status, to: decision.status, reason: decision.reason });
      source = 'bot';
    }

    const changed =
      !m0 ||
      m0.status !== decision.status ||
      m0.source !== source ||
      m0.epoch !== epoch ||
      m0.verifyAssigned !== verifyAssigned ||
      m0.history !== history;
    const marker: Marker = {
      v: 1,
      status: decision.status,
      source,
      epoch,
      at: changed ? now : m0!.at,
      verifyAssigned,
      history,
    };

    results.set(issue.number, {
      number: issue.number,
      status: decision.status,
      state: stateFor(decision.status),
      assignees,
      marker,
      reason: decision.reason,
      warnings: [...new Set(warnings)],
    });
  }

  return [...results.values()];
}
