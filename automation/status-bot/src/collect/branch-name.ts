import type { Config } from '../types.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `feature/46-login-form` → { kind: 'task', number: 46 }; `fix/49-modal` → { kind: 'bug', number: 49 };
 * `46-login-form` (GitHub's "Create a branch" button) → { kind: null, number: 46 }, valid for a task or a bug;
 * anything else → null.
 */
export function parseBranch(
  name: string,
  prefix: Config['branchPrefix'],
): { kind: 'task' | 'bug' | null; number: number } | null {
  const re = new RegExp(`^(?:(${escape(prefix.task)}|${escape(prefix.bug)})/)?(\\d+)-.+$`);
  const m = re.exec(name);
  if (!m) return null;
  const kind = m[1] === undefined ? null : m[1] === prefix.task ? 'task' : 'bug';
  return { kind, number: Number(m[2]) };
}
