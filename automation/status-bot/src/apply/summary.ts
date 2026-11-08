import type { Action } from '../types.ts';
import type { RunResult } from './execute.ts';

export function describe(a: Action): string {
  switch (a.kind) {
    case 'addToProject':
      return 'add to project';
    case 'writeCard':
      return a.commentId === null ? 'create status card' : 'update status card';
    case 'setStatus':
      return `set status → ${a.status}`;
    case 'setState':
      return a.state.open ? 'reopen issue' : `close issue (${a.state.reason ?? 'completed'})`;
    case 'setAssignees':
      return `set assignees → ${a.assignees.join(', ')}`;
  }
}

/** §6.4 run report, written to $GITHUB_STEP_SUMMARY. */
export function renderSummary(r: {
  result: RunResult;
  blocked: boolean;
  dryRun: boolean;
  planned: Action[];
  skipped: { issue: number; reason: string }[];
}): string {
  const lines = ['## Status bot', ''];
  const issues = new Set(r.planned.map((a) => a.issue)).size;
  if (r.blocked) {
    lines.push(`⛔ Change limit exceeded: ${issues} issues would change. Nothing was written. Re-run manually with \`force\` if this is expected.`);
  } else if (r.dryRun) {
    lines.push('🧪 Dry run. Nothing was written.');
  }
  const shown = r.blocked || r.dryRun ? r.planned : r.result.done;
  lines.push('', `### ${r.blocked || r.dryRun ? 'Planned' : 'Applied'} changes (${shown.length})`, '');
  if (shown.length === 0) lines.push('None.');
  else lines.push('| Issue | Action |', '|---|---|', ...shown.map((a) => `| #${a.issue} | ${describe(a)} |`));
  if (r.skipped.length > 0) {
    lines.push('', `### Skipped (${r.skipped.length})`, '', ...r.skipped.map((s) => `- #${s.issue}: ${s.reason}`));
  }
  if (r.result.errors.length > 0) {
    lines.push(
      '',
      `### Errors (${r.result.errors.length})`,
      '',
      ...r.result.errors.map((e) => `- #${e.action.issue} ${describe(e.action)}: ${e.message}`),
    );
  }
  return lines.join('\n') + '\n';
}
