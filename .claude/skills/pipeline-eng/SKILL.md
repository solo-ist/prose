---
name: pipeline-eng
description: Reference and checklist for building and maintaining CI/CD workflows, inter-workflow communication, dispatch scripts, and cloud agent infrastructure. Use when modifying any workflow YAML, dispatch script, or sentinel-based communication.
---

# Pipeline Engineering

Institutional knowledge for building and maintaining the Prose CI/CD pipeline. This is not about *running* the pipeline (see `pipeline-scorer`, `pipeline-pe`, `pipeline-orchestrate`) — it's about *modifying it safely*.

## Usage

```
/pipeline-eng              — full reference
/pipeline-eng <file>       — targeted guidance for a specific workflow or script
```

When invoked with a specific file (e.g., `/pipeline-eng pipeline-triage.yml`), focus guidance on that file's triggers, sentinels, tokens, and downstream consumers.

---

## Pipeline Map

The full workflow chain, trigger to output:

| Workflow | Trigger | Reads sentinel | Writes sentinel | Dispatches to |
|----------|---------|---------------|-----------------|---------------|
| `e2e.yml` | `pull_request`, `/test` comment | — | — (artifact: `e2e-results`) | — |
| `web-e2e.yml` | `pull_request` (with `accelerated` label), `/test` comment | — | — | — |
| `ci-gate.yml` | `workflow_run` on "E2E Tests" | `<!-- e2e-fix-attempt:`, `<!-- agent-fix-attempt:`, `<!-- ci-gate-sha:` | Posts `/review <!-- ci-gate-sha: ... -->` comment; `<!-- e2e-fix-escalation -->` | `claude.yml` (via `/review` comment) |
| `claude.yml` (auto-review) | `/review` comment on PR | — | `<!-- review-verdict: clean -->` or `<!-- review-verdict: issues-found -->` | — |
| `review-feedback.yml` (clean-gate) | `issue_comment` with `<!-- review-verdict: clean -->` | `<!-- review-verdict: clean -->`, absence of `<!-- review-feedback-analysis -->` | `<!-- review-feedback-analysis -->` | — |
| `review-feedback.yml` (analyze) | `issue_comment` with `## Code Review` (no verdict trailer) | absence of `<!-- review-feedback-analysis -->`, `<!-- review-verdict: clean -->`, `<!-- review-verdict: issues-found -->` | `<!-- review-feedback-analysis -->`, `<!-- pipeline-bypass-warning -->` | — |
| `pipeline-triage.yml` (security-gate) | `issue_comment` with `<!-- review-verdict: issues-found -->` | `[SECURITY GATE]` in review body | `<!-- orchestrator-verdict: hitl-full -->` (short-circuit) | — |
| `pipeline-triage.yml` (scorer + PE) | `issue_comment` with `<!-- review-verdict: issues-found -->` (security gate NOT detected) | `<!-- review-verdict: issues-found -->`, absence of `<!-- scorer-output:` / `<!-- pe-output:` | `<!-- scorer-output: {...} -->`, `<!-- pe-output: {...} -->` | — |
| `pipeline-triage.yml` (orchestrate) | `needs: [run-scorer, run-pe-analysis]` | `<!-- scorer-output: {...} -->`, `<!-- pe-output: {...} -->` | `<!-- orchestrator-verdict: auto-fix\|auto-fix-verify\|hitl-light\|hitl-full -->` | — |
| `pipeline-fix.yml` | `issue_comment` with `<!-- orchestrator-verdict: auto-fix -->` or `auto-fix-verify` | `<!-- orchestrator-verdict: ... -->`, absence of `<!-- agent-fix-attempt:` AND `<!-- e2e-fix-attempt:` | `<!-- agent-fix-attempt: 1 -->`, `<!-- agent-fix-escalation -->` | — |
| `dispatch.yml` | `/triage`, `/fix`, `/pipeline` comment | — | — | `pipeline-triage.yml`, `pipeline-fix.yml`, or posts `/review` |
| `notify.yml` | PR labeled `needs-review` or `complex` | — | — | Slack webhook |

**Sync hazard:** `run-pe-analysis.mjs` and `claude.yml` auto-review both hardcode the same privilege-boundary path list (`src/main/**`, `src/preload/**`, `electron-builder.*`, `electron.vite.config.*`). If you update one, update the other. `validate-pipeline.sh` invariant #19 enforces this.

**Dual `/test` trigger:** Posting `/test` on a PR fires BOTH `e2e.yml` (Electron Playwright) and `web-e2e.yml` (browser Playwright) in parallel. This is intentional — it runs the full test matrix. For `pull_request` events, only `e2e.yml` runs automatically; `web-e2e.yml` only runs on `accelerated`-labeled PRs.

**Unified circuit breaker:** Both `ci-gate.yml` and `pipeline-fix.yml` count both `<!-- e2e-fix-attempt:` and `<!-- agent-fix-attempt:` sentinels in their fix-attempt guards. `validate-pipeline.sh` invariant #18 enforces this.

---

## Pre-Flight Checklist

Before modifying **any** workflow file or dispatch script:

- [ ] **Token choice** — Which token does each `gh` call / API call use? Does it need to cross a workflow boundary? (See Tokens section)
- [ ] **Trigger model** — Will this workflow fire on the correct branch? Can it be tested on a feature branch? (See Triggers section)
- [ ] **Loop risk** — Does the comment this workflow posts contain text that could re-trigger itself or an upstream workflow?
- [ ] **Sentinel consumer** — Who reads the sentinel this workflow writes? Will your change break their regex?
- [ ] **Permissions** — Does the `permissions:` block grant exactly what's needed, nothing more?
- [ ] **Parser correctness** — If parsing JSON from a sentinel, is the regex using the `'s'` (dotAll) flag?
- [ ] **Circuit breaker** — Is there a guard preventing infinite re-execution (attempt counter, sentinel-absence check)?

---

## Tokens & Identity

| Token | Identity when posting | Can trigger other workflows? | Use case |
|-------|----------------------|------------------------------|----------|
| `github.token` | `github-actions[bot]` | Yes for `issue_comment` triggers | Default for most in-workflow API calls |
| `secrets.PROJECT_TOKEN` | The PAT owner (human) | Yes | Cross-workflow dispatch, label ops in `orchestrate`, `ci-gate` `/review` posting |
| `secrets.ANTHROPIC_API_KEY` | N/A (API auth) | N/A | Claude API calls in scorer, PE, auto-fix, auto-review |

**Rules:**
- `github.token` cannot trigger `workflow_dispatch` in another workflow — use `secrets.PROJECT_TOKEN` or `gh workflow run` with a PAT
- `id-token: write` is for OIDC federation only (used by `claude-code-action`) — do not add it unless the job uses OIDC
- `actions: write` permission is required for `gh workflow run` dispatch calls
- When a job posts a comment that triggers another workflow, the token identity determines the `actor` filter — `github-actions[bot]` vs `claude[bot]` vs a human username. Mismatched identity breaks `if:` conditions downstream.

---

## Trigger Model

| Trigger | Runs from branch | Testable on feature branch? | Notes |
|---------|------------------|-----------------------------|-------|
| `pull_request` | PR head (merge ref) | Yes | Standard |
| `issue_comment` | Default branch (`main`) | **No** — always runs `main`'s version | Must merge workflow changes before testing |
| `workflow_run` | Default branch | **No** — same as `issue_comment` | `ci-gate.yml` always runs from `main` |
| `workflow_dispatch` | Specified branch | **Yes** — can target any branch | Escape hatch for testing `issue_comment` workflows |

**Testing strategy:** Every `issue_comment`-triggered workflow should also accept `workflow_dispatch` with a `pr_number` input. This lets you test workflow changes on a feature branch via `gh workflow run <workflow> --ref <branch> -f pr_number=<N>`. All current pipeline workflows follow this pattern.

---

## Sentinel & Loop Guards

### Three failure modes

**1. Reading the trigger comment instead of the response**
A workflow triggers on `issue_comment` containing sentinel A, then reads comments looking for sentinel B. If the search isn't scoped, it may match the *triggering* comment itself instead of a downstream response. Always filter by `author` and/or `createdAt > trigger time`.

**2. `.match()` returning the first instead of the last sentinel**
Multiple bot comments may contain the same sentinel prefix (e.g., after a re-run). `String.match()` returns the *first* match. When you need the latest, iterate comments in reverse chronological order, or use `matchAll` and take the last result.

**3. dotAll flag mismatch with embedded JSON**
Sentinel JSON may span multiple lines if pretty-printed or if the comment body contains newlines before the sentinel. The `run-orchestrator.mjs` parser uses the `'s'` (dotAll) flag on its regex for this reason:
```js
const regex = new RegExp(`<!-- ${prefix}: (\\{.*?\\}) -->`, 's')
```
**Always use the `'s'` flag** when parsing sentinel JSON from comment bodies.

### Existing guard patterns

**Absence-based loop prevention** (preferred):
```yaml
# pipeline-triage.yml — don't re-run scorer if output already exists
if: >-
  contains(github.event.comment.body, '<!-- review-verdict: issues-found -->')
  && !contains(github.event.comment.body, '<!-- scorer-output:')
```

**Attempt counter** (for fix workflows):
```yaml
# pipeline-fix.yml — check if fix already attempted
# Shell step counts <!-- agent-fix-attempt: occurrences across all comments
```

**Sentinel-in-own-output** (always prepend a unique loop-prevention sentinel):
- `run-scorer.mjs` prepends `<!-- scorer-output-comment -->` to its output
- `run-pe-analysis.mjs` prepends `<!-- pe-output-comment -->`
- `analyze-review-feedback.mjs` prepends `<!-- review-feedback-analysis -->`

### `contains()` through backticks

In GitHub Actions `if:` expressions, sentinel strings inside `contains()` must be wrapped in single quotes. If the sentinel itself contains single quotes, you'll need to use a different guard strategy (e.g., shell step with `grep`).

---

## Robustness

### API error handling
The current scripts (`run-scorer.mjs`, `run-pe-analysis.mjs`, `analyze-review-feedback.mjs`) make a single `fetch()` call with no retry. They exit with code 1 on non-OK responses. If you add retry logic:
- Handle HTTP 429 (rate limit) and 529 (overloaded) with exponential backoff
- Wrap the entire operation in a `totalTimeout` to prevent zombie jobs
- Use `AbortSignal.timeout()` for per-request deadlines

### Model ID management
Model IDs are hardcoded in each script:
- `run-scorer.mjs`: `claude-sonnet-4-6`
- `run-pe-analysis.mjs`: `claude-opus-4-6`
- `analyze-review-feedback.mjs`: `claude-sonnet-4-6`

When Anthropic releases new model versions, update all three files. Consider using an environment variable override (e.g., `process.env.SCORER_MODEL || 'claude-sonnet-4-6'`) to allow CI-level model pinning without code changes.

The `validate-pipeline.sh` script checks for stale model IDs — update its patterns when adding new models.

---

## Agent Dispatch

When dispatching cloud agents (via `/accelerate` or manual `gh workflow run`):

### File overlap
Before dispatching multiple agents in parallel, check for file overlap. Two agents editing the same file will create merge conflicts. Use integration branches or sequential dispatch for overlapping scopes.

### The "implementer never merges" rule
The agent session that implements changes should NOT merge the PR. A separate review step (human or automated) must validate before merge. This is enforced by the pipeline structure: auto-fix agents push commits, then the pipeline re-runs review.

### Pre-flight for dispatch
1. Confirm the target workflow accepts `workflow_dispatch` with the expected inputs
2. Verify the target branch exists and is up to date
3. Check that no other agent is already working on the same PR (look for recent `<!-- agent-fix-attempt:` sentinels)
4. Use `secrets.PROJECT_TOKEN` (not `github.token`) for cross-workflow dispatch

---

## NEVER Rules

These are absolute prohibitions — violations cause subtle, hard-to-debug pipeline failures:

1. **NEVER add `id-token: write`** unless the job uses OIDC federation (currently only `claude-code-action` jobs). It's not a general-purpose permission.

2. **NEVER use `github.token` to post comments that must trigger another workflow.** `github.token` events are suppressed from triggering further workflows by design. Use `secrets.PROJECT_TOKEN`.

3. **NEVER use `.match()` for sentinel extraction without considering multiple matches.** A PR with re-runs will have multiple comments containing the same sentinel. Either iterate in reverse or use the `'s'`-flagged regex on the *last* matching comment.

4. **NEVER edit privilege-boundary paths in only one location.** The list appears in both `claude.yml` (auto-review prompt) and `run-pe-analysis.mjs`. Update both or neither.

5. **NEVER dispatch overlapping agents without an integration branch strategy.** Two agents editing `src/main/ipc.ts` simultaneously will produce irreconcilable conflicts.

6. **NEVER trust workflow run status as proof a PR was created.** Cloud agents complete "successfully" even when they fail to create branches or PRs. Always verify with `gh pr list --head <branch>`.

---

## Review Checklist

After modifying any workflow or script, verify:

- [ ] **Token audit** — Every `gh` / `curl` / `fetch` call uses the correct token. No accidental `github.token` where `PROJECT_TOKEN` is needed (or vice versa).
- [ ] **`if:` condition targeting** — Conditions match the correct comment author (`github-actions[bot]`, `claude[bot]`, or human) and sentinel.
- [ ] **Sentinel parsing** — All regex patterns use the `'s'` (dotAll) flag when parsing JSON from comment bodies. Test with multi-line input.
- [ ] **`workflow_dispatch` fallback** — Every `issue_comment`-triggered workflow also accepts `workflow_dispatch` with `pr_number` for testability.
- [ ] **Path list sync** — If privilege-boundary paths changed, both `claude.yml` and `run-pe-analysis.mjs` are updated.
- [ ] **Attempt guards** — Fix workflows have attempt counters and escalation paths. A failing agent cannot retry infinitely.
- [ ] **Permissions minimized** — The `permissions:` block grants only what the job needs. No `write-all` or leftover permissions from copy-paste.
