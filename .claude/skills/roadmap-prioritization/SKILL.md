---
name: roadmap-prioritization
description: Analyze the project board and open issues to recommend what to work on next, with rationale.
---

# Roadmap Prioritization

Read the project board and open issues, then recommend what to tackle next.

## Read `docs/roadmap.md` first — and keep it in sync

`docs/roadmap.md` is the canonical roadmap *narrative*: what we're building, the wave model, the track structure, and the A→B→C merge ladder. The [project board (#5)](https://github.com/orgs/solo-ist/projects/5/views/1) is the live *queue* (column = phase, milestone = wave). Ground every recommendation in the doc's sequencing — board order is the primary signal, but the doc explains *why* that order exists. **If you (with approval) move cards in a way that changes the narrative, reflect it in `docs/roadmap.md` in the same pass** so the two don't drift.

## Usage

```
/roadmap-prioritization
```

No arguments. Operates on `solo-ist/prose` and the Prose Roadmap project (project #5).

## Workflow

### 1. Gather State

Fetch all data in parallel using `gh` CLI:

```bash
gh project item-list 5 --owner solo-ist --format json --limit 500
gh issue list --repo solo-ist/prose --state open --limit 200 --json number,title,labels,updatedAt,createdAt,comments,body,milestone
gh pr list --repo solo-ist/prose --state open --limit 50 --json number,title,state,body,headRefName
```

Also read the current `docs/roadmap.md` for the wave/track/merge-ladder context behind the board's ordering. If your worktree may be behind `main`, read the live version with `git show origin/main:docs/roadmap.md` after `git fetch origin`.

Use `--jq` for data extraction instead of piping to external processors (e.g., `python3`, `jq`). This keeps each command as a single `gh` invocation that matches the Bash allowlist:

```bash
gh project item-list 5 --owner solo-ist --format json --limit 500 --jq '.items[] | "\(.content.number)\t\(.id)\t\(.status)\t\(.content.title)"'
```

Parse project items grouped by status column. Parse open PRs to detect work already in flight.

**Important:** `gh project item-list` returns ALL items regardless of issue state — the GitHub Projects UI `is:open` filter is view-only and not applied by the API. After fetching, cross-reference board items against the open issues list: only include items whose `content.number` appears in the open issues set. Discard closed issues silently — they are not actionable.

### 2. Map the Board

Group **open items only** by status column and present the current state:

| Column | Purpose |
|--------|---------|
| **User Requested** | Feature requests from users — needs triage into another column |
| **Do First** | Highest priority — work on these now |
| **Do Next** | Next up after current work completes |
| **Later** | Backlog — not yet prioritized |
| **Quick Wins** | Low-effort items that can ship alongside bigger work |
| **On Hold** | Blocked or waiting on external factors |

There is no "In Progress" column — detect in-flight work via open PRs and `issue-<number>-*` branches, not a board status.

Flag any column imbalances:
- "Do First" is empty → refill from "Do Next"
- "Do First" is overloaded (5+ items) → suggest narrowing focus
- In-flight work (an item with a linked open PR or `issue-<number>-*` branch) has gone quiet → flag as potentially stale
- "User Requested" has untriaged items → flag for review

### 3. Assess Readiness

For each item in "Do First" and "Do Next", evaluate:

- **Well-defined?** Has a description with clear scope, or needs decomposition
- **Blocked?** Dependencies on other issues, external factors, or missing information
- **In progress?** Has linked open PRs or `issue-<number>-*` branches
- **Labels** — `bug` (higher urgency), `launch-blockers` (critical path), `feature-request`, `security`

### 4. Weigh Factors

Apply these prioritization heuristics in order:

1. **Board order is primary signal** — "Do First" > "Do Next" > "Quick Wins"
2. **Bugs before features** — bugs degrade existing experience
3. **Launch blockers first** — if release is approaching, these gate shipping
4. **Quick wins pair well** — a small fix alongside a bigger feature maintains momentum
5. **Logical sequencing** — does issue A unblock issue B? Do A first. The wave/track model and A→B→C merge ladder in `docs/roadmap.md` define much of this sequencing — follow it.
6. **Avoid context-switching** — prefer issues in the same area of the codebase

### 5. Present Recommendations

Output a structured recommendation:

```markdown
## Prioritization Report

### Board Overview
| Column | Count | Notes |
|--------|-------|-------|
| Do First | 3 | #127 has an open PR (in flight) |
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

If the user approves changes (e.g., moving items between columns, triaging user requests), use **only safe item-level operations**.

**Important:** Use individual parallel Bash calls for batch operations — never `for` loops. Loops are shell constructs that don't match the Bash allowlist and force manual approval on every invocation. Individual calls auto-approve and run concurrently (faster too).

```bash
# Move an item to a new status
gh project item-edit --project-id <PROJECT_ID> --id <ITEM_ID> --field-id <STATUS_FIELD_ID> --single-select-option-id <OPTION_ID>

# Add an issue to the board
gh project item-add 5 --owner solo-ist --url <ISSUE_URL>

# Remove a closed item from the board
gh project item-delete 5 --owner solo-ist --id <ITEM_ID>
```

Never move items without explicit approval.

**Keep the doc in sync:** If approved board moves change the roadmap narrative (re-sequencing a wave, promoting a track, retiring a shipped epic), edit `docs/roadmap.md` to match in the same change. That's a normal file edit on a branch — not a `gh project` operation.

## Dangerous Operations — DO NOT USE

**NEVER use `updateProjectV2Field` to modify single-select field options.** This GraphQL mutation replaces option IDs, which silently disconnects every board item from its status — effectively wiping the entire board. This has happened before and required manual recovery.

If the board needs a new status column or option changes, tell the user to do it manually in the GitHub UI.

## Key Principles

- **Read-only by default.** Present recommendations, don't move cards without approval.
- **Respect the board.** The user curated these columns — use them as the primary signal.
- **Pragmatic sequencing.** Prefer shipping a bug fix + quick win over starting a multi-day feature.
- **Context-aware.** If there are open PRs or in-progress branches, factor that in.
- **Opinionated but deferential.** Give a clear recommendation, but the user decides.
- **The doc and the board move together.** `docs/roadmap.md` is the narrative behind the board's order; if approved moves change that narrative, update the doc in the same pass.
- **Never mutate field definitions.** Only move items between existing columns.
