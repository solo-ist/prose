# #467 — Manual QA Plan

> **Status:** in flight. After the first implementation sojourn (#529 persistent selection, #530 tool-result renderer registry, #527 autocomplete filter) landed, the pass continued through Stages 1–5 with a second sojourn that produced #534 (request_mode_switch tool + UI), #546 (insert anchor positions), #547 (cursor selection-replace), #543 (delete_node + move_cursor), #545 (drafting indicator), and #544 (chunked streaming). All six merged to `release/v1.2-agent-persona`. Resuming at Stage 6 with the expanded tool surface. Two follow-ups (#548 annotation unification, #549 toolMode persistence) are deferred but targeted at the same release for v1.2. This document is the canonical reference for the QA run; a generalized skill will be extracted from this approach once the pass completes.

## Context

All four implementation chunks of the #467 umbrella merged into `release/v1.2-agent-persona`:

- Chunk 1 (#513) — persona seed + StatusBar labels
- Chunk 2 (#521) — Chat Mode read-only tools
- Chunk 3 (#522) — `ToolMode` rename + Editor default + Shift+Tab cycle + dead-code cleanup
- Chunk 4 (#524) — every mutating tool gated to Editor + UX polish (autocomplete, error messages)
- Chunk 5 — no PR, audit confirmed accept-flow plays nicely with #447's caption tooltip

Second-sojourn chunks added during the QA pass (each surfaced as a QA finding then implemented before resuming):

- #534 — `request_mode_switch` tool + persona softening + Switch & Run / Just Switch / Cancel UI
- #546 — `insert` accepts `after_node` / `before_node` anchor positions (fixes cursor-dependent placement)
- #547 — `insert(position=cursor)` restores selection-replace semantics + annotation-range math fix
- #543 — `delete_node` + `move_cursor` tools (closes #540)
- #545 — Drafting indicator while LLM generates tool args (closes #542)
- #544 — Cosmetic chunked streaming for agent `insert` / `edit` (closes #541)

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
- **1.9** (new — #534 UI) Trigger any tool that returns a result (e.g., `/read_document` in Editor Mode). Tool-call card defaults to **collapsed** with a chevron toggle on the right of the header — except `request_mode_switch` cards (triggered by 4.x scenarios), which default to **expanded** because the reason and prompt-to-retry are the substance. For `request_mode_switch`, the Switch & Run / Just Switch / Cancel buttons sit **outside** the collapsible body, always visible. Click Cancel → "Dismissed." text replaces buttons; close+reopen the panel or switch conversations and back → state persists (no re-clickable buttons for past decisions).

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
- **4.3** "Fix the typo in paragraph 2" → agent calls `request_mode_switch(target='editor', prompt_to_retry='Fix the typo in paragraph 2')`. The in-chat card shows Switch & Run / Just Switch / Cancel.
- **4.4** "Add a comment on the second paragraph" → agent calls `request_mode_switch(target='editor', ...)`.
- **4.5** "Write me a paragraph about coffee" → agent calls `request_mode_switch(target='create', ...)`. No doc mutation.
- **4.6** (new — added during implementation sojourn) Select text in the editor. Click into chat input. **Selection remains visibly highlighted in the editor** while chat has focus. Type "what did I select?" → agent calls `read_selection`, result body matches the highlighted text.
- **4.7** (new — #545) Drafting indicator. Send a request that the agent will respond to with a tool call whose argument body is long (e.g., the 4.3 typo-fix prompt — the agent will compose a `prompt_to_retry` mid-stream). A small "Drafting…" chip appears between the user message and the eventual tool-call result, then disappears once the tool call lands. On a forced stream error (toggle airplane mode mid-stream), no orphan "Drafting…" chip remains in the conversation.
- **4.8** (new — #534 Switch & Run continuation) On the 4.3 result, click **Switch & Run**. Mode flips to Editor, the prompt auto-sends, and the agent goes directly to `read_document` + `suggest_edit` for the typo — it does **not** re-emit `request_mode_switch` on the continuation. (This was a fixed double-fire bug, regression-checking the modeJustSwitched propagation through the tool loop.)

### Stage 5 — Editor Mode behavior

- **5.1** "Fix typos in paragraph 2" → agent uses `suggest_edit`. Diff overlay appears.
- **5.2** Click the overlay. Popover shows the model's explanation under "Explanation:".
- **5.3** Accept the diff. Annotation appears.
- **5.4** Hover the annotation. Tooltip shows model id + timestamp + explanation as a third line.
- **5.5** "The second paragraph has a competing thesis with the first" → agent uses `add_comment` (margin note), **not `suggest_edit`** (no replacement prose).
- **5.6** "Write me a paragraph about coffee" → agent declines (no-authorship posture) and offers to edit a user-supplied draft.
- **5.7** "What comments are in this document?" → agent calls `list_comments`, lists them.
- **5.8** "Resolve the comment about the thesis" → agent calls `resolve_comment`.
- **5.9** (new — #534 mid-conversation escalation) Right after 5.6's pushback, reply "yes write it" (or equivalent confirmation). Agent now calls `request_mode_switch(target='create', prompt_to_retry='Write a paragraph about coffee')`. The Switch & Run / Just Switch / Cancel buttons appear. The Editor-Mode posture held the line on first ask and only escalated on confirmation — that's the prompt-design contract working.

### Stage 6 — Create Mode behavior

Setup: in Create mode, on a doc with at least an H1 title and a couple of H2 sections with prose (the lighthouse-keeper test doc used in the session is a known-good fixture).

- **6.1** "Write me a paragraph about coffee" → agent drafts via `edit` or `insert`. **Verify the new chunked-streaming visual** (#544): the paragraph arrives in word-level chunks over ~400ms, not all at once. With `prefers-reduced-motion: reduce` set at the OS level, chunks collapse to instant apply.
- **6.2** "Fix typos in paragraph 2" → agent still prefers `suggest_edit` (clear right answer, user should review), not `edit` / `insert`.
- **6.3** Judgment-bearing concern (e.g., "the second paragraph has a competing thesis with the first") → agent uses `add_comment`, not `suggest_edit`.
- **6.4** (new — #546) Park cursor in an unrelated section. Send "Add a paragraph about coffee to the Background section." → agent calls `read_document` → `insert(position='after_node', nodeId=<Background heading>)`. Paragraph lands immediately after the heading regardless of cursor location.
- **6.5** (new — #547) Highlight a sentence in the editor. Send "replace this with: '…'" (or "use the insert tool to replace my selection with: '…'" if the agent reaches for suggest_edit instead). Agent uses `insert(position='cursor')` and the highlighted span is **replaced**, not left next to the new prose. Annotation range covers the inserted content (no `to < from` artifacts even when replaced span was larger than insertion).
- **6.6** (new — #543 delete) After 6.4 lands, send "Actually, delete the coffee paragraph you just added." → agent calls `delete_node(nodeId=…)`. Paragraph is removed. Hover the deletion site → tooltip reads "AI Deletion" with model + timestamp.
- **6.7** (new — #543 move + #546 cursor coordination) Send "park the cursor at the end of the Background section, then insert: '…'" → agent calls `move_cursor(nodeId=<Background heading>, position='end')` then `insert(position='cursor', text=…)`. The caret visibly moves to the new location; the insertion lands at the new cursor.
- **6.8** (new — #543 mode gating) Switch to Chat Mode. Type `/delete_node foo` and submit. Error: "Tool 'delete_node' is not available in Chat Mode. Switch to **Create** Mode to use this tool." Switch to Editor Mode and try `/delete_node foo` → same error (delete is Create-only). `/move_cursor foo` in Chat → "Switch to **Editor** Mode" (move_cursor is Editor-and-up).

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
- `src/renderer/lib/tools/executors/editor.ts` — `executeInsert` / `executeEdit` / `executeDeleteNode` / `executeMoveCursor`, `applyInsertion` chunked helper (added during second sojourn)
- `src/renderer/extensions/ai-annotations/plugin.ts` — annotation tooltip labels including `'AI Deletion'` (#543)
- `src/main/ipc.ts` — `llm:stream:tool-call:start` event (#545), `streamingEdits: true` default (#544)
- `src/renderer/components/settings/SettingsDialog.tsx` — "Stream agent edits" toggle (#544)
- `src/shared/tools/schemas/ui.ts` — `request_mode_switch` schema (#534, UI-coordination category)
- `src/renderer/components/chat/toolResultRenderers/RequestModeSwitchResult.tsx` — body + actions split with persisted action state (#534)
- `src/renderer/hooks/useChat.ts` — `modeJustSwitched` propagation through tool-loop continuations (#534 fix)

## Deferred follow-ups targeting this release

Two follow-ups filed in-session ship before merging `release/v1.2-agent-persona` → `main`:

- **#548** — Unify AI-write annotations: `insert` and `edit` should accept an optional `comment` field and produce the same word-level annotation style as `suggest_edit` accepts (with explanation in the tooltip). Closes a UX inconsistency caught during 6.x where insert/edit annotations look different from suggest_edit ones. Cloud-agent friendly.
- **#549** — Persist `toolMode` across reloads + surface unexpected resets. Closes the "agent thinks I'm in wrong mode" failure mode observed during Stage 6 (mode reverted to Editor on refresh without the user noticing the StatusBar change). Open design question in the issue: per-conversation vs global persistence (weak vote for global). Note that when #549 lands, Stage 9.2's "`toolMode` does not persist" assertion flips — update accordingly.

Sequence: finish QA Stages 6–9 against the current release tip → `/accelerate 548 549` → review + merge → re-spot-check Stage 4 (drafting indicator + mode-switch behavior under persisted mode) and Stage 6 (annotation visual unification) → run Stage 10.

## Verification (meta — when is the QA pass done?)

1. All steps in stages 1–8 pass (with fixes applied for any failures).
2. Stage 9 confirms no new regressions in out-of-scope areas.
3. **#548 and #549 merged** to `release/v1.2-agent-persona`; re-spot-checks on Stages 4 and 6 against the new behavior pass.
4. Stage 10 reaches a confident go/no-go.
5. Commit a final "Run log" appendix to this doc capturing the pass/fail table from the conversation, so the next session has a durable record of what was verified vs deferred.
6. Skill extraction begins after Stage 10 says "go."

The umbrella `#467` is fully verified when Stage 10 says "go" and `release/v1.2-agent-persona` merges to `main`.

## Skill extraction (after the pass)

Once Stage 10 ships, extract the QA-loop approach as a reusable skill at `.claude/skills/qa-mode-refactor/SKILL.md`. Parameterize: mode names, default mode, tool-gating expectations, persona heuristics. Both implementation sojourns (first: persistent selection / tool-result renderer; second: request_mode_switch + insert anchor + delete_node/move_cursor + drafting indicator + chunked streaming) are UX-surface specific and **not** part of the skill — they're project-specific work caught during the pass. The generalized loop (per-step interactive queueing, surgical-scope bug-fix protocol, pass/fail table maintenance, deferred-follow-up handling) is what transfers.
