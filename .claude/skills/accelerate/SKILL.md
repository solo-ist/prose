# Accelerate GitHub Issues

Accelerate issue implementation through autonomous or semi-autonomous agent work. Covers classification, prompt generation, @claude dispatch, and progress tracking.

## Usage

```
/accelerate <issue-numbers>
```

Examples:
- `/accelerate 287` — single issue
- `/accelerate 191 197 127` — batch

## Phase 0: Pre-Flight

For each issue, validate before doing any work:

1. **Fetch issue details** via `gh issue view`
2. **State check**: Skip if closed
3. **Duplicate check**: Any open PRs already referencing this issue? (`gh pr list --search "#{number}"`)
4. **Label check**: Already has `accelerated` label? May be in-progress
5. **Report blockers** before proceeding

## Phase 1: Classification

### Route Decision

| Signal | Route | Rationale |
|--------|-------|-----------|
| Labels include "spike" or "investigation" | Local (Claude Code) | Requires exploration |
| Title starts with "SPIKE:", "RFC:", "Research:" | Local | Explicit exploration |
| Files mentioned > 5, or touches core abstractions | Local | Complex scope |
| Mentions "debug", "trace", "investigate" | Local | Needs interactivity |
| Clear acceptance criteria + bounded scope | Cloud (@claude) | Automatable |
| Bug with repro steps | Cloud (@claude) | Clear fix path |
| UI enhancement with clear scope | Cloud (@claude) | Bounded feature |

### Present Classification

```markdown
## Acceleration Plan

| Issue | Title | Route | Rationale |
|-------|-------|-------|-----------|
| #287 | Move files | Cloud | UI feature, bounded scope |
| #191 | Auto-update | Local | Complex, touches build pipeline |

Confirm to proceed, or specify overrides.
```

Wait for user approval before executing.

## Phase 2: Label Management

Ensure these labels exist (create if missing):

| Label | Color | Description |
|-------|-------|-------------|
| `accelerated` | `#7057ff` | Issue queued for agent acceleration |

### Label Lifecycle

| Event | Label Action | Execution Step |
|-------|-------------|----------------|
| On acceleration start | Add `accelerated` | Phase 3 Cloud step 1 / Local step 1 |
| On @claude comment posted | (label already applied) | Phase 3 Cloud step 2 |
| On PR created | Update to `accelerated:pr-open` | Phase 3 Cloud step 4 |
| On PR merged | Remove all `accelerated*` labels | — |

## Phase 3: Execution

### Cloud Route (@claude on GitHub)

1. **Add `accelerated` label** to the issue
2. Post a `@claude` comment on the issue to trigger the `claude.yml` workflow:

```
@claude Implement this issue.

Read CLAUDE.md for project conventions (commit format, branch naming, PR format).
Create a feature branch, implement the changes, and open a PR.
```

3. The `claude.yml` workflow handles the rest — it picks up `@claude` mentions, creates a branch, implements, and opens a PR.
4. On PR created: update label to `accelerated:pr-open` (if label exists)

### Local Route (Claude Code)

For issues routed locally:

1. **Add `accelerated` label** to the issue
2. Present the issue details and suggest an implementation approach
3. Work through it interactively with the user
4. Follow standard CLAUDE.md workflow (branch, commit, PR)

## Phase 4: Progress Tracking

When asked for status:

```bash
gh issue list -R solo-ist/prose --label "accelerated" --json number,title,state,labels
gh pr list -R solo-ist/prose --search "accelerated" --json number,title,state
```

## Decision Framework

### Proceed via Cloud When:
- Acceptance criteria are explicit and testable
- Changes are additive (low regression risk)
- Scope is ≤5 files
- Issue type is Feature or Bug with clear repro

### Route Locally When:
- Multiple valid architectural approaches exist
- Changes affect core abstractions or shared utilities
- Acceptance criteria are ambiguous
- Would require changes to >10 files
- Requires Circuit Electron QA testing
- Spike or exploration issue
