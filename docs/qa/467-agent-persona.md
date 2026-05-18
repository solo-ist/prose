# #467 — Manual QA Plan

> **Status:** in flight. Mid-pass at Step 1.5 when three UX issues surfaced and we took an implementation sojourn (persistent selection, tool-result renderer registry, autocomplete filter). Resume here after those features land. This document is the canonical reference for the QA run; a generalized skill will be extracted from this approach once the pass completes.

## Context

All four implementation chunks of the #467 umbrella merged into `release/v1.2-agent-persona`:

- Chunk 1 (#513) — persona seed + StatusBar labels
- Chunk 2 (#521) — Chat Mode read-only tools
- Chunk 3 (#522) — `ToolMode` rename + Editor default + Shift+Tab cycle + dead-code cleanup
- Chunk 4 (#524) — every mutating tool gated to Editor + UX polish (autocomplete, error messages)
- Chunk 5 — no PR, audit confirmed accept-flow plays nicely with #447's caption tooltip

What's left is end-to-end manual verification against the umbrella's acceptance criteria (#467, #468) before merging the release branch to `main`. There are no automated tests (no vitest setup), so this pass is the gate.

The pass runs as a tight interactive loop: Claude queues one step at a time, the user runs it and reports back, bugs found get fixed in-session and re-verified before moving on.

## Protocol

### Step delivery format

Each step Claude queues includes:

- **Step N — short name** (#chunk it verifies)
- **Setup**: required state (current mode, document content, fresh launch yes/no)
- **Action**: exact action(s) for the user to perform — one sentence each, no ambiguity
- **Expected**: what should happen
- **Watch for**: common failure modes
- **Report back**: how to capture the result (pass / fail + observation)

### Granularity — adaptive

Start atomic (one action per step) for the first ~10 steps until calibrated. Once a tight cluster of related checks is all passing, batch them into mini-steps (e.g., "all 3 StatusBar visual checks in one report"). Never batch across stage boundaries.

### Bug-handling — fix in-session, re-verify

When a step fails and it's a real bug (not a misunderstood expectation):

1. Propose a fix with surgical scope (one file usually, sometimes two).
2. Cut a branch off `release/v1.2-agent-persona` named `qa-467-fix-<short-description>`.
3. Apply the fix, commit, push.
4. Wait for CI to green and a fresh `claude[bot]` review verdict of `clean`.
5. Squash-merge into `release/v1.2-agent-persona`.
6. User pulls + restarts the dev server.
7. Re-run the failing step. Move on only when it passes.

If the failure is a misunderstood expectation (the code is correct, the step description is wrong), update this plan's step queue and continue without a code change.

### Result tracking

Maintain a running pass/fail table in the conversation, updated after each step. Format:

```
| Step | Name | Result | Notes |
|---|---|---|---|
| 1 | Fresh-launch lands in editor | ✅ | |
| 2 | StatusBar labels | ✅ → fix PR #526 → ✅ | Cosmetic focus-ring leak fixed |
| 3 | Shift+Tab cycle | ❌ → fixed in PR #N → ✅ | Editor was skipped from Create state |
```

## Step queue

Stages run roughly cheap → expensive. Within a stage, batch related checks once calibrated.

### Stage 0 — Bootstrap

- **0.1** Pull and check out `release/v1.2-agent-persona`; `npm install` if needed; start `npm run dev` in the background; confirm clean compile (142 modules transformed, no TS errors).

### Stage 1 — Visual / structural (no LLM calls)

- **1.1** Quit and relaunch Prose. StatusBar mode picker reads `editor`.
- **1.2** Hover the picker. Tooltip: "Proposes copy edits and editorial notes (default)".
- **1.3** Open the dropdown. Order is `chat → editor → create`, `✓` next to `editor`.
- **1.4** Hover each option in the dropdown. Tooltips match the per-mode copy.
- **1.5** Switch to `chat`. Type `/` in chat input. Autocomplete excludes `/suggest_edit`, `/add_comment`, `/resolve_comment`, `/accept_diff`, `/reject_diff`, `/edit`, `/insert`, and (after the implementation sojourn's autocomplete fix) `/quick-review`, `/review-diff`.
- **1.6** Switch to `editor`. Type `/`. Autocomplete includes `/suggest_edit`, `/add_comment`, `/resolve_comment`, `/quick-review`, `/review-diff`. Excludes `/edit`, `/insert`.
- **1.7** Switch to `create`. Type `/`. Autocomplete includes everything (including `/edit`, `/insert`).
- **1.8** (new — added during implementation sojourn) Type `/list_files`, submit. Result renders in chat as a file tree with the same visual style as the file explorer side panel. Clicking a file opens it. Clicking a folder toggles expand/collapse.

### Stage 2 — Keyboard cycle (no LLM)

- **2.1** Start in `editor` (fresh launch state). Shift+Tab → `create`.
- **2.2** Shift+Tab again → `chat`.
- **2.3** Shift+Tab again → `editor`.
- **2.4** Confirm Editor is reachable from any starting state via Shift+Tab loops.

### Stage 3 — Mode-restriction error messages

- **3.1** In `chat`, type `/suggest_edit foo` and submit. Error: "Tool 'suggest_edit' is not available in Chat Mode. Switch to **Editor** Mode to use this tool."
- **3.2** In `chat`, type `/edit foo` and submit. Error: "...Switch to **Create** Mode...".
- **3.3** In `editor`, type `/edit foo`. Error: "...Switch to **Create** Mode...".
- **3.4** In `editor`, type `/insert foo`. Error: Switch to **Create** Mode.

### Stage 4 — Chat Mode behavior

Setup: open a doc with some content.

- **4.1** "What's in my document?" → agent calls `read_document`, replies with summary.
- **4.2** "Give me an outline" → agent calls `get_outline`.
- **4.3** "Fix the typo in paragraph 2" → agent declines, redirects to Editor Mode.
- **4.4** "Add a comment on the second paragraph" → agent declines, redirects.
- **4.5** "Write me a paragraph about coffee" → agent declines, no doc mutation.
- **4.6** (new — added during implementation sojourn) Select text in the editor. Click into chat input. **Selection remains visibly highlighted in the editor** while chat has focus. Type "what did I select?" → agent calls `read_selection`, result body matches the highlighted text.

### Stage 5 — Editor Mode behavior

- **5.1** "Fix typos in paragraph 2" → agent uses `suggest_edit`. Diff overlay appears.
- **5.2** Click the overlay. Popover shows the model's explanation under "Explanation:".
- **5.3** Accept the diff. Annotation appears.
- **5.4** Hover the annotation. Tooltip shows model id + timestamp + explanation as a third line.
- **5.5** "The second paragraph has a competing thesis with the first" → agent uses `add_comment` (margin note), **not `suggest_edit`** (no replacement prose).
- **5.6** "Write me a paragraph about coffee" → agent declines or asks you to draft it.
- **5.7** "What comments are in this document?" → agent calls `list_comments`, lists them.
- **5.8** "Resolve the comment about the thesis" → agent calls `resolve_comment`.

### Stage 6 — Create Mode behavior

- **6.1** "Write me a paragraph about coffee" → agent drafts via `edit` or `insert`.
- **6.2** "Fix typos in paragraph 2" → agent should still prefer `suggest_edit` for changes to existing content.
- **6.3** Repeat 5.5 — agent still uses `add_comment` for judgment-bearing concerns.

### Stage 7 — Persona heuristics (qualitative)

Run as one 5–10 minute working session on a real doc, then report.

- **7.1** Push once, defer. Dubious claim → one pushback with evidence, then defer if you insist. No dig-in, no collapse.
- **7.2** Reflects words accurately. Articulate something, ask for recap. Should quote accurately, not "improve."
- **7.3** Surfaces crisp lines. Use a particularly good phrase; agent flags it as worth using deliberately.
- **7.4** Structural diagnosis before scaffolding. Draft with competing intentions → agent identifies tension before reorganizing.
- **7.5** No filler openings. Responses don't start with "Sure!" / "Great!" / restating.
- **7.6** Escape hatch. Ask for tool-unrepresentable change. Agent produces handoff prompt via `create_and_open_file`, not inline code.

### Stage 8 — Regression (legacy paths still work)

- **8.1** In `create`, prompt that gets the agent to emit a legacy `<edit src="..." target="...">` XML block. Auto-applies (`agentMode=true`).
- **8.2** Switch to `editor`. Same prompt. Renders as reviewable diff with accept/reject buttons.
- **8.3** `/help` lists slash commands. (Known limitation: list is hardcoded, not mode-aware.)
- **8.4** `/clear` clears conversation.
- **8.5** `/new` / `/new_file` works in all modes (file-write commands intentionally not mode-gated).
- **8.6** MCP path: Claude Desktop can `read_document`, `suggest_edit`, `add_comment` regardless of Prose's current mode.

### Stage 9 — Explicit out-of-scope confirmations

- **9.1** Source mode chat unchanged from pre-#467 (#314 not in scope; not newly broken).
- **9.2** Per-conversation persistence: messages survive relaunch; `toolMode` does not (each launch starts in `editor`).

### Stage 10 — Final go/no-go

- **10.1** Review the pass/fail table. 100% pass + no bugs filed → merge `release/v1.2-agent-persona` → `main`.
- **10.2** Anything fixed in-session → ensure all fix-PRs merged into the release branch first.
- **10.3** Anything deferred → list bugs, decide whether to ship anyway or hold the merge.

## Critical files referenced during testing

- `src/renderer/components/layout/StatusBar.tsx` — mode picker labels
- `src/renderer/stores/chatStore.ts` — default mode, `cycleToolMode`
- `src/renderer/components/editor/Editor.tsx` — Shift+Tab handler
- `src/renderer/components/chat/ChatInput.tsx` — autocomplete filter
- `src/renderer/lib/tools/modes.ts` — `checkToolAccess` error messages
- `src/shared/tools/schemas/document.ts`, `src/shared/tools/schemas/editor.ts` — `requiresMode` declarations
- `src/renderer/extensions/ai-suggestions/extension.ts` — accept flow + explanation plumbing
- `src/renderer/extensions/ai-annotations/plugin.ts` — caption tooltip rendering
- `src/renderer/index.css` — `.ai-annotation-tooltip-explanation`, `.persistent-selection` styles
- `src/renderer/lib/prompts.ts` — BASE_PROMPT + per-mode instructions (persona heuristics)
- `src/renderer/extensions/persistent-selection/` — TipTap extension for blur-time selection visibility (added during sojourn)
- `src/renderer/components/chat/toolResultRenderers/` — per-tool result render registry (added during sojourn)

## Verification (meta — when is the QA pass done?)

1. All steps in stages 1–8 pass (with fixes applied for any failures).
2. Stage 9 confirms no new regressions in out-of-scope areas.
3. Stage 10 reaches a confident go/no-go.
4. Skill extraction begins after Stage 10 says "go."

The umbrella `#467` is fully verified when Stage 10 says "go" and `release/v1.2-agent-persona` merges to `main`.

## Skill extraction (after the pass)

Once Stage 10 ships, extract the QA-loop approach as a reusable skill at `.claude/skills/qa-mode-refactor/SKILL.md`. Parameterize: mode names, default mode, tool-gating expectations, persona heuristics. The implementation-sojourn experience (selection persistence, tool-result renderer) is UX-surface specific and **not** part of the skill — it's project-specific work caught during the pass.
