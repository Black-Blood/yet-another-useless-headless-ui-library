import { assertEquals, assertMatch, assertRejects } from '@std/assert';
import { createClient } from '../src/client.ts';

type Reply = Response | Error;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const NOW = Date.parse('2026-11-08T12:00:00Z');

function fake(replies: Reply[]) {
  const calls: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const sleeps: number[] = [];
  const client = createClient({
    token: 'tkn',
    fetch: (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = replies.shift();
      if (!next) throw new Error('no more replies');
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => NOW,
  });
  return { client, calls, sleeps };
}

Deno.test('graphql: posts the query and variables with the token', async () => {
  const { client, calls } = fake([json({ data: { viewer: { login: 'me' } } })]);
  assertEquals(await client.graphql('query { viewer { login } }', { a: 1 }), { viewer: { login: 'me' } });
  assertEquals(calls[0].url, 'https://api.github.com/graphql');
  assertEquals(calls[0].method, 'POST');
  assertEquals(calls[0].headers.get('authorization'), 'Bearer tkn');
  assertEquals(calls[0].body, { query: 'query { viewer { login } }', variables: { a: 1 } });
});

Deno.test('graphql: errors become exceptions', async () => {
  const { client } = fake([json({ data: null, errors: [{ message: "Field 'x' doesn't exist" }] })]);
  await assertRejects(() => client.graphql('query { x }'), Error, "GraphQL: Field 'x' doesn't exist");
});

Deno.test('paginate: follows cursors and merges nodes', async () => {
  const page = (nodes: number[], hasNextPage: boolean, endCursor: string | null) =>
    json({ data: { repository: { issues: { nodes, pageInfo: { hasNextPage, endCursor } } } } });
  const { client, calls } = fake([page([1, 2], true, 'c1'), page([3], false, null)]);
  const result = await client.paginate<{ repository: { issues: { nodes: number[] } } }>('q', { owner: 'o' });
  assertEquals(result.repository.issues.nodes, [1, 2, 3]);
  assertEquals(calls[0].body, { query: 'q', variables: { owner: 'o', cursor: null } });
  assertEquals(calls[1].body, { query: 'q', variables: { owner: 'o', cursor: 'c1' } });
});

Deno.test('paginate: a result without a connection is returned as is', async () => {
  const { client } = fake([json({ data: { user: null } })]);
  assertEquals(await client.paginate('q'), { user: null });
});

Deno.test('request: fills path params and sends the rest as JSON', async () => {
  const { client, calls } = fake([json({ id: 1 })]);
  await client.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
    owner: 'o',
    repo: 'r',
    issue_number: 3,
    state: 'closed',
  });
  assertEquals(calls[0].url, 'https://api.github.com/repos/o/r/issues/3');
  assertEquals(calls[0].method, 'PATCH');
  assertEquals(calls[0].body, { state: 'closed' });
  assertEquals(calls[0].headers.get('x-github-api-version'), '2022-11-28');
});

Deno.test('request: no content gives null', async () => {
  const { client } = fake([new Response(null, { status: 204 })]);
  assertEquals(await client.request('PATCH /x/{id}', { id: 1 }), null);
});

Deno.test('retries: server errors are retried with backoff', async () => {
  const { client, sleeps } = fake([json({}, 502), json({}, 502), json({ data: { ok: true } })]);
  assertEquals(await client.graphql('q'), { ok: true });
  assertEquals(sleeps, [1000, 2000]);
});

Deno.test('retries: network errors are retried', async () => {
  const { client, sleeps } = fake([new TypeError('connection reset'), json({ data: { ok: true } })]);
  assertEquals(await client.graphql('q'), { ok: true });
  assertEquals(sleeps, [1000]);
});

Deno.test('retries: 429 honors retry-after', async () => {
  const { client, sleeps } = fake([json({ message: 'slow down' }, 429, { 'retry-after': '5' }), json({ id: 1 })]);
  await client.request('POST /x', {});
  assertEquals(sleeps, [5000]);
});

Deno.test('retries: a secondary rate limit (403 + retry-after) is waited out', async () => {
  const { client, sleeps } = fake([json({ message: 'secondary' }, 403, { 'retry-after': '7' }), json({ id: 1 })]);
  await client.request('POST /x', {});
  assertEquals(sleeps, [7000]);
});

Deno.test('retries: an exhausted rate limit waits until the reset', async () => {
  const reset = String(NOW / 1000 + 10);
  const { client, sleeps } = fake([
    json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
    json({ data: { ok: true } }),
  ]);
  assertEquals(await client.graphql('q'), { ok: true });
  assertEquals(sleeps, [10000]);
});

Deno.test('retries: a rate limit that resets too late fails without waiting', async () => {
  const reset = String(NOW / 1000 + 3600);
  const { client, sleeps } = fake([
    json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
  ]);
  await assertRejects(() => client.graphql('q'), Error, 'rate limit');
  assertEquals(sleeps, []);
});

Deno.test('retries: GraphQL RATE_LIMITED errors are retried', async () => {
  const { client, sleeps } = fake([
    json({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }),
    json({ data: { ok: true } }),
  ]);
  assertEquals(await client.graphql('q'), { ok: true });
  assertEquals(sleeps, [1000]);
});

Deno.test('retries: gives up after three retries', async () => {
  const { client, sleeps } = fake([json({}, 500), json({}, 500), json({}, 500), json({}, 500)]);
  const error = await assertRejects(() => client.graphql('q'), Error);
  assertMatch(error.message, /GitHub API 500/);
  assertEquals(sleeps.length, 3);
});

Deno.test('errors: 404 is not retried and names the call', async () => {
  const { client, calls } = fake([json({ message: 'Not Found' }, 404)]);
  await assertRejects(
    () => client.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', { owner: 'o', repo: 'r', issue_number: 3 }),
    Error,
    'GitHub API 404 PATCH /repos/o/r/issues/3: Not Found',
  );
  assertEquals(calls.length, 1);
});
