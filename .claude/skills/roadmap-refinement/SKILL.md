---
name: roadmap-refinement
description: Audit open issues and project board. Flags done-but-open issues, board drift, and stale items for bulk cleanup.
---

# Roadmap Refinement

Audit the backlog and project board, then present findings for approval before making changes.

## Keep `docs/roadmap.md` in sync

`docs/roadmap.md` is the canonical roadmap *narrative* — what we're building, the wave model, the track structure, and the A→B→C merge ladder. The [project board (#5)](https://github.com/orgs/solo-ist/projects/5/views/1) is the live *queue* (column = phase, milestone = wave). **These two must stay consistent.** Board cleanup that changes the narrative — an epic completes, a wave's scope shifts because issues were closed or superseded, track sequencing changes — must be reflected in `docs/roadmap.md` in the *same* pass, or the doc silently drifts out of date. Read the doc before auditing; propose doc edits alongside the board edits.

## Usage

```
/roadmap-refinement
```

No arguments. Operates on `solo-ist/prose` and the Prose Roadmap project (project #5).

## Workflow

### 1. Gather State

Fetch all data in parallel using `gh` CLI:

```bash
gh issue list --repo solo-ist/prose --state open --limit 200 --json number,title,labels,updatedAt,createdAt,comments,body,milestone
gh pr list --repo solo-ist/prose --state all --limit 200 --json number,title,state,mergedAt,body,headRefName,closedAt
gh project item-list 5 --owner solo-ist --format json --limit 500
```

Also read the current `docs/roadmap.md` — it is the narrative the board should match, so you can flag where the two have drifted. If your worktree may be behind `main`, read the live version with `git show origin/main:docs/roadmap.md` after `git fetch origin`.

Use `--jq` for data extraction instead of piping to external processors (e.g., `python3`, `jq`). This keeps each command as a single `gh` invocation that matches the Bash allowlist:

```bash
gh project item-list 5 --owner solo-ist --format json --limit 500 --jq '.items[] | "\(.content.number)\t\(.id)\t\(.status)\t\(.content.type)\t\(.content.title)"'
```

**Important:** `gh project item-list` returns ALL items regardless of issue state — the GitHub Projects UI `is:open` filter is view-only and not applied by the API. After fetching, build an open issues set from the issues list and use it to distinguish open vs closed board items throughout the analysis.

### 2. Cross-Reference: Done but Open

For each open issue, check if it's likely completed:

- **Linked merged PRs**: Issue referenced in a merged PR's body or commit messages
- **Closed branches**: An `issue-<number>-*` branch exists but the issue is open
- **Stale in-flight work**: A linked open PR or `issue-<number>-*` branch exists but the issue has had no activity in 30+ days (may have been quietly merged or abandoned)

Flag these as candidates for closing. Do NOT close automatically.

### 3. Board Drift

Compare open issues against the project board:

- **Missing from board**: Open issues not tracked in the project
- **No status**: Items on the board with null/empty status
- **Closed but on board**: Issues closed but still showing as active on the board
- **Superseded**: Issues whose work has been absorbed by other issues

### 4. Staleness Check

Flag issues with no activity (comments, commits, PR references) in 60+ days. These may need:

- Closing as stale
- Re-prioritization
- A comment to confirm still relevant

### 5. Present Findings

Output a structured report:

```markdown
## Backlog Audit

### Ready to Close (done but still open)
| # | Title | Evidence | Suggested Note |
|---|-------|----------|----------------|
| 42 | Fix login | PR #50 merged | Done — fixed in #50 |

### Board Drift
| Issue | Problem | Action |
|-------|---------|--------|
| #55 | Missing from board | Add to [column] |
| #60 | Status is null | Set to [column] |

### Stale (60+ days inactive)
| # | Title | Last Activity | Recommendation |
|---|-------|---------------|----------------|
| 30 | Old feature | 2025-10-01 | Close or re-prioritize |

### Roadmap Doc Updates (`docs/roadmap.md`)
| Section | Drift | Proposed Edit |
|---------|-------|---------------|
| Wave 1 / Track B | #312 shipped but still listed as in-flight | Move to "shipped" / retire from active wave |

### Summary
- X issues ready to close
- X board items need status updates
- X stale issues to review
- X `docs/roadmap.md` sections need updating to match the board
```

### 6. Execute on Approval

Wait for the user to review the report. Then use **only safe operations**.

**Important:** Use individual parallel Bash calls for batch operations — never `for` loops. Loops are shell constructs that don't match the Bash allowlist and force manual approval on every invocation. Individual calls auto-approve and run concurrently (faster too).

**Closing issues:**
```bash
gh issue close <NUMBER> --repo solo-ist/prose --comment "..."
```

**Archiving completed/closed items** (the board has no Done column — archive is the terminal state):
```bash
gh project item-archive 5 --owner solo-ist --id <ITEM_ID>
```
Prefer `item-archive` over `item-delete`: archiving is reversible (`item-unarchive`) and preserves the tracked record. Reserve `item-delete` for items added by mistake that should leave no trace.

**Moving items between columns:**
```bash
gh project item-edit --project-id <PROJECT_ID> --id <ITEM_ID> --field-id <STATUS_FIELD_ID> --single-select-option-id <OPTION_ID>
```

**Adding issues to the board:**
```bash
gh project item-add 5 --owner solo-ist --url <ISSUE_URL>
```

**Updating the roadmap narrative:** When approved board changes alter the roadmap (an epic completes, a wave's scope shifts, sequencing changes), edit `docs/roadmap.md` in the same pass so the narrative and the board stay consistent. This is a normal file edit — commit it on a branch / open a PR; it is *not* a `gh project` operation. Don't archive a completed epic's board items without also retiring it from the doc's active waves.

## Board Columns

Current status options on the Prose Roadmap board:

| Column | Purpose |
|--------|---------|
| **User Requested** | Feature requests from users — needs triage |
| **Do First** | Highest priority — work on these now |
| **Do Next** | Next up after current work completes |
| **Later** | Backlog — not yet prioritized |
| **Quick Wins** | Low effort, high value — ship alongside bigger work |
| **On Hold** | Blocked or paused |

There is **no Done/terminal column** — every option above is an active-work bucket — and **no "In Progress" column**; track in-flight work via open PRs and `issue-<number>-*` branches, not a board status. When an issue is closed or its PR merges, archive its board item (`gh project item-archive`); do not leave it sitting in an active column, and do not delete it.

## Dangerous Operations — DO NOT USE

**NEVER use `updateProjectV2Field` to modify single-select field options.** This GraphQL mutation replaces option IDs, which silently disconnects every board item from its status — effectively wiping the entire board. This has happened before and required manual recovery.

If the board needs a new status column or option changes, tell the user to do it manually in the GitHub UI.

Safe operations are limited to:
- `gh project item-edit` — move items between existing columns
- `gh project item-archive` — archive completed/closed items (reversible terminal state; the board has no Done column)
- `gh project item-add` — add items to the board
- `gh project item-delete` — remove an item entirely (use only for mistaken additions; prefer archive for done work)

## Key Principles

- **Never close issues without approval.** Present, don't act.
- **Evidence over assumptions.** Link to the merged PR or commit that completed the work.
- **Board is source of truth for priority.** If an issue isn't on the board, it's not prioritized.
- **Stale != irrelevant.** Flag staleness, but let the user decide disposition.
- **Done items are archived, not deleted.** There is no Done column — archive closed/merged items off the active board with `item-archive` (reversible). Don't leave them in an active column; don't `item-delete` them.
- **The doc and the board move together.** `docs/roadmap.md` is the narrative; board #5 is the queue. Any cleanup that changes the narrative gets reflected in the doc in the same pass — never let the doc drift behind the board.
- **Never mutate field definitions.** Only move items between existing columns.
