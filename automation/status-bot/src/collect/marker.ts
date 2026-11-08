import { STATUSES } from '../types.ts';
import type { Card, HistoryEntry, Marker, Status } from '../types.ts';

const MARKER_RE = /^<!-- status-bot: (.*) -->$/gm;

export function isBotLogin(login: string): boolean {
  return login === 'github-actions' || login === 'github-actions[bot]';
}

const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function isEntry(v: unknown): v is HistoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return isTime(e.at) && (e.from === null || isStatus(e.from)) && isStatus(e.to) && typeof e.reason === 'string';
}

export function parseMarker(body: string): Marker | null {
  const matches = [...body.matchAll(MARKER_RE)];
  const last = matches.at(-1);
  if (!last) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(last[1]);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const valid =
    m.v === 1 &&
    isStatus(m.status) &&
    (m.source === 'bot' || m.source === 'manual') &&
    (m.epoch === null || isTime(m.epoch)) &&
    (m.held === undefined || m.held === null || isStatus(m.held)) &&
    isTime(m.at) &&
    typeof m.verifyAssigned === 'boolean' &&
    Array.isArray(m.history) &&
    m.history.every(isEntry);
  if (!valid) return null;
  return {
    v: 1,
    status: m.status as Status,
    source: m.source as Marker['source'],
    epoch: m.epoch as string | null,
    // cards written before `held` existed read it as null
    held: (m.held ?? null) as Status | null,
    at: m.at as string,
    verifyAssigned: m.verifyAssigned as boolean,
    history: m.history as HistoryEntry[],
  };
}

export function findCard(comments: { id: number; author: string; createdAt: string; body: string }[]): Card | null {
  const cards = comments
    .filter((c) => isBotLogin(c.author))
    .map((c) => ({ c, marker: parseMarker(c.body) }))
    .filter((x): x is { c: (typeof comments)[number]; marker: Marker } => x.marker !== null)
    .sort((a, b) => Date.parse(b.c.createdAt) - Date.parse(a.c.createdAt));
  const newest = cards[0];
  return newest ? { commentId: newest.c.id, body: newest.c.body, marker: newest.marker } : null;
}

export function appendHistory(history: HistoryEntry[], entry: HistoryEntry, size: number): HistoryEntry[] {
  return [entry, ...history].slice(0, size);
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const when = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export function renderCard(marker: Marker, reason: string, warnings: string[], names: Record<Status, string>): string {
  const lines = [`🤖 Status: ${names[marker.status]}`, `Reason: ${reason}`];
  if (warnings.length > 0) lines.push('', ...warnings.map((w) => `⚠️ ${w}`));
  lines.push('', 'History', '', '| When | From | To | Reason |', '|---|---|---|---|');
  for (const e of marker.history) {
    lines.push(`| ${when(e.at)} | ${e.from ? names[e.from] : '—'} | ${names[e.to]} | ${cell(e.reason)} |`);
  }
  const json = JSON.stringify(marker).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  lines.push(`<!-- status-bot: ${json} -->`);
  return lines.join('\n');
}
