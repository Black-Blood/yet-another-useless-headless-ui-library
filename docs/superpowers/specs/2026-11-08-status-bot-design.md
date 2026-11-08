# Status bot — issue status automation

- **Date:** 2026-11-08
- **Repository:** `Black-Blood/yet-another-useless-headless-ui-library`
- **Project:** `Black-Blood` / #4 "Yet another useless headless UI library"
- **Document status:** draft for review

## 1. Goal

The **Status** field in Project #4 must reflect the real state of the work and
change automatically, driven by branches, pull requests and the state of child
issues. People change the status by hand only where this is explicitly allowed.
Every status change is explained in the issue itself.

### Success criteria

1. For Task and Bug, the status moves New → In Progress → In Review → Done with no
   manual action, driven only by work on branches and PRs.
2. User Story, Use Case and Change Request change status based on the state of
   their child (linked) issues.
3. A forbidden manual status change is reverted by the next run of the bot: the
   next repository event (branch, PR or issue), the hourly scheduled run, or a
   manual run. Every run reconciles all issues, so nothing is lost, only delayed.
4. An issue cannot be moved to Canceled while code from that issue (or its
   descendants) merged into `develop` has not been reverted.
5. Every issue shows its current status, the reason for it, and the change history.

### Out of scope

- Blocking manual changes instantly — GitHub Projects does not support it.
- Reliably identifying *who* changed a status by hand (a project owned by a
  personal account has no webhooks; see §5.4).
- Several repositories in one Project.
- Automating the Priority, Size, Estimate, Iteration and date fields.
- Issue templates (`.github/ISSUE_TEMPLATE`) — a separate task.

## 2. Environment constraints

| Constraint | Design consequence |
|---|---|
| The Project belongs to a personal account | No Issue Types → the type comes from a label. No `projects_v2_item` webhook → manual changes in the Project are detected by the next run (an event or the hourly schedule) |
| `GITHUB_TOKEN` cannot access a personal account's Project | A PAT `PROJECT_TOKEN` is required (classic, `project` scope) |
| The repository is public | Outsiders can open issues; their PRs come from forks → `pull_request_target` |
| GitHub Actions has no trigger for sub-issue or "Blocked by" changes | The next run picks these changes up (at the latest the hourly schedule) |
| Events caused by `GITHUB_TOKEN` do not trigger workflows | Issue writes go through `GITHUB_TOKEN` → the bot does not loop |

## 3. Data model

### 3.1 Statuses

Values of the Status field in the Project (exact names): `New`, `In Progress`,
`In Review`, `Done`, `Canceled`.

### 3.2 Issue types

The type is defined by a label. The bot does not process an issue with no type
label or with several type labels, and reports the problem in its card (§3.5).

| Label | Type | Role |
|---|---|---|
| `Bug` | bug | defect |
| `Task` | task | technical work |
| `User Story` | story | user-facing functionality (Feature) |
| `Use Case` | usecase | complete interaction scenario (Epic) |
| `Change Request` | cr | change to agreed behavior or scope |

The bot ignores the `I need help` label.

### 3.3 Relationships

- **Structure — sub-issues:** Use Case → User Story → Task / Bug.
  - A Use Case's children are User Stories only; a User Story's children are
    Tasks and Bugs only. Other types among the children are ignored with a
    warning in the card.
  - Tasks and Bugs may have no parent.
- **Origin — "Blocked by":** a Change Request is *blocked by* the User Stories /
  Use Cases created from it. For a CR, only issues of type story and usecase in
  its "Blocked by" list count; other dependencies are ignored.
- **Active issues:** issues in Canceled are excluded from the rules of their
  parent and linked issues.

### 3.4 Branches and PRs

- **Integration branch:** `develop` (also the default branch).
- **Branch names** follow Conventional Branch:

  | Prefix | Used for | Bot |
  |---|---|---|
  | `feat/<N>-<slug>` | a Task | links it to Task `N` |
  | `fix/<N>-<slug>` | a Bug | links it to Bug `N` |
  | `chore/<slug>` | other work: docs, refactoring, tooling | ignores it |
  | `revert/<slug>`, `revert-<N>-…` | reverts (the second form is what GitHub's Revert button makes) | ignores the branch; reverts are recognized from the PR text |

  `N` is the issue number. If the prefix does not match the type of issue `N`, the
  branch is ignored with a warning in the card. A branch that names a User Story,
  Use Case or Change Request is ignored with a warning on that issue's card — only
  tasks and bugs get branches. A branch `<N>-<slug>` without a prefix (the default
  name of GitHub's "Create a branch" button) is still accepted for a Task or Bug,
  although the branch-name ruleset (§9) normally prevents creating it.
- **Releases** are marked with tags (`vX.Y.Z`) on `main`, not with branches.
- **Linking a PR to an issue:**
  1. by head branch name (same pattern, including PRs from forks);
  2. fallback — a PR linked to the issue through the **Development** sidebar
     section (`closingIssuesReferences`).
- **Only PRs with base `develop` count.** A PR targeting another branch is ignored
  with a warning in the card.
- **Revert:** a merged PR `P` is *reverted* if a PR merged into `develop` has a
  description containing either
  - `This reverts commit <sha>`, where `<sha>` (full, or at least 7 characters)
    is the commit P's merge created — the format of the GitHub Revert button and
    of `git revert`; or
  - `Reverts <owner>/<repo>#P` or `Reverts #P`,

  and that revert PR is not itself reverted. Revert chains are resolved
  recursively.
- **Active merged PR** — merged into `develop` and not reverted.

### 3.5 Status card

In every processed issue the bot keeps **one** comment authored by
`github-actions[bot]` and edits it (it never posts new comments).

```
🤖 Status: In Review
Reason: PR #52 opened (not draft)

⚠️ Branch `feat/49-modal` does not match the type of issue #49 (bug) — ignored

History
| When        | From        | To          | Reason                          |
|-------------|-------------|-------------|---------------------------------|
| 11-07 10:12 | In Progress | In Review   | PR #52 opened                   |
| 11-06 15:40 | New         | In Progress | branch fix/49-modal appeared    |
<!-- status-bot: {"v":1,"status":"In Review","source":"bot","epoch":null,"at":"2026-11-07T10:12:03Z","verifyAssigned":false} -->
```

The history keeps the last 20 entries.

**Marker** (last line, JSON):

| Field | Meaning |
|---|---|
| `v` | format version, `1` |
| `status` | the status the bot last wrote or accepted as a manual change |
| `source` | `bot` — computed by the bot; `manual` — an accepted manual change |
| `epoch` | ISO time of the last accepted manual change, or `null` |
| `held` | the last accepted manual status, or `null` (§4.1, §4.4) |
| `at` | ISO time the card was last written |
| `verifyAssigned` | Bug only: QA has already been assigned for the current verification |

The marker is trusted only if the comment author is `github-actions[bot]`. If
there are several such comments, the newest one is used and the rest are ignored.

## 4. Status rules

### 4.1 General

- Computation runs bottom-up: Task/Bug → User Story → Use Case → Change Request,
  so parents see their children's updated statuses in the same run.
- **Canceled is sticky:** while an issue is in Canceled, no rules apply. The only
  way out is the manual change Canceled → New (§5).
- **`epoch` filter (Task and Bug only):** if the marker has an `epoch`, then
  - merged PRs count only if `mergedAt > epoch`;
  - branches count only if their last commit date is `> epoch`;
  - open PRs always count — they are the current state.
- **An accepted manual status holds until something real happens (Task and Bug
  only):** if `held` is set and computing from the facts after `epoch` yields New,
  the status is `held`. A PR that was opened and closed without merging therefore
  does not undo an accepted status, even if the bot changed the status while the
  PR was open.
- **Outsiders cannot disturb finished work:** for a Task or Bug whose status is
  Done, open PRs by non-members (`authorAssociation` not in `OWNER`, `MEMBER`,
  `COLLABORATOR`) are ignored. Merged PRs always count.
- Rule tables are evaluated top to bottom; the first row whose condition holds wins.

### 4.2 Task

| # | Condition | Status |
|---|---|---|
| 1 | there is an open PR (not draft) | In Review |
| 2 | there is an open draft PR | In Progress |
| 3 | there is an active merged PR | Done |
| 4 | there is a branch `feat/N-…` | In Progress |
| 5 | otherwise | New |

### 4.3 Bug

| # | Condition | Status |
|---|---|---|
| 1 | there is an open PR (not draft) | In Review (code review) |
| 2 | there is an open draft PR | In Progress |
| 3 | there is an active merged PR | In Review (**verification**) |
| 4 | there is a branch `fix/N-…` | In Progress |
| 5 | otherwise | New |

**Verification stage** — a Bug for which row 3 matched.

**QA assignment** on entering verification (`verifyAssigned = false`):
1. if the bug's author is in the `qa` list → assign the author;
2. otherwise → the QA from the list with the fewest Bugs in verification assigned
   to them; on a tie, the first one in list order.

The issue's assignees are replaced with the chosen QA; `verifyAssigned := true`.
The bot does not assign QA again (and does not revert a manual assignee change
during this stage). On leaving the verification stage, `verifyAssigned := false`.

### 4.4 User Story

Children — active Tasks and Bugs.

| # | Condition | Status |
|---|---|---|
| 1 | no Tasks at all | New |
| 2 | some Task is not Done, and at least one Task is not New | In Progress |
| 3 | all Tasks are New | New |
| 4 | all Tasks Done, all Bugs Done, and the accepted Done still holds | Done |
| 5 | all Tasks Done | In Review |

**The accepted Done still holds** when `held = Done` and, since `epoch`, no child
Task or Bug was created and no PR of a child was merged into `develop`. A new bug,
a new task or newly merged code needs a new manual Done; PRs that were opened and
closed without merging do not.

### 4.5 Use Case

Children — active User Stories.

| # | Condition | Status |
|---|---|---|
| 1 | no User Stories at all | New |
| 2 | all User Stories Done | Done |
| 3 | some User Story is not New | In Progress |
| 4 | otherwise | New |

### 4.6 Change Request

Linked issues — active User Stories and Use Cases from the "Blocked by" list.

| # | Condition | Status |
|---|---|---|
| 1 | no linked issues | New |
| 2 | all linked issues Done | Done |
| 3 | otherwise | In Progress |

### 4.7 Issue state (open / closed)

| Status | Issue state |
|---|---|
| Done | closed, reason `completed` |
| Canceled | closed, reason `not_planned` |
| others | open |

## 5. Manual changes

### 5.1 Detection

A manual change is when the current Status in the Project differs from
`marker.status` **or** the issue state does not match `marker.status` per the
table in §4.7.

- **An unfinished bot write is not a manual change.** If the `updatedAt` of the
  Status field value is earlier than `marker.at` (or, for the issue state, the
  latest close / reopen event in the issue timeline is earlier than `marker.at`
  or does not exist), the bot simply repeats the write (§6.1).
- Manually closing / reopening an issue counts as a manual status change:
  closed `completed` → Done; closed `not_planned` → Canceled; reopened while
  `marker.status` ∈ {Done, Canceled} → New.
- If both the Status and the issue state changed, the Status wins.
- Time of the change: `updatedAt` of the Status field value (or `closedAt` / the
  reopen time of the issue); if unavailable — the detection time.

### 5.2 Allowed manual changes

| Type | Transition | Condition (guard) | Effects |
|---|---|---|---|
| all | any → Canceled | Canceled guard (§5.3) + type condition below | close the issue as `not_planned` |
| all | Canceled → New | — | reopen the issue |
| Bug | In Review → Done | Bug in verification | close the issue as `completed` |
| Bug | In Review → New | Bug in verification | assignee := author of the latest active merged PR, if they are a repository member (§6.2); `verifyAssigned := false` |
| User Story | In Review → Done | all active Tasks and Bugs are Done | close the issue as `completed` |
| Use Case | → Canceled | all User Stories are Canceled | |
| Change Request | → Canceled | the CR is New **or** all linked User Stories / Use Cases are Canceled | |

For an accepted change: `status := new value`, `source := manual`,
`epoch := time of the change`, `held := new value`. History entry: "changed manually".

Any other manual change is **reverted**: the bot restores `marker.status` and the
issue state, and the card says what was reverted and why (for Canceled — the list
of PRs that must be reverted first).

### 5.3 Canceled guard

There is no active merged PR:
- Task / Bug — on the issue itself;
- User Story — on any child Task or Bug;
- Use Case — on any child User Story or its children;
- Change Request — on any linked User Story / Use Case or their descendants.

Canceling a User Story does not cancel its children automatically; the User
Story's card lists the children that are not Canceled.

### 5.4 Who made the change

If the Project API returns the author of the field value, the bot adds it to the
history entry. Otherwise it writes "changed manually" with no author.

## 6. Applying changes

### 6.1 Write order

For every issue the bot computes the desired state (Status, issue state,
assignees, card), compares it with the current state, and writes only the
difference:

1. the card (new marker with `at = now`);
2. the Status in the Project (`PROJECT_TOKEN`);
3. the issue state and assignees (`GITHUB_TOKEN`).

If step 2 fails, the next run sees `updatedAt < marker.at` and repeats the write
(§5.1).

### 6.2 Adding issues to the Project

The bot adds open repository issues that are not in the Project if the author is
a **repository member**: the issue's `authorAssociation` ∈ {`OWNER`, `MEMBER`,
`COLLABORATOR`}. Outsiders' issues are not added — a maintainer adds them after
triage. An added issue is reconciled in the same run, using the item id that
GitHub returns (listing the Project right after adding can miss the new item). The bot neither adds nor processes pull requests in the Project.

### 6.3 Safeguards

- **Change limit:** if a run plans to change more than `maxChangesPerRun` (30)
  issues, it writes nothing, reports, and fails. Override: a manual run with
  `force: true`.
- **`dry-run`:** a manual run with `dry-run: true` only builds the plan and report.
- **First run:** for an issue with no card the bot writes the computed status and
  creates the card, without manual change detection.

### 6.4 Errors

- Transient API errors (network, 5xx, 429, GraphQL `RATE_LIMITED`) are retried up
  to 3 times with backoff (1 s, 2 s, 4 s). `Retry-After` is honored; an exhausted
  rate limit is waited out only if it resets within 60 s, otherwise the call fails.
- An error in one issue does not stop the others.
- Run report (`$GITHUB_STEP_SUMMARY`): changed issues, skipped issues with the
  reason, errors. If there were errors, the run fails.

## 7. Architecture

### 7.1 Files

```
.github/workflows/
  status-bot.yml          # runs the bot
  status-bot-ci.yml       # bot tests on PRs
automation/status-bot/
  deno.json               # tasks (start, test, check), imports: jsr:@std/yaml, jsr:@std/assert
  deno.lock
  config.yml
  src/
    main.ts               # collect → compute → plan → apply → summary
    config.ts             # loads and validates config.yml
    client.ts             # GitHub API client on fetch: GraphQL + pagination, REST, retries
    types.ts
    collect/
      github.ts           # GraphQL / REST queries with pagination
      facts.ts            # API responses → Facts (pure)
      branch-name.ts      # branch name → { type, number }
      revert.ts           # "Reverts …#N", active merged PRs
      marker.ts           # reads / writes the card and marker
    rules/
      task.ts bug.ts story.ts usecase.ts cr.ts
      manual.ts           # manual change detection, allowed transitions, guards
      qa.ts               # QA selection
      reconcile.ts        # bottom-up order, desired state of every issue
    apply/
      plan.ts             # current + desired → list of actions (pure)
      execute.ts          # executes the actions through the API
      summary.ts          # run report
  test/                   # *.test.ts, mirroring src/
```

- Runtime: **Deno 2.9.8**, which bundles **TypeScript 6.0.3**. Dependencies come
  only from JSR (`@std/yaml`, `@std/assert` for tests); there are no npm packages.
  The GitHub API is called through `src/client.ts` on `fetch`.
- `deno task start` runs the bot with the narrowest permissions:
  `--allow-env=GITHUB_TOKEN,PROJECT_TOKEN,GITHUB_REPOSITORY,DRY_RUN,FORCE`,
  `--allow-net=api.github.com`, `--allow-read=./config.yml`. The run report goes
  to stdout.
- Tests use `Deno.test` with `@std/assert` (`deno task test`); type checking is
  `deno task check`; linting is `deno lint`.

### 7.2 `config.yml`

```yaml
project:
  owner: Black-Blood
  number: 4
  statusField: Status
statuses:
  new: New
  inProgress: In Progress
  inReview: In Review
  done: Done
  canceled: Canceled
integrationBranch: develop
branchPrefix:
  task: feat
  bug: fix
typeLabels:
  bug: Bug
  task: Task
  story: User Story
  usecase: Use Case
  cr: Change Request
qa:
  - Black-Blood
maxChangesPerRun: 30
historySize: 20
```

### 7.3 Workflow `status-bot.yml`

```yaml
on:
  create:
  delete:
  pull_request_target:
    types: [opened, reopened, closed, edited, ready_for_review, converted_to_draft]
  issues:
    types: [opened, closed, reopened, labeled, unlabeled]
  schedule:
    - cron: "17 * * * *"
  workflow_dispatch:
    inputs:
      dry-run: { type: boolean, default: false }
      force:   { type: boolean, default: false }

concurrency:
  group: status-bot
  cancel-in-progress: false

permissions:
  contents: read
  issues: write
  pull-requests: read
```

- **Every run is a full reconciliation** of all issues in the Project; an event
  only makes it happen sooner.
- `pull_request_target` runs the bot's code from `develop` and **never** checks
  out the PR's code.
- `PROJECT_TOKEN` is passed only to the step that runs the bot.

### 7.4 Tokens

| Token | Used for |
|---|---|
| `GITHUB_TOKEN` | reading branches, PRs and issues; the card, assignees, closing / reopening issues |
| `PROJECT_TOKEN` (classic PAT, `project` scope) | reading the Project and field values, changing Status, adding issues to the Project |

## 8. Testing

| Module | What the tests cover |
|---|---|
| `rules/*` | every row of the tables in §4.2–4.6; the `epoch` filter; "a manual status holds"; Canceled is sticky; draft + merged PR; QA selection (author is QA, least loaded, tie) |
| `rules/manual.ts` | every row of §5.2 (accepted / reverted); the Canceled guard at every level; an unfinished bot write (`updatedAt < marker.at`); Status taking precedence over issue state |
| `collect/branch-name.ts` | valid / invalid names, type mismatch |
| `collect/revert.ts` | `Reverts #N`, `Reverts owner/repo#N`, revert of a revert, revert not into `develop` |
| `collect/marker.ts` | read / write, a forged card not authored by the bot, several cards, history truncation |
| `collect/facts.ts` | mapping of saved API responses (fixtures) |
| `apply/plan.ts` | diff of current vs desired; no actions when everything matches; change limit |

CI (`status-bot-ci.yml`): on PRs that change `automation/**` or
`.github/workflows/status-bot*.yml` — `deno task check`, `deno lint`, `deno task test`.

### 8.1 Acceptance scenarios (manual, on the real repository)

First a run with `dry-run: true`, then:

1. A member creates an issue labeled `Task` → it appears in the Project as New,
   with a card.
2. Branch `feat/N-x` → In Progress; draft PR → In Progress; Ready for review →
   In Review; merge → Done, issue closed.
3. Bug: `fix/N-x` → PR → merge → In Review, assignee is QA. QA sets New →
   assignee is the developer; new branch → In Progress → … → In Review; QA sets
   Done → issue closed.
4. A Task with a merged PR set to Canceled by hand → reverted, with the list of
   PRs; after the revert PR is merged → Canceled is accepted.
5. User Story: tasks progress → In Progress → all Done → In Review → Done by hand;
   a new Bug in this User Story → In Review.
6. Use Case: all User Stories Done → Done.
7. Change Request: "Blocked by" a User Story added → In Progress; User Story Done →
   Done; an attempt to cancel while the User Story is active → reverted.
8. A Task set from New to Done by hand → reverted by the next run (the hourly
   schedule, or trigger one by hand), and the card shows "reverted manual change to
   Done".
9. An outside account creates an issue → it does not appear in the Project.

## 9. One-time repository setup

1. Create the `develop` branch from `main` and make it the default branch.
2. Settings → General → Pull Requests: enable **Automatically delete head
   branches**.
3. Settings → General → Issues: disable automatic closing of issues when linked
   PRs are merged.
4. Ruleset for `develop`: changes only through PRs.
5. Secret `PROJECT_TOKEN`: a classic PAT of the Project owner with the `project`
   scope.
6. Project #4 → Workflows: disable all built-in workflows (Item added, Item
   closed, Item reopened, Pull request merged, Pull request linked to issue,
   Auto-close issue, Auto-add to project, Auto-archive).
7. Ruleset `branch-names` (restrict creations, no bypass): new branches may only
   be named `feat/**`, `fix/**`, `chore/**`, `revert/**` or `revert-*` (the
   Revert button). GitHub's "Create a branch" dialog then requires the prefix.
8. Repository variable `STATUS_BOT_LIVE = true` — set it only after a dry run has
   been reviewed. Until then every run is a dry run, so
   merging the bot does not start writing.

## 10. Risks and open questions

| Risk | Mitigation |
|---|---|
| Changes made only in the Project (status drag, sub-issues, "Blocked by") wait up to an hour | Every run reconciles everything; close/reopen issues instead of dragging cards where possible, or run the workflow by hand |
| GitHub disables scheduled workflows in a public repository after 60 days without repository activity | Events still run the bot; re-enable with `gh workflow enable status-bot.yml` |
| The API may not return `updatedAt` / the author of a Project field value | Check at the start of implementation; fallback — detection time, no author |
| Outsiders name fork branches arbitrarily | Fallback through Development; document the naming rule in CONTRIBUTING |
| A classic PAT grants broader access than needed | `project` scope only; the secret is passed only to the bot step; Deno lets the bot reach only `api.github.com` |
| GitHub limits: up to 100 sub-issues per parent, up to 50 "Blocked by" | Enough for this project |
