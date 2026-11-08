/** §4.3 QA assignment: the author if they are QA, else the least loaded QA (ties → list order). */
export function pickQa(author: string, qa: string[], loads: Map<string, number>): string {
  if (qa.includes(author)) return author;
  let best = qa[0];
  for (const q of qa) if ((loads.get(q) ?? 0) < (loads.get(best) ?? 0)) best = q;
  return best;
}
