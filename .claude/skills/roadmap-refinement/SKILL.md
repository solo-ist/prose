---
name: roadmap-refinement
description: Audit open issues and project board. Flags done-but-open issues, board drift, and stale items for bulk cleanup.
---

# Roadmap Refinement

Audit the backlog and project board, then present findings for approval before making changes.

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

Use `--jq` for data extraction instead of piping to external processors (e.g., `python3`, `jq`). This keeps each command as a single `gh` invocation that matches the Bash allowlist:

```bash
gh project item-list 5 --owner solo-ist --format json --limit 500 --jq '.items[] | "\(.content.number)\t\(.id)\t\(.status)\t\(.content.type)\t\(.content.title)"'
```

**Important:** `gh project item-list` returns ALL items regardless of issue state — the GitHub Projects UI `is:open` filter is view-only and not applied by the API. After fetching, build an open issues set from the issues list and use it to distinguish open vs closed board items throughout the analysis.

### 2. Cross-Reference: Done but Open

For each open issue, check if it's likely completed:

- **Linked merged PRs**: Issue referenced in a merged PR's body or commit messages
- **Closed branches**: An `issue-<number>-*` branch exists but the issue is open
- **Stale "In Progress"**: On the board as In Progress but no activity in 30+ days

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

### Summary
- X issues ready to close
- X board items need status updates
- X stale issues to review
```

### 6. Execute on Approval

Wait for the user to review the report. Then use **only safe operations**.

**Important:** Use individual parallel Bash calls for batch operations — never `for` loops. Loops are shell constructs that don't match the Bash allowlist and force manual approval on every invocation. Individual calls auto-approve and run concurrently (faster too).

**Closing issues:**
```bash
gh issue close <NUMBER> --repo solo-ist/prose --comment "..."
```

**Removing closed items from board:**
```bash
gh project item-delete 5 --owner solo-ist --id <ITEM_ID>
```

**Moving items between columns:**
```bash
gh project item-edit --project-id <PROJECT_ID> --id <ITEM_ID> --field-id <STATUS_FIELD_ID> --single-select-option-id <OPTION_ID>
```

**Adding issues to the board:**
```bash
gh project item-add 5 --owner solo-ist --url <ISSUE_URL>
```

## Board Columns

Current status options on the Prose Roadmap board:

| Column | Purpose |
|--------|---------|
| **User Requested** | Feature requests from users — needs triage |
| **Do First** | Highest priority — work on these now |
| **In Progress** | Actively being worked on by a human or agent |
| **Do Next** | Next up after current work completes |
| **Later** | Backlog — not yet prioritized |
| **Quick Wins** | Low effort, high value — ship alongside bigger work |
| **On Hold** | Blocked or paused |

## Dangerous Operations — DO NOT USE

**NEVER use `updateProjectV2Field` to modify single-select field options.** This GraphQL mutation replaces option IDs, which silently disconnects every board item from its status — effectively wiping the entire board. This has happened before and required manual recovery.

If the board needs a new status column or option changes, tell the user to do it manually in the GitHub UI.

Safe operations are limited to:
- `gh project item-edit` — move items between existing columns
- `gh project item-delete` — remove items from the board
- `gh project item-add` — add items to the board

## Key Principles

- **Never close issues without approval.** Present, don't act.
- **Evidence over assumptions.** Link to the merged PR or commit that completed the work.
- **Board is source of truth for priority.** If an issue isn't on the board, it's not prioritized.
- **Stale != irrelevant.** Flag staleness, but let the user decide disposition.
- **Never mutate field definitions.** Only move items between existing columns.
