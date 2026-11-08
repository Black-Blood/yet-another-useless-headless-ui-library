import { parse } from '@std/yaml';
import { ISSUE_TYPES, STATUSES } from './types.ts';
import type { Config } from './types.ts';

type Obj = Record<string, unknown>;

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`config: ${path} must be a mapping`);
  }
  return value as Obj;
}

function str(o: Obj, key: string, path: string): string {
  const value = o[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`config: ${path}${key} must be a non-empty string`);
  }
  return value;
}

function posInt(o: Obj, key: string, path = ''): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`config: ${path}${key} must be a positive integer`);
  }
  return value;
}

function strMap<K extends string>(o: Obj, key: string, keys: readonly K[]): Record<K, string> {
  const m = obj(o[key], key);
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = str(m, k, `${key}.`);
  return out;
}

export function parseConfig(text: string): Config {
  const root = obj(parse(text), 'root');
  const project = obj(root.project, 'project');
  const prefix = obj(root.branchPrefix, 'branchPrefix');
  const qa = root.qa;
  if (!Array.isArray(qa) || qa.length === 0 || qa.some((q) => typeof q !== 'string' || q.trim() === '')) {
    throw new Error('config: qa must be a non-empty list of logins');
  }
  return {
    project: {
      owner: str(project, 'owner', 'project.'),
      number: posInt(project, 'number', 'project.'),
      statusField: str(project, 'statusField', 'project.'),
    },
    statuses: strMap(root, 'statuses', STATUSES),
    integrationBranch: str(root, 'integrationBranch', ''),
    branchPrefix: { task: str(prefix, 'task', 'branchPrefix.'), bug: str(prefix, 'bug', 'branchPrefix.') },
    typeLabels: strMap(root, 'typeLabels', ISSUE_TYPES),
    qa: qa as string[],
    maxChangesPerRun: posInt(root, 'maxChangesPerRun'),
    historySize: posInt(root, 'historySize'),
  };
}

export function loadConfig(path: string | URL): Config {
  return parseConfig(Deno.readTextFileSync(path));
}
