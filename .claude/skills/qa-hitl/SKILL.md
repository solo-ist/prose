---
name: qa-hitl
description: Human-in-the-loop QA loop for verifying a large feature or refactor against the locally-running app before merge/release. Use when automated tests (e2e, web-e2e) don't cover the behavioral/UX surface and you need a structured, interactive "you drive / I observe" verification pass with in-session bug fixes. Complements qa-pr (automated, Circuit) and qa-web (Playwright).
---

# QA — Human-in-the-Loop (qa-hitl)

A structured **interactive** verification loop: the user drives the running app, the agent observes the live state, and bugs get fixed and re-verified in-session. Built for large multi-PR umbrellas (a feature set, a refactor, a release branch) where the value lives in behavior and UX that automated suites don't exercise.

This is the *generalized loop*. The worked reference run is `docs/qa/467-agent-persona.md` (the agent mode/persona refactor, shipped in v1.3.0) — read it for a concrete example.

## When to use

- Verifying a **release/integration branch** or a multi-PR umbrella before it merges to `main`.
- The surface is **behavioral/UX** (modes, editor interactions, streaming, annotations, keyboard, persistence) — things e2e doesn't meaningfully cover.
- You want a **human in the loop** making judgment calls (does this *feel* right? is this prose good?) while the agent handles mechanical verification, observation, and fixes.

**When NOT to use:** a single small PR (use `qa-pr`), CI-compatible headless checks (use `qa-web`), or anything where automated assertions already give confidence.

## Philosophy

- **You drive, I observe.** The human performs actions a human would (typing real prose, judging tone, clicking through UI); the agent watches the live DOM/state, confirms outcomes, and tracks results. The agent drives the *deterministic* checks (slash commands, state assertions) itself.
- **Verify the running app, not your assumptions.** Inspect live state before asserting. A quick `Runtime.evaluate` beats guessing about DOM structure or framework internals.
- **Fix in-session, defer the rest.** Real bugs get fixed and re-verified before moving on. Pre-existing issues get filed and deferred — they don't block the pass.

## Setup

1. **Pin the integration branch.** Usually a `release/*` branch or the umbrella branch. `git fetch origin` first (another session may have pushed). Use `git -C <worktree-path> ...` for all git in worktrees — compound `cd && git` chains trip approval prompts.
2. **Testing multiple unmerged PRs together:** cut a throwaway integration branch off the release tip and octopus-merge the PR branches into it (`git merge --no-edit origin/pr-a origin/pr-b`). Run *one* dev server from it. Delete it once the PRs land. This lets you verify the combined state before any merge.
3. **Run the app.** Start the dev server in the background. Confirm a clean compile before announcing readiness. Be **multi-agent aware**: other worktrees/sessions may hold ports (5173 / 9222) — check before starting, use the project's PID-file protocol (not broad `pkill`).
4. **Establish an observation channel:**
   - **Circuit Electron MCP** if available — preferred for driving + screenshots.
   - **CDP fallback** when Circuit isn't loaded (e.g., a worktree session): the dev server exposes a remote-debugging port (9222). `curl -s http://127.0.0.1:9222/json` lists targets and their `webSocketDebuggerUrl`. A tiny dependency-free WebSocket client can send `Runtime.evaluate` to read the DOM, assert state, drive slash commands (set a textarea's value via the native setter + dispatch `input`, then dispatch `keydown` Enter), and trigger events (dispatch a `mouseover` to render a tooltip and read it). This is how the #467 pass ran with no Circuit access.

## Protocol

### Step delivery format
Each queued step:
- **Step N — short name** (what it verifies)
- **Setup**: required state (mode, document content, fresh-launch?)
- **Action**: exact action(s), one sentence each, no ambiguity
- **Expected**: what should happen
- **Watch for**: common failure modes
- **Report**: pass / fail + observation

### Who drives which step
- **Agent drives** (via CDP/Circuit): deterministic checks — slash commands, DOM/class assertions, state reads, code-level confirmations.
- **Human drives**: anything needing LLM calls, real authored content, or aesthetic/qualitative judgment. The agent observes and scores.
Make the split explicit per step so the human only does what genuinely needs them.

### Granularity — adaptive
Start atomic (one action per step) until calibrated (~first 10 steps). Once a cluster passes cleanly, batch related checks into one report. Never batch across stage boundaries.

### Bug-handling — fix in-session, re-verify
When a step fails and it's a real bug (not a misunderstood expectation):
1. Propose a **surgical** fix (usually one file). Flag fragile approaches; prefer the simpler alternative.
2. Cut a branch off the integration branch; apply the fix.
3. **Verify locally first** — let the human confirm via HMR before triggering CI + review on a speculative fix.
4. Open the PR; **wait for green CI *and* a fresh clean `claude[bot]` review** before recommending merge. Never offer a "skip the wait" option.
5. Merge into the integration branch; human pulls/restarts; re-run the failing step.

If the code is correct and the *expectation* was wrong, fix the step queue, not the code.

### Deferred-follow-up handling
- **Pre-existing bugs** surfaced during the pass (not introduced by the work under test): file as separate issues, don't block the pass. Label them, reference the umbrella.
- **Regressions in a just-merged PR** from this pass: fix on a branch referencing the original PR (`Refs #NNN`) — don't open a new tracking issue for QA-loop churn.

### Validate review findings against source
Auto-review (`claude[bot]`) is a strong lead, not gospel. Before acting on a "critical" finding, read the actual code — the #467 pass caught a review that hallucinated a type definition and flagged a non-existent mismatch. Cross-reference, then act.

### Result tracking
Maintain a running pass/fail table in the conversation, updated after each step:
```
| Step | Name | Result | Notes |
|---|---|---|---|
| 1 | Fresh-launch default state | ✅ | |
| 2 | StatusBar labels | ✅ → fix PR #NNN → ✅ | cosmetic focus-ring leak |
| 3 | Keyboard cycle | ❌ → fixed #NNN → ✅ | one state was skipped |
```

## Stage ladder (cheap → expensive)

Order stages so cheap, no-LLM checks fail fast before expensive ones. Adapt the specifics to the feature; the *shape* generalizes:

0. **Bootstrap** — pull integration branch, install, start dev server, confirm clean compile.
1. **Visual / structural** (no LLM) — labels, menus, tooltips, ordering, element presence.
2. **Keyboard / interaction** (no LLM) — shortcuts, cycles, focus behavior.
3. **Error / guard messages** — restricted actions surface the right message.
4. **Core behavior** — the feature's main paths (per-mode behavior, tool execution, streaming).
5. **Qualitative** — a real working session; judgment calls (tone, feel, prose quality). Human-led, ~5–10 min.
6. **Regression** — legacy/pre-existing paths still work; nothing newly broken.
7. **Out-of-scope confirmations** — adjacent areas explicitly *not* in scope are unchanged. Note any assertions that the work under test *flips*.
8. **Go/no-go** — review the table; decide.

## Closeout

- **Go/no-go**: 100% pass + fix-PRs merged into the integration branch + deferred items triaged → GO. List deferred bugs and decide ship-anyway vs hold.
- **Run log**: append a final pass/fail table to the reference doc so the next session has a durable record of verified-vs-deferred.
- **Release**: on GO, the integration branch merges to `main` (use closing keywords for the umbrella + feature issues in the PR body). Cut the release separately (see the `release` skill).

## Parameterize per run

When invoking this loop for a specific umbrella, pin:
- **Feature surface** under test and its PRs / umbrella issue.
- **Integration branch** name.
- **Stage specifics** — the concrete checks for each stage above.
- For **mode/permission refactors**: mode names, default mode, per-mode tool-gating expectations.
- For **agent/persona work**: the persona heuristics to probe in the qualitative stage (e.g., push-once-then-defer, reflect words accurately, surface crisp lines, structural diagnosis before scaffolding, no filler openings, escape-hatch handoff).

## Reference run

`docs/qa/467-agent-persona.md` — the agent mode/persona refactor pass that this skill generalizes. It has the full worked step queue and the final Run log. The implementation-sojourn work captured there (persistent selection, tool-result renderer, etc.) is **project-specific** and not part of this skill — only the loop transfers.
