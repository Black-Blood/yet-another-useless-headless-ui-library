# Status Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Actions bot that keeps the Status field of Project #4 in sync with branches, pull requests and child issues, accepts only the allowed manual changes, and explains every change in a status card comment.

**Architecture:** Every run is a full reconciliation: collect facts from the GitHub API → compute the desired state of every issue with pure rule functions (bottom-up: Task/Bug → User Story → Use Case → Change Request) → diff against the current state → write only the difference. Bot memory lives in a hidden JSON marker inside one bot-authored comment per issue.

**Tech Stack:** Node 24 (native TypeScript type stripping, no build step), `octokit` (REST + GraphQL, retry, throttling, GraphQL pagination), `yaml`, built-in `node --test`, `tsc --noEmit` for type checking, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-08-status-bot-design.md` — read it before any task; section numbers (§) below refer to it.

## Global Constraints

- Implementation branch: `feat/status-bot`, created from `docs/status-bot-spec`, so the spec, the plan and the code ship in one PR into `develop` (Task 13).
- All code lives in `automation/status-bot/`; workflows in `.github/workflows/`. Run every command below from `automation/status-bot/` unless stated otherwise.
- Node `>=24`, ESM (`"type": "module"`). TypeScript must be erasable syntax only: no `enum`, `namespace`, parameter properties; relative imports end in `.ts`.
- Dependencies, exactly: `octokit@^5.0.5`, `yaml@^2.9.1`; dev: `typescript@~5.9.3`, `@types/node@^24`. No others.
- Every text the bot writes to GitHub (card, warnings, reasons, summary) is English.
- Status names in the Project: `New`, `In Progress`, `In Review`, `Done`, `Canceled`. Internally statuses are the keys `new | inProgress | inReview | done | canceled`, mapped through `config.statuses`.
- Type labels: `Bug`, `Task`, `User Story`, `Use Case`, `Change Request`. `I need help` is ignored.
- Integration branch `develop`; branch prefixes `feature` (task) and `fix` (bug); `maxChangesPerRun: 30`; `historySize: 20`; schedule `*/10 * * * *`.
- The bot's comment author is `github-actions` in GraphQL and `github-actions[bot]` in REST — both mean "bot".
- Timestamps are ISO 8601 UTC strings; compare with `Date.parse`.
- `pull_request_target` runs must never check out or execute PR code.
- Implementation decision beyond the spec: the marker JSON also stores `history: HistoryEntry[]` (the rendered History table is generated from it, never parsed back).

## Review Focus

1. **Issue closed as "duplicate"** (GitHub's third close reason; the spec names only `completed` / `not_planned`) → treat exactly like `not_planned`, i.e. a manual change to Canceled (guard applies). Tests: Task 8 `detectManual: closed as duplicate means canceled`, Task 11 `toFacts: DUPLICATE maps to not_planned`.
2. **Empty Status in the Project** (item just added, or someone cleared the field) → not a manual change; the bot writes the computed status. Tests: Task 8 `detectManual: empty project status is not a manual change`, Task 10 `planIssue: sets status when project status is null`.
3. **Type label changes on an issue that already has a card** (e.g. Task → Bug) → recompute with the new type, keep the marker's epoch. Test: Task 9 `reconcile: type change keeps epoch and recomputes`.
4. **A PR whose branch name points at issue A and whose Development link points at issue B** → it belongs to A only; the Development link is a fallback used only when the head branch name does not parse. Test: Task 5 `collectWork: branch name wins over Development link`.
5. **Wrong child types** (a Use Case under a User Story, a Task directly under a Use Case) → the child is processed on its own; the parent ignores it and shows a warning. Test: Task 9 `reconcile: ignores wrong child types with a warning`.

---

### Task 1: Package scaffold, shared types, config, CI

**Files:**
- Create: `automation/status-bot/package.json`, `automation/status-bot/tsconfig.json`, `automation/status-bot/config.yml`, `automation/status-bot/src/types.ts`, `automation/status-bot/src/config.ts`, `automation/status-bot/test/helpers.ts`, `automation/status-bot/test/config.test.ts`, `.github/workflows/status-bot-ci.yml`, `.gitignore`
- Generated: `automation/status-bot/package-lock.json`

**Interfaces:**
- Produces: every type in `src/types.ts`; `parseConfig(text: string): Config`; `loadConfig(path: string): Config`; test builders in `test/helpers.ts`.

- [ ] **Step 1: Create the package files**

`package.json`: `"name": "status-bot"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=24" }`, scripts `"test": "node --test \"test/**/*.test.ts\""`, `"typecheck": "tsc --noEmit"`, `"start": "node src/main.ts"`, plus the dependencies from Global Constraints. `tsconfig.json`: `target es2024`, `module`/`moduleResolution` `nodenext`, `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `types: ["node"]`, `skipLibCheck`, `include: ["src", "test"]`. `config.yml`: copy §7.2 verbatim. `.gitignore`: `automation/status-bot/node_modules/`. Run `npm install` to create the lockfile.

- [ ] **Step 2: Write `src/types.ts` (the shared contract)**

```ts
export type Status = 'new' | 'inProgress' | 'inReview' | 'done' | 'canceled';
export type IssueType = 'bug' | 'task' | 'story' | 'usecase' | 'cr';
export interface IssueState { open: boolean; reason: 'completed' | 'not_planned' | null }

export interface Config {
  project: { owner: string; number: number; statusField: string };
  statuses: Record<Status, string>;
  integrationBranch: string;
  branchPrefix: { task: string; bug: string };
  typeLabels: Record<IssueType, string>;
  qa: string[];
  maxChangesPerRun: number;
  historySize: number;
}

export interface HistoryEntry { at: string; from: Status | null; to: Status; reason: string }
export interface Marker {
  v: 1; status: Status; source: 'bot' | 'manual'; epoch: string | null;
  at: string; verifyAssigned: boolean; history: HistoryEntry[];
}
export interface Card { commentId: number; body: string; marker: Marker }

export interface PullFact {
  number: number; state: 'open' | 'closed' | 'merged'; draft: boolean;
  baseRef: string; headRef: string; author: string; authorIsMember: boolean;
  body: string; createdAt: string; mergedAt: string | null; closingIssues: number[];
}
export interface BranchFact { name: string; lastCommitAt: string }

export interface IssueFacts {
  number: number; nodeId: string; itemId: string | null;
  type: IssueType | null; typeProblem: string | null;
  state: IssueState; stateChangedAt: string | null;
  author: string; authorIsMember: boolean; assignees: string[]; createdAt: string;
  parent: number | null; children: number[]; blockedBy: number[];
  projectStatus: Status | null; projectStatusUpdatedAt: string | null; projectStatusUpdatedBy: string | null;
  card: Card | null;
}
export interface Facts { now: string; repo: string; issues: Map<number, IssueFacts>; pulls: PullFact[]; branches: BranchFact[] }

export interface Decision { status: Status; reason: string }
export interface Desired {
  number: number;
  status: Status | null;        // null: leave the Project status untouched
  state: IssueState | null;     // null: leave open/closed untouched
  assignees: string[] | null;   // null: leave assignees untouched
  marker: Marker; reason: string; warnings: string[];
}

export interface ProjectMeta { projectId: string; statusFieldId: string; optionIds: Record<Status, string> }
export type Action =
  | { kind: 'addToProject'; issue: number; nodeId: string }
  | { kind: 'writeCard'; issue: number; commentId: number | null; body: string }
  | { kind: 'setStatus'; issue: number; itemId: string; status: Status }
  | { kind: 'setState'; issue: number; state: IssueState }
  | { kind: 'setAssignees'; issue: number; assignees: string[] };
```

- [ ] **Step 3: Write `test/helpers.ts`**

Builders with defaults, each taking `Partial<…>` overrides: `pull(p: Partial<PullFact> & { number: number }): PullFact` (defaults: `state 'open'`, `draft false`, `baseRef 'develop'`, `headRef 'feature/1-x'`, `author 'dev'`, `authorIsMember true`, `body ''`, `createdAt '2026-11-01T00:00:00Z'`, `mergedAt null`, `closingIssues []`); `branch(name: string, lastCommitAt = '2026-11-01T00:00:00Z'): BranchFact`; `marker(p?: Partial<Marker>): Marker` (defaults `v 1`, `status 'new'`, `source 'bot'`, `epoch null`, `at '2026-11-01T00:00:00Z'`, `verifyAssigned false`, `history []`); `issue(p: Partial<IssueFacts> & { number: number }): IssueFacts` (defaults: `nodeId 'I_<number>'`, `itemId 'PVTI_<number>'`, `type 'task'`, open state, `author 'dev'`, `authorIsMember true`, empty arrays, nulls, `card null`); `facts(issues: IssueFacts[], pulls?: PullFact[], branches?: BranchFact[], now = '2026-11-08T12:00:00Z'): Facts` with `repo 'Black-Blood/yet-another-useless-headless-ui-library'`; `testConfig: Config` = `loadConfig` of the real `config.yml`.

- [ ] **Step 4: Write the failing tests in `test/config.test.ts`**

```ts
test('parseConfig: reads the repository config', () => {
  const c = loadConfig(new URL('../config.yml', import.meta.url).pathname);
  assert.equal(c.project.number, 4);
  assert.equal(c.statuses.inProgress, 'In Progress');
  assert.deepEqual(c.branchPrefix, { task: 'feature', bug: 'fix' });
  assert.equal(c.typeLabels.story, 'User Story');
  assert.deepEqual(c.qa, ['Black-Blood']);
  assert.equal(c.maxChangesPerRun, 30);
  assert.equal(c.historySize, 20);
});
test('parseConfig: missing integrationBranch throws', () =>
  assert.throws(() => parseConfig(withoutKey('integrationBranch')), /integrationBranch/));
test('parseConfig: empty qa throws', () =>
  assert.throws(() => parseConfig(withQa([])), /qa/));
test('parseConfig: missing a status name throws', () =>
  assert.throws(() => parseConfig(withoutStatus('canceled')), /statuses\.canceled/));
```

(`withoutKey`, `withQa`, `withoutStatus` are local helpers that edit the YAML text of `config.yml`.)

- [ ] **Step 5: Run to verify failure** — `npm test` → FAIL (`config.ts` missing).

- [ ] **Step 6: Implement `parseConfig` / `loadConfig` in `src/config.ts`** — parse with `yaml`, validate every key of `Config` (non-empty strings, positive integers, non-empty `qa`), throw `Error` whose message contains the dotted key path.

- [ ] **Step 7: Verify** — `npm test` → PASS; `npm run typecheck` → no errors.

- [ ] **Step 8: Add `.github/workflows/status-bot-ci.yml`** — trigger `pull_request` on paths `automation/**` and `.github/workflows/status-bot*.yml`; one job on `ubuntu-latest`: `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: 24` and npm cache keyed on `automation/status-bot/package-lock.json`, then in `automation/status-bot`: `npm ci`, `npm run typecheck`, `npm test`.

- [ ] **Step 9: Commit** — `git add -A automation/status-bot .github/workflows/status-bot-ci.yml .gitignore && git commit -m "feat(status-bot): scaffold package, types and config"`

---

### Task 2: Branch name parsing

**Files:**
- Create: `automation/status-bot/src/collect/branch-name.ts`, `automation/status-bot/test/branch-name.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1).
- Produces: `parseBranch(name: string, prefix: Config['branchPrefix']): { kind: 'task' | 'bug'; number: number } | null`

- [ ] **Step 1: Write the failing tests**

```ts
const p = testConfig.branchPrefix;
test('parseBranch: feature branch', () => assert.deepEqual(parseBranch('feature/46-login-form', p), { kind: 'task', number: 46 }));
test('parseBranch: fix branch', () => assert.deepEqual(parseBranch('fix/49-modal', p), { kind: 'bug', number: 49 }));
test('parseBranch: slug is required', () => assert.equal(parseBranch('feature/46', p), null));
test('parseBranch: hash is not allowed', () => assert.equal(parseBranch('feature/#46-x', p), null));
test('parseBranch: non-numeric id', () => assert.equal(parseBranch('feature/abc-x', p), null));
test('parseBranch: other branches', () => {
  for (const b of ['main', 'develop', 'patch-1', 'docs/status-bot-spec']) assert.equal(parseBranch(b, p), null);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement `parseBranch`** — regex `^(<task>|<bug>)/(\d+)-.+$` built from the configured prefixes (escape them).
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(status-bot): parse task and bug branch names"` (add new files first).

---

### Task 3: Revert resolution

**Files:**
- Create: `automation/status-bot/src/collect/revert.ts`, `automation/status-bot/test/revert.test.ts`

**Interfaces:**
- Consumes: `PullFact` (Task 1).
- Produces: `revertTargets(body: string, repo: string): number[]`; `activeMerged(pulls: PullFact[], integrationBranch: string, repo: string): Set<number>` — numbers of PRs merged into the integration branch and not reverted (§3.4).

- [ ] **Step 1: Write the failing tests**

```ts
const repo = 'Black-Blood/yet-another-useless-headless-ui-library';
const merged = (n: number, body = '', baseRef = 'develop') => pull({ number: n, state: 'merged', mergedAt: '2026-11-02T00:00:00Z', body, baseRef });
test('revertTargets: short and full forms, same repo only', () =>
  assert.deepEqual(revertTargets(`Reverts #5\nReverts ${repo}#7\nReverts other/repo#9`, repo), [5, 7]));
test('activeMerged: plain merged PR is active', () => assert.deepEqual([...activeMerged([merged(5)], 'develop', repo)], [5]));
test('activeMerged: merged revert deactivates the target', () =>
  assert.deepEqual([...activeMerged([merged(5), merged(6, 'Reverts #5')], 'develop', repo)], [6]));
test('activeMerged: revert of a revert reactivates', () =>
  assert.deepEqual([...activeMerged([merged(5), merged(6, 'Reverts #5'), merged(7, 'Reverts #6')], 'develop', repo)].sort(), [5, 7]));
test('activeMerged: open revert PR does not count', () =>
  assert.ok(activeMerged([merged(5), pull({ number: 6, body: 'Reverts #5' })], 'develop', repo).has(5)));
test('activeMerged: revert merged into main does not count', () =>
  assert.ok(activeMerged([merged(5), merged(6, 'Reverts #5', 'main')], 'develop', repo).has(5)));
test('activeMerged: PR merged into main is not active', () =>
  assert.equal(activeMerged([merged(5, '', 'main')], 'develop', repo).size, 0));
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement** — `revertTargets` matches `^Reverts (?:<repo>)?#(\d+)` per line (multiline). `activeMerged`: `isReverted(p)` = some merged-into-integration PR `r` lists `p` in `revertTargets(r.body)` and `!isReverted(r)`; memoize, treat a revisit during recursion as not reverted.
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): resolve reverted pull requests"`

---

### Task 4: Status card and marker

**Files:**
- Create: `automation/status-bot/src/collect/marker.ts`, `automation/status-bot/test/marker.test.ts`

**Interfaces:**
- Consumes: `Marker`, `HistoryEntry`, `Card`, `Status`, `Config` (Task 1).
- Produces:
  - `isBotLogin(login: string): boolean`
  - `parseMarker(body: string): Marker | null`
  - `findCard(comments: { id: number; author: string; createdAt: string; body: string }[]): Card | null`
  - `appendHistory(history: HistoryEntry[], entry: HistoryEntry, size: number): HistoryEntry[]` — newest first, at most `size`.
  - `renderCard(marker: Marker, reason: string, warnings: string[], names: Record<Status, string>): string`

- [ ] **Step 1: Write the failing tests**

```ts
const m = marker({ status: 'inReview', history: [{ at: '2026-11-07T10:12:03Z', from: 'inProgress', to: 'inReview', reason: 'PR #52 opened (not draft)' }] });
const body = renderCard(m, 'PR #52 opened (not draft)', ['Branch feature/49-modal does not match the type of issue #49 (bug) — ignored'], testConfig.statuses);
test('renderCard: shows status, reason, warning and history row', () => {
  assert.match(body, /^🤖 Status: In Review$/m);
  assert.match(body, /^Reason: PR #52 opened \(not draft\)$/m);
  assert.match(body, /^⚠️ Branch feature\/49-modal/m);
  assert.match(body, /\| 11-07 10:12 \| In Progress \| In Review \| PR #52 opened \(not draft\) \|/);
});
test('parseMarker: round-trips renderCard', () => assert.deepEqual(parseMarker(body), m));
test('parseMarker: malformed JSON gives null', () => assert.equal(parseMarker('<!-- status-bot: {oops -->'), null));
test('findCard: ignores a forged card from a human', () =>
  assert.equal(findCard([{ id: 1, author: 'mallory', createdAt: '2026-11-07T00:00:00Z', body }]), null));
test('findCard: picks the newest bot card', () => {
  const older = renderCard(marker({ status: 'new' }), 'x', [], testConfig.statuses);
  const card = findCard([
    { id: 1, author: 'github-actions', createdAt: '2026-11-01T00:00:00Z', body: older },
    { id: 2, author: 'github-actions[bot]', createdAt: '2026-11-07T00:00:00Z', body },
  ]);
  assert.equal(card?.commentId, 2);
  assert.equal(card?.marker.status, 'inReview');
});
test('appendHistory: newest first, capped at size', () => {
  let h: HistoryEntry[] = [];
  for (let i = 0; i < 25; i++) h = appendHistory(h, { at: `2026-11-0${(i % 9) + 1}T00:00:00Z`, from: null, to: 'new', reason: `r${i}` }, 20);
  assert.equal(h.length, 20);
  assert.equal(h[0].reason, 'r24');
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement** — card layout exactly as §3.5 (English): status line, `Reason:` line, one `⚠️` line per warning, blank line, `History` heading and table (`When | From | To | Reason`; `When` formatted `MM-DD HH:mm` UTC; `From` is `—` when null), last line `<!-- status-bot: <JSON of marker> -->`. `parseMarker` reads the last such line and validates `v === 1` and field types.
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): render and parse the status card"`

---

### Task 5: Work evidence and Task rules

**Files:**
- Create: `automation/status-bot/src/rules/work.ts`, `automation/status-bot/src/rules/task.ts`, `automation/status-bot/test/work.test.ts`, `automation/status-bot/test/task.test.ts`

**Interfaces:**
- Consumes: `parseBranch` (Task 2), `activeMerged` (Task 3), types (Task 1).
- Produces:
  ```ts
  export interface Work {
    openReady: number[];          // open, not draft, linked, base = integration branch
    openDraft: number[];
    activeMerged: PullFact[];     // active merged, after the epoch filter
    allActiveMerged: number[];    // active merged, ignoring epoch (Canceled guard)
    branches: string[];           // matching branches, after the epoch filter
    warnings: string[];
  }
  export function collectWork(issue: number, kind: 'task' | 'bug', facts: Facts, active: Set<number>, config: Config, epoch: string | null): Work
  export function taskStatus(work: Work): Decision
  ```

- [ ] **Step 1: Write the failing tests** (`work.test.ts`)

```ts
const run = (pulls: PullFact[], branches: BranchFact[] = [], epoch: string | null = null) => {
  const f = facts([issue({ number: 46 })], pulls, branches);
  return collectWork(46, 'task', f, activeMerged(pulls, 'develop', f.repo), testConfig, epoch);
};
test('collectWork: links PRs and branches by name', () => {
  const w = run([pull({ number: 52, headRef: 'feature/46-x' })], [branch('feature/46-x')]);
  assert.deepEqual(w.openReady, [52]);
  assert.deepEqual(w.branches, ['feature/46-x']);
});
test('collectWork: Development link is a fallback for unparseable branches', () =>
  assert.deepEqual(run([pull({ number: 53, headRef: 'patch-1', closingIssues: [46] })]).openReady, [53]));
test('collectWork: branch name wins over Development link', () =>
  assert.deepEqual(run([pull({ number: 54, headRef: 'feature/47-x', closingIssues: [46] })]).openReady, []));
test('collectWork: PR into another base is ignored with a warning', () => {
  const w = run([pull({ number: 55, headRef: 'feature/46-x', baseRef: 'main' })]);
  assert.deepEqual(w.openReady, []);
  assert.match(w.warnings[0], /PR #55 targets main, not develop — ignored/);
});
test('collectWork: wrong prefix for the type is ignored with a warning', () => {
  const w = run([], [branch('fix/46-x')]);
  assert.deepEqual(w.branches, []);
  assert.match(w.warnings[0], /Branch fix\/46-x does not match the type of issue #46 \(task\) — ignored/);
});
test('collectWork: epoch filters merged PRs and stale branches, not open PRs', () => {
  const w = run(
    [pull({ number: 56, headRef: 'feature/46-a', state: 'merged', mergedAt: '2026-11-02T00:00:00Z' }),
     pull({ number: 57, headRef: 'feature/46-b', createdAt: '2026-11-02T00:00:00Z' })],
    [branch('feature/46-c', '2026-11-02T00:00:00Z')], '2026-11-05T00:00:00Z');
  assert.deepEqual(w.activeMerged, []);
  assert.deepEqual(w.allActiveMerged, [56]);
  assert.deepEqual(w.branches, []);
  assert.deepEqual(w.openReady, [57]);
});
```

`task.test.ts` — one test per row of §4.2 plus precedence, each asserting `taskStatus(work).status`:
`open ready PR → inReview` (reason `PR #52 opened (not draft)`), `draft PR → inProgress` (`draft PR #52 open`), `merged → done` (`PR #52 merged into develop`), `branch only → inProgress` (`branch feature/46-x exists`), `nothing → new` (`no branches or pull requests`), `open ready + merged → inReview`, `draft + merged → inProgress`, `merged + leftover branch → done`.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement `collectWork` and `taskStatus`** — a PR links to issue N when `parseBranch(headRef)` gives N, else (only when it does not parse) when `closingIssues` includes N. Branch/PR prefix kind ≠ `kind` → warning, excluded. Reasons use the lowest PR number / first branch name in each list.
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): task status from branches and pull requests"`

---

### Task 6: Bug rules and QA selection

**Files:**
- Create: `automation/status-bot/src/rules/bug.ts`, `automation/status-bot/src/rules/qa.ts`, `automation/status-bot/test/bug.test.ts`, `automation/status-bot/test/qa.test.ts`

**Interfaces:**
- Consumes: `Work` (Task 5).
- Produces: `bugStatus(work: Work): Decision & { verification: boolean }`; `pickQa(author: string, qa: string[], loads: Map<string, number>): string`

- [ ] **Step 1: Write the failing tests**

`bug.test.ts`: same five rows as Task 5 with the bug differences — `merged → inReview, verification true, reason 'PR #52 merged into develop — awaiting verification'`; `open ready PR → inReview, verification false`; `draft + merged → inProgress, verification false`.

```ts
test('pickQa: author who is QA verifies their own bug', () => assert.equal(pickQa('ann', ['bob', 'ann'], new Map()), 'ann'));
test('pickQa: least loaded QA otherwise', () => assert.equal(pickQa('stranger', ['bob', 'ann'], new Map([['bob', 2], ['ann', 1]])), 'ann'));
test('pickQa: tie goes to list order', () => assert.equal(pickQa('stranger', ['bob', 'ann'], new Map()), 'bob'));
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement `bugStatus` (reuse the row logic of `taskStatus`; only row 3 differs) and `pickQa`.**
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): bug status and QA selection"`

---

### Task 7: User Story, Use Case and Change Request rules

**Files:**
- Create: `automation/status-bot/src/rules/story.ts`, `automation/status-bot/src/rules/usecase.ts`, `automation/status-bot/src/rules/cr.ts`, `automation/status-bot/test/parents.test.ts`

**Interfaces:**
- Consumes: `Decision`, `Marker`, `Status` (Task 1).
- Produces (inputs already exclude Canceled children):
  `storyStatus(tasks: Status[], bugs: Status[], marker: Marker | null): Decision`;
  `usecaseStatus(stories: Status[]): Decision`;
  `crStatus(linked: Status[]): Decision`

- [ ] **Step 1: Write the failing tests** — one test per row of §4.4–4.6, asserting `.status`:
  - story: `[] → new`; `['done','inProgress'] → inProgress`; `['new','new'] → new`; `['done','done'], bugs ['done'], marker done/manual → done`; `['done'], bugs ['new'], marker done/manual → inReview`; `['done'], bugs [], marker null → inReview`; `['done','new'] → inProgress`.
  - usecase: `[] → new`; `['done','done'] → done`; `['done','new'] → inProgress`; `['new'] → new`.
  - cr: `[] → new`; `['done'] → done`; `['new'] → inProgress`; `['done','inReview'] → inProgress`.
- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement the three functions** — reasons: `no tasks`, `tasks in progress`, `all tasks are New`, `accepted manually; all tasks and bugs done`, `all tasks done — awaiting review`, `no user stories`, `all user stories done`, `user stories in progress`, `no linked issues`, `all linked issues done`, `linked issues in progress`.
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): story, use case and change request status"`

---

### Task 8: Manual change detection and judgement

**Files:**
- Create: `automation/status-bot/src/rules/manual.ts`, `automation/status-bot/test/manual.test.ts`

**Interfaces:**
- Consumes: `IssueFacts`, `Marker`, `Status`, `IssueType` (Task 1).
- Produces:
  ```ts
  export interface ManualChange { to: Status; at: string; by: string | null }
  export interface ManualContext {
    type: IssueType; from: Status; bugVerification: boolean;
    names: Record<Status, string>;        // config.statuses, for reason texts
    activeCodePulls: number[];            // active merged PRs in the issue's subtree (§5.3)
    tasks: Status[]; bugs: Status[];      // story: active children
    stories: Status[];                    // usecase: all children, Canceled included
    linked: Status[];                     // cr: all linked, Canceled included
  }
  export function stateFor(status: Status): IssueState     // §4.7
  export function detectManual(issue: IssueFacts): ManualChange | null
  export function judgeManual(change: ManualChange, ctx: ManualContext): { accept: true } | { accept: false; reason: string }
  ```

- [ ] **Step 1: Write the failing tests**

`detectManual` (card marker `status 'inProgress'`, `at '2026-11-05T00:00:00Z'` unless stated):
  - `no card → null`
  - `matching status and state → null`
  - `status changed after marker.at → { to: 'done', at: <updatedAt>, by: 'ann' }`
  - `status updatedAt before marker.at (unfinished bot write) → null`
  - `empty project status is not a manual change` (`projectStatus null` → null)
  - `closed as completed → to 'done'`; `closed as not_planned → to 'canceled'`; `closed as duplicate means canceled` (state reason mapped to `not_planned` by facts — assert the same result)
  - `reopened while marker is done → to 'new'`
  - `close event before marker.at → null`
  - `status wins over state` (status changed to `inReview` and issue closed → `to 'inReview'`)

`judgeManual` — accepted: every row of §5.2 with its guard satisfied. Rejected, each asserting the reason text:
  - task `new → done` → `/manual change from New to Done is not allowed for task/`
  - task `→ canceled` with `activeCodePulls [12, 15]` → `/revert PR #12, #15 first/`
  - bug `inReview → done` with `bugVerification false` → `/only during verification/`
  - story `inReview → done` with `bugs ['new']` → `/all tasks and bugs must be Done/`
  - usecase `→ canceled` with `stories ['canceled', 'inProgress']` → `/all user stories must be Canceled/`
  - cr `inProgress → canceled` with `linked ['inProgress']` → `/all linked issues must be Canceled/`
  - accepted: cr `new → canceled` with `linked ['inProgress']` and no code; any type `canceled → new`.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement** — `detectManual` checks the Status first (§5.1), then the issue state against `stateFor(marker.status)`; a change counts only if its time is after `marker.at`. Reasons use `ctx.names` for status display names.
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): detect and judge manual status changes"`

---

### Task 9: Reconciliation

**Files:**
- Create: `automation/status-bot/src/rules/reconcile.ts`, `automation/status-bot/test/reconcile.test.ts`

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces: `reconcile(facts: Facts, config: Config): Desired[]` — one entry per issue with an `itemId`.

Algorithm (the part the tests do not fully determine):

```
order issues: task, bug, then story, then usecase, then cr; typeless last
results = Map<number, Desired>; code = Map<number, number[]>   // active merged PRs per subtree
for each issue:
  m = issue.card?.marker ?? null;  history = m?.history ?? []
  if type is null → Desired(status null, state null, assignees null, marker unchanged or new, warning = typeProblem); continue
  base = m?.status
  change = m ? detectManual(issue) : null
  if change: verdict = judgeManual(change, ctx)
     accept → m' = { status: change.to, source: 'manual', epoch: change.at }; history += 'changed manually' (+ ' by @x')
              bug inReview→new → assignees = [author of latest active merged PR, if member]; verifyAssigned = false
     reject → history += `reverted manual change to <X>: <reason>`; m' keeps base
  if m'.status == canceled → keep canceled (sticky)
  else compute: task/bug → collectWork(epoch = m'.epoch) → taskStatus / bugStatus
                  if m'.source == manual and computed == new → keep m'.status
                story → storyStatus(active child task/bug statuses from results, m')
                usecase → usecaseStatus(active child story statuses)
                cr → crStatus(active linked story/usecase statuses)
  bug: verification && !verifyAssigned → assignees = [pickQa(...)], verifyAssigned = true, bump loads
       !verification → verifyAssigned = false
  status changed vs m'.status → history += { from, to, reason }, source = 'bot'
  marker.at = now only if status/source/epoch/verifyAssigned/history changed
  state = stateFor(status); record code[issue] for the Canceled guard
```

Initial QA `loads`: for every bug whose card marker has `verifyAssigned: true` and `status: 'inReview'`, +1 for each current assignee.

Children of the wrong type (§3.3) are skipped with warning `Child #N is a <type>; only <allowed> count here — ignored`. A Canceled User Story gets warning `Children not canceled: #46, #49` when it has any.

- [ ] **Step 1: Write the failing tests** — each builds `facts(...)` with helpers and asserts on the returned `Desired` for one issue:
  - `reconcile: new task gets a card with a first history entry` (no card → status new, history `[{ from: null, to: 'new' }]`)
  - `reconcile: unchanged state keeps marker.at` (card marker equals computed → `marker.at` equals the input `at`)
  - `reconcile: branch moves task to In Progress`
  - `reconcile: forbidden manual change is reverted` (marker new, project status done after `at` → status `new`, history reason starts `reverted manual change to Done`)
  - `reconcile: cancel with merged code is reverted` (reason includes `revert PR #52 first`)
  - `reconcile: merged bug goes to verification and QA is assigned` (status inReview, assignees `['Black-Blood']`, `verifyAssigned true`)
  - `reconcile: QA is not reassigned on the next run` (marker `verifyAssigned true` → assignees `null`)
  - `reconcile: QA sends the bug back` (manual inReview → new accepted → epoch set, assignees `[PR author]`; with that epoch the old merged PR is ignored → status stays new)
  - `reconcile: story flow` (all tasks done → inReview; marker done/manual → done; a new open bug child → inReview)
  - `reconcile: use case closes in the same run as its last story`
  - `reconcile: change request follows blocked-by stories`
  - `reconcile: canceled is sticky` (canceled marker + new branch → canceled)
  - `reconcile: accepted manual change records who made it` (history reason `changed manually by @ann`)
  - `reconcile: canceled story lists children that are not canceled` (warning `Children not canceled: #46`)
  - `reconcile: cancel of a story is guarded by its children's code` (child task with active merged PR #52 → reverted, reason includes `#52`)
  - `reconcile: issue without a type label is left alone` (status null, warning `no type label`)
  - `reconcile: type change keeps epoch and recomputes` (Review Focus 3)
  - `reconcile: ignores wrong child types with a warning` (Review Focus 5)
- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement `reconcile`.**
- [ ] **Step 4: Verify** — `npm test` → PASS; `npm run typecheck` → no errors.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): reconcile desired state of all issues"`

---

### Task 10: Action planning

**Files:**
- Create: `automation/status-bot/src/apply/plan.ts`, `automation/status-bot/test/plan.test.ts`

**Interfaces:**
- Consumes: `renderCard` (Task 4), `Desired`, `IssueFacts`, `Action` (Task 1).
- Produces:
  `planAdditions(facts: Facts): Action[]` — `addToProject` for open issues with `itemId null` and `authorIsMember`;
  `planIssue(current: IssueFacts, desired: Desired, config: Config): Action[]` — in order `writeCard`, `setStatus`, `setState`, `setAssignees`, only where different; a `null` field in `Desired` produces no action;
  `buildPlan(perIssue: Action[][], limit: number, force: boolean): { actions: Action[]; changedIssues: number; blocked: boolean }`

- [ ] **Step 1: Write the failing tests**
  - `planIssue: nothing to do when everything matches` → `[]`
  - `planIssue: action order` → kinds `['writeCard', 'setStatus', 'setState', 'setAssignees']`
  - `planIssue: sets status when project status is null` (Review Focus 2)
  - `planIssue: creates the card when there is none` (`commentId: null`)
  - `planIssue: assignee order does not matter` (`['a','b']` vs `['b','a']` → no `setAssignees`)
  - `planAdditions: only open issues by members that are not in the project`
  - `buildPlan: 31 changed issues are blocked`, `buildPlan: force overrides the limit`, `buildPlan: 30 changed issues pass`
- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement the three functions.**
- [ ] **Step 4: Verify** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(status-bot): plan the minimal set of writes"`

---

### Task 11: Collecting facts from GitHub

**Files:**
- Create: `automation/status-bot/src/collect/github.ts`, `automation/status-bot/src/collect/facts.ts`, `automation/status-bot/test/facts.test.ts`, `automation/status-bot/test/fixtures/project.json`, `automation/status-bot/test/fixtures/repo.json`

**Interfaces:**
- Consumes: `findCard` (Task 4), `parseBranch` (Task 2), types (Task 1).
- Produces:
  ```ts
  // github.ts — thin, untested I/O; `gql` is octokit.graphql (with .paginate)
  // RawProject / RawRepo: types mirroring exactly the fields selected by the queries below
  export interface RawRepo { issues: RawIssue[]; pulls: RawPull[]; refs: RawRef[] }
  export function fetchProject(gql, owner: string, number: number, statusField: string): Promise<RawProject>
  export function fetchRepo(gql, owner: string, repo: string): Promise<RawRepo>
  // facts.ts — pure
  export function toFacts(raw: { project: RawProject; repo: RawRepo }, config: Config, repo: string, now: string): { facts: Facts; meta: ProjectMeta }
  ```

Queries (GraphQL, verified against the live schema):
- **Project** (`user(login) { projectV2(number) }`): `id`; `field(name: statusField) { ... on ProjectV2SingleSelectField { id options { id name } } }`; paginated `items` with `id`, `content { ... on Issue { number repository { nameWithOwner } } }`, `fieldValueByName(name: statusField) { ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt creator { login } } }`.
- **Repo** (`repository(owner, name)`): paginated `issues(states: [OPEN, CLOSED], first: 50)` with `id number state stateReason createdAt author { login } authorAssociation labels(first: 20) { nodes { name } } assignees(first: 10) { nodes { login } } parent { number } subIssues(first: 100) { nodes { number } } blockedBy(first: 50) { nodes { number } } timelineItems(itemTypes: [CLOSED_EVENT, REOPENED_EVENT], last: 1) { nodes { ... on ClosedEvent { createdAt } ... on ReopenedEvent { createdAt } } } comments(last: 100) { nodes { databaseId createdAt body author { login } } }`; paginated `pullRequests(first: 50)` with `number state isDraft baseRefName headRefName body createdAt mergedAt author { login } authorAssociation closingIssuesReferences(first: 10) { nodes { number } }`; paginated `refs(refPrefix: "refs/heads/", first: 100)` with `name target { ... on Commit { committedDate } }`.

- [ ] **Step 1: Write the fixtures** — hand-written JSON in the exact shape of the two query results: a project with items for issues #1–#5 (one item from another repository, one with no Status value), and a repo with issues covering: labels `Task`; `Bug`; `Task` + `Bug`; none; a `DUPLICATE` close; an `OWNER` and a `NONE` author; a bot card comment; a parent/sub-issue pair; one `blockedBy`; PRs in every state; refs `main`, `develop`, `feature/1-a`, `fix/2-b`.
- [ ] **Step 2: Write the failing tests** (`facts.test.ts`, each asserting on `toFacts(fixtures)`):
  - `toFacts: status options map to config statuses` (`meta.optionIds.inProgress` is the option id named `In Progress`)
  - `toFacts: missing status option throws` (fixture with `Canceled` removed → `/Canceled/`)
  - `toFacts: type from labels` (`Task` → task; `Task`+`Bug` → type null, `typeProblem 'several type labels: Task, Bug'`; none → `'no type label'`)
  - `toFacts: DUPLICATE maps to not_planned` (Review Focus 1)
  - `toFacts: membership from authorAssociation` (`OWNER` → true, `NONE` → false)
  - `toFacts: items from other repositories and pull request items are ignored`
  - `toFacts: project status and its author` (`projectStatus 'inProgress'`, `projectStatusUpdatedBy 'Black-Blood'`; item without value → `null`)
  - `toFacts: only feature/ and fix/ branches are kept`
  - `toFacts: bot card is found` (`card.marker.status` from the fixture)
  - `toFacts: issues not in the project have itemId null`
- [ ] **Step 3: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 4: Implement `toFacts`, then `fetchProject` / `fetchRepo`** with the queries above (`gql.paginate` for each paginated connection; issues are fetched separately from PRs and refs so each query has a single paginated connection).
- [ ] **Step 5: Verify** — `npm test` → PASS; `npm run typecheck` → no errors.
- [ ] **Step 6: Commit** — `git commit -m "feat(status-bot): collect facts from the GitHub API"`

---

### Task 12: Executing actions, run report, entry point

**Files:**
- Create: `automation/status-bot/src/apply/execute.ts`, `automation/status-bot/src/apply/summary.ts`, `automation/status-bot/src/main.ts`, `automation/status-bot/test/execute.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  export interface Clients {
    projectGql: (query: string, vars: object) => Promise<unknown>;   // PROJECT_TOKEN
    rest: { request: (route: string, params: object) => Promise<unknown> }; // GITHUB_TOKEN
  }
  export interface RunResult { done: Action[]; errors: { action: Action; message: string }[] }
  export function execute(actions: Action[], clients: Clients, meta: ProjectMeta, repo: string, dryRun: boolean): Promise<RunResult>
  export function renderSummary(r: { result: RunResult; blocked: boolean; dryRun: boolean; planned: Action[]; skipped: { issue: number; reason: string }[] }): string
  ```

Action → API call:
- `addToProject` → `addProjectV2ItemById(input: { projectId, contentId })` via `projectGql`
- `setStatus` → `updateProjectV2ItemFieldValue(input: { projectId, itemId, fieldId, value: { singleSelectOptionId } })` via `projectGql`
- `writeCard` → `POST /repos/{owner}/{repo}/issues/{n}/comments` or `PATCH /repos/{owner}/{repo}/issues/comments/{id}`
- `setState` → `PATCH /repos/{owner}/{repo}/issues/{n}` with `state` and `state_reason`
- `setAssignees` → `PATCH /repos/{owner}/{repo}/issues/{n}` with `assignees`

- [ ] **Step 1: Write the failing tests** (fake `Clients` that record calls and can be told to throw):
  - `execute: dry run makes no calls` (returns all actions in `done`, zero recorded calls)
  - `execute: maps each action to its API call` (route / mutation name and key params per the list above)
  - `execute: an error skips the rest of that issue only` (issue 1 `setStatus` throws → its `setState` not called; issue 2 actions run; `errors` has one entry with the message)
  - `renderSummary: lists changes, skips and errors`; `renderSummary: says nothing was written when blocked or dry run`
- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.
- [ ] **Step 3: Implement `execute` and `renderSummary`.**
- [ ] **Step 4: Implement `src/main.ts`** — reads `GITHUB_TOKEN`, `PROJECT_TOKEN`, `GITHUB_REPOSITORY`, `DRY_RUN`, `FORCE`, `GITHUB_STEP_SUMMARY`; builds two `Octokit` clients (`throttle.onRateLimit` and `onSecondaryRateLimit` retry while `retryCount < 2`); flow: `loadConfig` → `fetchProject` + `fetchRepo` → `toFacts` → `planAdditions` → if any: `execute` them and collect again → `reconcile` → `planIssue` per issue → `buildPlan` → blocked? write summary, exit 1 → `execute` → append summary → exit 1 if `errors.length`.
- [ ] **Step 5: Verify** — `npm test` → PASS; `npm run typecheck` → no errors; `node src/main.ts` with no env → exits 1 with `GITHUB_TOKEN is required`.
- [ ] **Step 6: Commit** — `git commit -m "feat(status-bot): execute actions and report the run"`

---

### Task 13: Workflow, repository setup, acceptance

**Files:**
- Create: `.github/workflows/status-bot.yml`

**Interfaces:**
- Consumes: `npm start` (Task 12), the setup list in §9.

- [ ] **Step 1: Write `.github/workflows/status-bot.yml`** — triggers, `concurrency` and `permissions` exactly as §7.3. One job on `ubuntu-latest`: `actions/checkout@v4` with `ref: ${{ github.event.repository.default_branch }}` (never the PR head), `actions/setup-node@v4` (node 24, npm cache), `npm ci` and `npm start` in `automation/status-bot` with env `GITHUB_TOKEN: ${{ github.token }}`, `PROJECT_TOKEN: ${{ secrets.PROJECT_TOKEN }}` (this step only), `DRY_RUN: ${{ inputs.dry-run || false }}`, `FORCE: ${{ inputs.force || false }}`.
- [ ] **Step 2: Verify the YAML parses** — `node --input-type=module -e "import { parse } from 'yaml'; import { readFileSync } from 'node:fs'; parse(readFileSync('../../.github/workflows/status-bot.yml', 'utf8')); console.log('ok')"` → `ok`. GitHub validates the rest on push (errors appear on the Actions tab).
- [ ] **Step 3: Commit** — `git add .github/workflows/status-bot.yml && git commit -m "ci(status-bot): run the bot on repository events and schedule"`
- [ ] **Step 4: Repository setup (ask the owner before running; these change the live repository)** — from the repo root:
  - `git push origin main:develop`, then `gh repo edit --default-branch develop --delete-branch-on-merge`
  - ruleset requiring PRs on `develop`: `gh api repos/Black-Blood/yet-another-useless-headless-ui-library/rulesets -X POST --input -` with body `{"name":"develop","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/develop"],"exclude":[]}},"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false}}]}`
  - owner creates a classic PAT with the `project` scope, then runs `gh secret set PROJECT_TOKEN`
  - owner, in the UI: Settings → General → Issues → turn off auto-closing issues when linked PRs are merged; Project #4 → Workflows → disable all built-in workflows (§9.6)
- [ ] **Step 5: Ship** — push `feat/status-bot`, open a PR into `develop`, wait for green CI, merge.
- [ ] **Step 6: Dry run** — `gh workflow run status-bot.yml -f dry-run=true`, then `gh run watch` → the run succeeds and its summary lists planned actions and no errors.
- [ ] **Step 7: Acceptance** — run the nine scenarios of §8.1 on real issues; record each result (pass/fail, issue numbers) in a follow-up issue.
