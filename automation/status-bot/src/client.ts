/**
 * A minimal GitHub API client on `fetch`: GraphQL (with cursor pagination) and a few REST calls,
 * with retries for network errors, 5xx and rate limits (§6.4).
 */

export interface ClientOptions {
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** milliseconds since epoch */
  now?: () => number;
  baseUrl?: string;
  maxRetries?: number;
  /** longest wait for a rate limit reset; a later reset fails instead */
  maxWaitMs?: number;
}

export interface GitHubClient {
  graphql<T = unknown>(query: string, vars?: Record<string, unknown>): Promise<T>;
  /** For queries with exactly one paginated connection, driven by the `$cursor` variable. */
  paginate<T extends object>(query: string, vars?: Record<string, unknown>): Promise<T>;
  /** `route` is like `PATCH /repos/{owner}/{repo}/issues/{issue_number}`; leftover params become the JSON body. */
  request(route: string, params: Record<string, unknown>): Promise<unknown>;
}

class Retryable extends Error {
  constructor(message: string, readonly waitMs: number | null) {
    super(message);
  }
}

type Connection = { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

function findConnection(value: unknown): Connection | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (Array.isArray(o.nodes) && typeof o.pageInfo === 'object' && o.pageInfo !== null) return o as Connection;
  for (const child of Object.values(o)) {
    if (Array.isArray(child)) continue;
    const found = findConnection(child);
    if (found) return found;
  }
  return null;
}

export function createClient(options: ClientOptions): GitHubClient {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const baseUrl = options.baseUrl ?? 'https://api.github.com';
  const maxRetries = options.maxRetries ?? 3;
  const maxWaitMs = options.maxWaitMs ?? 60_000;

  async function once(method: string, path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'status-bot',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Retryable(`GitHub API ${method} ${path}: ${error instanceof Error ? error.message : error}`, null);
    }

    const text = await res.text();
    const payload = text ? JSON.parse(text) : null;
    if (res.ok) return payload;

    const message = `GitHub API ${res.status} ${method} ${path}: ${payload?.message ?? res.statusText}`;
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter !== null && (res.status === 403 || res.status === 429)) {
      throw new Retryable(message, Number(retryAfter) * 1000);
    }
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const waitMs = Number(res.headers.get('x-ratelimit-reset')) * 1000 - now();
      if (waitMs > maxWaitMs) throw new Error(`${message} (rate limit resets in ${Math.ceil(waitMs / 1000)}s)`);
      throw new Retryable(message, Math.max(waitMs, 0));
    }
    if (res.status === 429 || res.status >= 500) throw new Retryable(message, null);
    throw new Error(message);
  }

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(method, path, body);
      } catch (error) {
        if (!(error instanceof Retryable) || attempt >= maxRetries) {
          throw error instanceof Retryable ? new Error(error.message) : error;
        }
        await sleep(error.waitMs ?? 1000 * 2 ** attempt);
      }
    }
  }

  async function graphql<T>(query: string, vars: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = (await call('POST', '/graphql', { query, variables: vars })) as {
        data?: T;
        errors?: { type?: string; message: string }[];
      };
      if (!res.errors?.length) return res.data as T;
      const message = `GraphQL: ${res.errors.map((e) => e.message).join('; ')}`;
      if (!res.errors.some((e) => e.type === 'RATE_LIMITED') || attempt >= maxRetries) throw new Error(message);
      await sleep(1000 * 2 ** attempt);
    }
  }

  async function paginate<T extends object>(query: string, vars: Record<string, unknown> = {}): Promise<T> {
    const first = await graphql<T>(query, { ...vars, cursor: null });
    const connection = findConnection(first);
    if (!connection) return first;
    let page = connection;
    while (page.pageInfo.hasNextPage) {
      const next = findConnection(await graphql<T>(query, { ...vars, cursor: page.pageInfo.endCursor }));
      if (!next) break;
      connection.nodes.push(...next.nodes);
      page = next;
    }
    connection.pageInfo = page.pageInfo;
    return first;
  }

  function request(route: string, params: Record<string, unknown>): Promise<unknown> {
    const [method, template] = route.split(' ');
    const rest = { ...params };
    const path = template.replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = rest[key];
      delete rest[key];
      return encodeURIComponent(String(value));
    });
    return call(method, path, method === 'GET' ? undefined : rest);
  }

  return { graphql, paginate, request };
}
