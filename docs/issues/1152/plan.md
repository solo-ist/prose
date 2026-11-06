# PR 8 (#1152): seams and tripwires re-pointed, `CLAUDE.md` and the design doc trued up, dead code removed

Design of record: `docs/architecture/editor-state.md` §3.3 (the four rules), §8 (deleted), §10 (risks), §12
(acceptance, seams, tripwires), §13. Issue: https://github.com/solo-ist/prose/issues/1152 (part of #822). Branch
`issue-1152-seams-sweep` from `release/v1.9.0` = `b9391cb` (PR 7 merged); renderer-only plus docs and specs; one
PR onto `release/v1.9.0`, merge commit, green CI and the claude review; per the operator's 2026-11-03 direction
the QA pass is written into `docs/qa/v1.9.0-editor-state.md` §7 for one pass on their return.

## Context

PRs 1–7 moved every piece of editor state onto a per-tab session or its plugin state and left the editor store as
a mirror. What remains is what each PR deferred to the end: two test seams that return a constant because the
mechanism they gated is gone, specs that still poll them, dead exports and one closure the design listed, the
repo guidance (`CLAUDE.md`, `AGENTS.md`, `docs/patterns.md`) that still describes the one-editor model and its
"annotation persistence invariant", and the design document's own future tense.

## What the inventory found (2026-11-03, one read-only pass over `67e4d5e`)

- **Seams.** Already re-pointed in PRs 2–3: `getAnnotations`, `getAnnotationDocId`, `getCommentStore`,
  `getCommentDocId`. Still to do: `isAnnotationMappingPaused` (`() => false`, polled by `activity-panel` and
  `ai-edit-lifecycle` before an accept) and `getCommentStoreNeedsRestore` (`() => false`, polled by
  `source-mode-authority`'s `openFresh` and `comment-auto-resolve` after `open_file` / `add_comment`): nothing waits
  for anything any more (a record is added inside the transaction that creates it; `open_file` / `select_tab` return
  after activation; `setComment` adds the thread and the mark in one transaction). `getDocumentIsDirty` and
  `__prose_share.sync()` without an id read the editor store mirror. `closeTab` and `loadConversationsFromDB` have
  no caller. `__prose_renameTab` is installed by a Toolbar effect, so it exists only while the toolbar is mounted.
- **Tripwires.** All seven in `document-sessions` hold; `web.share-viewer`'s normaliser tripwire holds (three
  occurrences, two required) but still speaks of `restoreComments`. No plan deferred a tripwire to PR 8. Candidates
  the rules imply: no `commands.setContent(` in the renderer; `EditorState` imported as a value from
  `@tiptap/pm/state` only in `session.ts`; `persistRecords` / `deleteDocumentRecords` called only from `session.ts`
  and `tabs/actions.ts`; no `useEditorStore.setState({ document`; node-ids without an `initialized` closure.
- **Design §8.** Everything listed is gone except the node-ids `initialized` closure (shared across every state
  that uses the plugin instance: a cross-tab variable, §10) and the `activeTooltip` DOM handle in the annotations
  plugin (a module-level DOM reference; the record is read from plugin state, so it stays, said so in §8). §6's
  search-highlight storage is #1106's. `BUILD_META` has a reader (`comments/plugin.ts` forces reconcile mode on
  it) so it stays, with its stale comment fixed; the `ACTIVATED_META` read beside it is redundant but harmless.
- **Dead code.** `useTabs().getActiveTab`, `lib/markdown.ts`'s `hasFrontmatter`, the `restoreAISuggestions`
  command and the `AISuggestionMark` type, a handful of barrel re-exports with no outside user (left; harmless).
- **A bug.** `editorStore.lastSelection` is global and not cleared on a document change, and `read_selection` falls
  back to it when the live selection is empty: select text in A, switch to B, `read_selection` on B returns A's
  text and positions. Cleared on a `documentId` change in `setDocument`.
- **Review note from PR 7.** `setTabFrontmatter` on a lazy tab wrote the record twice.
- **`typecheck:e2e`** baseline 8: none involves a seam; two are fixable here (`Array.from` over a `NodeListOf`;
  `import * as yaml` in `lib/markdown.ts`, the form a spec already uses); four are in `src/main` (gated) and two
  are the renderer's `Window` augmentation not loaded by the e2e tsconfig (`htmlExport.ts`), left.
- **Guidance.** `CLAUDE.md`: "No unit test suite" (there are 11 vitest files, 101 cases, run in CI); the store
  list calls `editorStore` the document's owner and misses three stores; the "Annotation persistence invariant"
  names four mechanisms that no longer exist (`useTabs` switch save, the empty-set safety net, the one-shot restore
  flag, `setState({ pendingComments })`); Tabs says nothing of the session layer and names an emoji field the tab
  does not have; Editor names a `diff-suggestions` extension that does not exist and not `extensions.ts`.
  `AGENTS.md` repeats the unit-suite claim and lacks `npm run test:unit`. `docs/patterns.md`'s extension recipe
  registers in `Editor.tsx` (now `extensions.ts`) and its tool recipe reads the editor instance (executors take
  `ctx.handle`). `docs/architecture/web-platform.md` and `llm-pipeline.md` name the deleted stores and
  `restoreComments`. The design doc: the status line, §3.3 rule 1's `projectSession`, §3.4's proposed API vs the
  shipped one, §4.5's first paragraph, §4.9's tail, §4.14's "until PR 7", §6, §7's future tense, §8, §10's seam
  sentence, §11's sizes, §12's tripwire and seam paragraphs, §13's "PR n" clauses.
- **#822 record** (lines, `9699d4b` → now): `Editor.tsx` 1778 → 1012 (−43%; the design's "well over half" did
  not happen), `useTabs.ts` 1125 → 61 (−95%), `App.tsx` 1031 → 887 (−14%), `useEditor.ts` 442 → 240,
  `editorStore.ts` 319 → 195; new: `session.ts` 1353, `tabs/actions.ts` 1008, `handle.ts` 290, `identity.ts` 75,
  `source/state.ts` 275, `useActiveSession.ts` 45. `src/renderer` since `9699d4b`: 83 files, +9930 / −6580.
- **Left alone, listed for the operator:** the legacy single-document draft (`editorStore`'s `saveDraft`
  subscription, `loadDraft` at launch when the session has no tabs, `hydrateDraft`) is still live and is a
  product call (does anyone still upgrade from a pre-session build?); #1162 (`persistSession` compares against a
  chat-store field that does not exist, so the saved `activeChatId` is always null) is its own issue;
  `useEditor()` subscribes to the whole editor store (every consumer re-renders on each selection update), a
  pre-existing perf item; `tab.cursorPosition` is persisted but never read for display.

## The work

1. **Seams** (`main.tsx`): delete `isAnnotationMappingPaused` and `getCommentStoreNeedsRestore`; `getDocumentIsDirty`
   reads the active tab record; `__prose_share.sync()` without an id resolves the active tab; delete `closeTab` and
   `loadConversationsFromDB`; `__prose_renameTab` moves to `main.tsx` over `actions.renameTab` (the Toolbar effect
   goes); the misplaced eslint comment above `__prose_setEditing` fixed. Specs: the two `waitForMappingResumed`
   helpers and their three calls go; the four `getCommentStoreNeedsRestore` waits go (the mark-count assertions
   that follow them are the real checks and stay); the stale comments beside them say what is true now.
2. **Dead code and the bug**: the node-ids `initialized` closure (the load path's normalise step is a doc-changing
   transaction on a scratch state, so every state has ids before it is shown; a later doc change fills any null);
   `useTabs().getActiveTab`; `hasFrontmatter`; `restoreAISuggestions` and `AISuggestionMark`; `BUILD_META`'s
   comment; `setTabFrontmatter`'s double write; `lastSelection` cleared on a document change (vitest in a new
   `editorStore.test.ts`); the two e2e typecheck fixes.
3. **Tripwires** (`document-sessions` "session tripwires"): the five above; the spec header lists every case.
4. **Guidance**: `CLAUDE.md` Testing line, State Management (the session layer as the owner, `editorStore` as the
   mirror, the three missing stores), the invariant replaced by the four rules as mechanisms, Tabs, Editor, the
   patterns line; `AGENTS.md`; `docs/patterns.md` (three fixes, a new "How to Add a Session Writer or Projection"
   recipe in the existing shape); `web-platform.md`, `llm-pipeline.md` stale lines.
5. **Design doc**: everything in the inventory's list, in past tense with the merge SHAs; §11 gets the actual
   diffstats; §12's tripwire and seam paragraphs match the spec.
6. **QA §7** (short: the seams are test-only; the user-visible checks are `read_selection` across tabs, renaming
   from the tab bar, and a sanity pass that nothing regressed in open / switch / close).

## Decisions folded in

1. `BUILD_META` stays: it has a reader. 2. The legacy draft stays until the operator decides. 3. Barrel re-exports
with no outside user stay (harmless; a later sweep). 4. `getDocumentIsDirty` keeps its name (four specs) and reads
the tab record, the truth. 5. `__prose_renameTab` keeps its name and moves to `main.tsx`.

## Execution log
- **2026-11-03, commits 1–5:** `73697ac` plan · `c9bbb28` the sweep (seams, dead code, the two latent bugs, five
  tripwires, e2e tsc 8 → 6) · `7c3d166` guidance and the design doc · `5141bdf` + the tripwire fix (inline `type`
  imports). Found on the way: removing the node-ids closure made two comment-plugin tests fail, which exposed the
  push-carry bug (an appended transaction reset `pushes` while keeping `pushRevision`; the session reads pushes
  once per revision, so a comment's share push after a paste was dropped); fixed in the plugin and pinned. Unit
  103/103 (12 files); `typecheck:renderer` 66 (baseline 67); `typecheck:e2e` 6 (baseline 8); build clean. Branch
  build, 13 specs (activity-panel, ai-edit-lifecycle, source-mode-authority, comment-auto-resolve,
  comment-threading, document-sessions with the twelve tripwires, node-ids, suggestions-persist, tab-caret,
  file-explorer-qa, share-sync, comment-occurrence, annotation-reanchor): 103 passed, 1 failed = the new
  `EditorState` tripwire reading an inline `type EditorState` as a value (fixed, the tripwire group re-run green).
  No falsification run: the PR adds no behaviour spec; the two bug fixes are pinned by vitest (`editorStore.test`,
  `plugin.test`). QA §7 (four checks) written into the operator's QA doc.
