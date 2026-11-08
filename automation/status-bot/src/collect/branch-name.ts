import type { Config } from '../types.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `feature/46-login-form` → { kind: 'task', number: 46 }; anything else → null. */
export function parseBranch(
  name: string,
  prefix: Config['branchPrefix'],
): { kind: 'task' | 'bug'; number: number } | null {
  const re = new RegExp(`^(${escape(prefix.task)}|${escape(prefix.bug)})/(\\d+)-.+$`);
  const m = re.exec(name);
  if (!m) return null;
  return { kind: m[1] === prefix.task ? 'task' : 'bug', number: Number(m[2]) };
}
