---
name: roadmap-prioritization
description: Analyze the project board and open issues to recommend what to work on next, with rationale.
---

# Roadmap Prioritization

Read the project board and open issues, then recommend what to tackle next.

## Usage

```
/roadmap-prioritization
```

No arguments. Operates on `solo-ist/prose` and the Prose Roadmap project (project #5).

## Workflow

### 1. Gather State

Fetch in parallel:

```
gh project item-list 5 --owner solo-ist --format json
mcp__github__list_issues (owner: "solo-ist", repo: "prose", state: "OPEN")
mcp__github__list_pull_requests (owner: "solo-ist", repo: "prose", state: "open")
```

Parse project items grouped by status column. Parse open PRs to detect work already in flight.

### 2. Map the Board

Group items by status column and present the current state:

| Column | Purpose |
|--------|---------|
| **Do First** | Current sprint — active priorities |
| **Do Next** | Queued — next in line after Do First clears |
| **Quick Wins** | Low-effort items that can ship alongside bigger work |
| **On Hold** | Blocked or waiting on external factors |
| **Deferred** | Intentionally postponed — revisit later |
| **User Requested** | Feature requests from users — needs triage into another column |

Flag any column imbalances:
- "Do First" is empty → refill from "Do Next"
- "Do First" is overloaded (5+ items) → suggest narrowing focus
- "User Requested" has untriaged items → flag for review

### 3. Assess Readiness

For each item in "Do First" and "Do Next", evaluate:

- **Well-defined?** Has a description with clear scope, or needs decomposition
- **Blocked?** Dependencies on other issues, external factors, or missing information
- **In progress?** Has linked open PRs or `issue-<number>-*` branches
- **Labels** — `bug` (higher urgency), `launch-blocker` (critical path), `enhancement`, `spike`

### 4. Weigh Factors

Apply these prioritization heuristics in order:

1. **Board order is primary signal** — "Do First" > "Do Next" > "Quick Wins"
2. **Bugs before features** — bugs degrade existing experience
3. **Launch blockers first** — if release is approaching, these gate shipping
4. **Quick wins pair well** — a small fix alongside a bigger feature maintains momentum
5. **Logical sequencing** — does issue A unblock issue B? Do A first.
6. **Avoid context-switching** — prefer issues in the same area of the codebase

### 5. Present Recommendations

Output a structured recommendation:

```markdown
## Prioritization Report

### Board Overview
| Column | Count | Notes |
|--------|-------|-------|
| Do First | 3 | All well-defined |
| Do Next | 4 | #55 needs decomposition |
| Quick Wins | 3 | Ready to ship |
| ... | | |

### Recommended Next (pick 1-3)
| # | Title | Rationale | Effort |
|---|-------|-----------|--------|
| 185 | Annotation bug | Bug in Do First, well-defined, quick fix | Small |
| 75 | Clean up diffing | Do First, unblocks streaming work (#132) | Medium |

### Also Consider
| # | Title | Why |
|---|-------|-----|
| 171 | File Explorer selection | Quick Win, pairs well with #172/#173 |

### Not Ready
| # | Title | Blocker |
|---|-------|---------|
| 120 | OAuth verification | Waiting on Google review |

### Board Health
- [action needed] "User Requested" has 2 untriaged items
- [ok] "Do First" has 3 items — good focus
```

### 6. Optional: Update Board

If the user approves changes (e.g., moving items between columns, triaging user requests):

```bash
# Get project item IDs and field IDs
gh project item-list 5 --owner solo-ist --format json
gh project field-list 5 --owner solo-ist --format json

# Move an item to a new status
gh project item-edit --project-id <PROJECT_ID> --id <ITEM_ID> --field-id <STATUS_FIELD_ID> --single-select-option-id <OPTION_ID>
```

Never move items without explicit approval.

## Key Principles

- **Read-only by default.** Present recommendations, don't move cards without approval.
- **Respect the board.** The user curated these columns — use them as the primary signal.
- **Pragmatic sequencing.** Prefer shipping a bug fix + quick win over starting a multi-day feature.
- **Context-aware.** If there are open PRs or in-progress branches, factor that in.
- **Opinionated but deferential.** Give a clear recommendation, but the user decides.
