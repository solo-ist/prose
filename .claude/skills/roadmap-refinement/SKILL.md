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

No arguments. Operates on `solo-ist/prose` and the Prose Roadmap project.

## Workflow

### 1. Gather State

Fetch all data in parallel:

```
mcp__github__list_issues (owner: "solo-ist", repo: "prose", state: "OPEN")
mcp__github__list_pull_requests (owner: "solo-ist", repo: "prose", state: "all")
gh project item-list 5 --owner solo-ist --format json
```

**Important:** `gh project item-list` returns ALL items regardless of issue state — the GitHub Projects UI `is:open` filter is view-only and not applied by the API. After fetching, build an open issues set from the issues list and use it to distinguish open vs closed board items throughout the analysis.

### 2. Cross-Reference: Done but Open

For each open issue, check if it's likely completed:

- **Linked merged PRs**: Issue referenced in a merged PR's body or commit messages
- **Closed branches**: An `issue-<number>-*` branch exists but the issue is open
- **Stale "In Progress"**: On the board as in-progress but no activity in 30+ days

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

Wait for the user to review the report. Then:

1. Close approved issues with the suggested notes
2. Add missing items to the project board
3. Fix status assignments
4. Optionally create follow-up issues for items that need decomposition

## Key Principles

- **Never close issues without approval.** Present, don't act.
- **Evidence over assumptions.** Link to the merged PR or commit that completed the work.
- **Board is source of truth for priority.** If an issue isn't on the board, it's not prioritized.
- **Stale != irrelevant.** Flag staleness, but let the user decide disposition.
