# PR 6 (#1150): source mode per tab, a CodeMirror state per session, one undo step across exit

Design of record: `docs/architecture/editor-state.md` §4.9, §4.10, §12 cases 3 and 4, decision 10. Issue:
https://github.com/solo-ist/prose/issues/1150 (part of #1094 Wave 3b; subsumes #1132; the switch-path half of #885).
Branch `issue-1150-source-mode`, stacked on PR 5 (#1175); renderer-only; one PR, merge commit, green CI + claude
review; QA §5 written into `docs/qa/v1.9.0-editor-state.md` for the operator's one-pass review. Estimate: two days.

## Context

PR 1 made the session the owner of the document and left source mode as it was: one global `editorStore.sourceMode`
flag, a module-level `SourceSurface` singleton in `session.ts` (`{ tabId, getContent, entryText }`), a `SourceEditor`
that builds a fresh CodeMirror state on every mount, and a leaving step that exits source mode before every switch.
The result is #1132 (source mode is not remembered per tab) and the loss, on every switch, of the source caret,
folds and CodeMirror undo history. PR 6 puts the mode on the tab record and the CodeMirror state on the session, so
a tab in source mode stays there across a switch with its caret, and the exit (a whole-document replace, one undo
step, every annotation re-anchored by its plugin) runs for the tab the text belongs to, shown or not.

## What the inventory found (2026-11-03, one read-only pass over `1c0b22b`)

- Naming drift from the PR 1 plan: `attachSourceSurface` shipped as `enterSourceMode(getContent)`; `sourceEntryRef`,
  `sourceDocIdRef`, `sourceWriteRef` and `reloadKeepingAnnotations` are gone (their jobs are `SourceSurface`'s).
  `Editor.tsx` keeps `latestSourceRef`, `sourceContent` state, `sourceEditorRef`, `prevSourceModeRef` and a layout
  effect that edge-detects the global flag (`Editor.tsx:443-460`); the rich editor is unmounted in source mode
  (`EditorContent` detaches the ProseMirror DOM), so the rich scroll container is gone while source is open.
- `SourceEditor` exposes only `getContent`; it creates `EditorState.create({ doc, extensions })` on mount, rebuilds
  the whole view on a theme or font change (dropping caret, folds, history and the keystrokes in its 500 ms
  debounce), syncs external `content` through a prefix/suffix diff with no `addToHistory: false` (the entry text
  probably lands as a CodeMirror undo step), and bakes component closures (`isExternalUpdate`, the debounce) into
  the state's `updateListener`.
- CodeMirror 6 (`state` 6.5.4, `view` 6.39.15): a stored `EditorState` passed to a new `EditorView({ state })`
  keeps selection, folds and history (verified in jsdom); extensions are part of the state, so a reusable state
  wants module-level extensions plus `Compartment`s for theme / font / read-only and a view-level
  `dispatchTransactions` for the listener; `scrollSnapshot` covers only CodeMirror's own scroller, and today the
  outer `.overflow-auto` div scrolls.
- Source typing reaches the store and the tab record on the debounce (`updateFromSource`), and five things depend
  on that: the tab-bar dirty dot, the close prompt (`tab.isDirty`, no flush), the saved session draft
  (`tab.content`), the closed-tab snapshot, Copy Markdown, custom-mode autosave. Reading §4.9's "edits reach the
  store only on exit" as "the editor store" would make a source-edited tab look clean and lose its edits on close
  or relaunch; it means the ProseMirror state (#1102).
- On the switch path the exit's replace is dispatched while the global flag is still true, so the transaction
  handler's `if (sourceMode) return` skips the markdown and suggestion projections of the exit transaction; the
  toggle path has the opposite order. A per-session guard removes the dependence on order.
- `exitSourceMode` calls `setFrontmatter`, which marks dirty unconditionally, so save-then-exit shows a false dirty.
  `isSourceSurfaceFor` is a singleton, so a background tab in source mode could not refuse a tool write; reads in
  source mode (`handle.serialize()`) return the stale ProseMirror projection, not the source text.
- The hidden TipTap editor still takes most keyboard shortcuts while source mode is open (⌘L, ⌘D, ⌘/, Alt+↑/↓, ⌘U,
  ⌘⇧X, ⌘⇧F, ⌘K, ⌘⇧⌫; only ⌘F is guarded), and the Edit menu's Undo/Redo act on ProseMirror. The StatusBar toggle and
  the View menu action have no preview / reMarkable guard (the Toolbar button has).
- `leaveSession` and `persistSession` record a rich `scrollTop` of 0 for a tab in source mode (the rich DOM is
  detached). `closeOtherTabs` / `closeAllTabs` never exit source mode (only the active tab could be in it).
  `replaceSessionDocument({ keepHistory: false })` re-opens the session and would drop a session-held CodeMirror
  state; `convertTab` reads the stale ProseMirror doc in source mode.
- Specs: `source-mode-authority` toggles through the Toolbar button (`[aria-label="Source mode"]` /
  `"WYSIWYG mode"`) and types into `.cm-line`; its `:193` test (switch straight after typing leaves the other tab
  alone) stays valid under a per-tab mode; `document-sessions` has case 4's annotation half only, no case 3; no
  spec covers `SOURCE_MODE`. The frontmatter shown in source is `yaml.dump` of the store object, not the raw block,
  and `parseMarkdown` trims the body (#1105); byte-exactness covers the body (unchanged here, PR 7's area).

## The design, made concrete for PR 6

**Tab record** (`stores/tabStore.ts`, `lib/persistence.ts`): `tab.mode?: 'rich' | 'source'` (absent = rich), copied by
`snapshotOf`, `reopenLastClosedTab`, `createTab`, `restoreTabs`, and persisted in `TabDraft` (additive, no
`DB_VERSION` bump): a tab restored at launch in source mode reopens in source mode from its `content` (decision 1).

**Session** (`document/session.ts`): `session.source: SourceSession | null`,
`SourceSession = { state: CMEditorState; entryText: string; scrollTop: number }`. The CodeMirror state is built by
the session (`extensions/source/state.ts`, new: the module-level base extensions, `basicSetup`, markdown with the
language data, the first-line fold filter, the frontmatter plugin, `indentWithTab`, line wrapping, the fold-all
helpers, plus three `Compartment`s `appearance`, `readOnly`, `interaction`, initially empty) from the entry text, so
the entry is the initial document and not an undo step. `enterSource(tabId)`: `flushProjections`, the projected
content with the #1102 baseline, `serializeMarkdown(body, frontmatter)` (the tab's or the store's), `session.source =
{ state, entryText: text, scrollTop: 0 }`, `updateTab(mode: 'source')`, the `editorStore.sourceMode` mirror set
when active (the field stays until PR 7), `notifyActiveSession`. `exitSource(tabId)` (active or background):
`live = source.state.doc.toString()`; equal to `entryText` → nothing dispatched (#1125); else `parseMarkdown(live)` →
`replaceSessionDocument(tabId, { content: body, body, frontmatter }, { keepHistory: true })` (one undo step,
every plugin re-anchors), the store's content written and its frontmatter only when it changed (no false dirty);
then `session.source = null`, `updateTab(mode: 'rich')`, the mirror cleared when active. `setSourceState(tabId,
state)` records every CodeMirror transaction's state (a reference; no notify); `projectSource(session)` (500 ms
after a change, flushed by `flushProjections`) puts the source text into the tab record (`content`, `isDirty`, the
frontmatter parsed out) and, when active, into the editor store, as `updateFromSource` does today (decision 2).
Per-session guards replace the global ones: the transaction handler skips the markdown and suggestion projections
when `session.source` is set; `isSourceSurfaceFor(tabId)` is `!!getSession(tabId)?.source` (a background tab in
source mode refuses tool writes, decision 3); `projectSessionContent` / `serializeSession` return the source text
when the tab is in source mode, so `save_file`, `read_document.markdown` and `get_outline`'s summary see it
(node targeting waits for the exit; writers are refused anyway). `leaveSession` keeps `session.source` and records
the rich `viewState` only when the tab is in rich mode; `activateSession` sets the mirror from `session.source`,
skips the rich scroll restore in source mode; `closeSession` (active or background), `replaceSessionDocument`
with `keepHistory: false` and `convertTab` exit source mode first (decision 4). `exitSourceModeFor` and
`updateFromSource` go; `enterSourceMode` / `exitSourceMode` become the tab actions.

**Tab actions** (`tabs/actions.ts`): `enterSourceMode(tabId = active)`, `exitSourceMode(tabId = active)`,
`toggleSourceMode()` with the preview / reMarkable guard in one place; the Toolbar button, the StatusBar toggle,
the View menu action and ⌘⇧E call it (decision 5). `arriveTab` opens a lazy tab whose record says `source` into
source mode from its `content`.

**SourceEditor** (`components/editor/SourceEditor.tsx`): props `{ state, onState, scrollTop, onScroll, fontSize,
lineHeight, fontFamily, isDark, readOnly }`; `new EditorView({ state, parent, dispatchTransactions })`: the
dispatcher applies the transactions to the view, hands `view.state` to `onState` after a document change, and
updates the status-bar cursor; the compartments are reconfigured on mount and when a prop changes (no rebuild,
decision 6); it owns the scroll container (the two wrapper divs move in), restoring `scrollTop` on mount and
reporting it on scroll; the fold-all button derives from `foldedRanges(state)`; the `getContent` handle, the
`content` prop, the prefix/suffix sync and the debounce go. The entry text is the state's initial document.

**Editor.tsx**: the source branch renders from `useActiveSource()` (a `useSyncExternalStore` over
`subscribeActiveSession` returning the active session's `SourceSession`, notified on enter and exit only, so
typing re-renders nothing); the layout effect, `prevSourceModeRef`, `latestSourceRef`, `sourceContent`,
`sourceEditorRef` and `handleSourceChange` go; the focus timer and the rich scroll restore skip source mode; the
editor-mutating shortcuts in `handleKeyDown` are inert while the active tab is in source mode (decision 5).
`FindBar`, `SelectionPopover`, `TableControls` keep their guard, now from the tab's mode.

**Seams** (`main.tsx`): `__prose_tools.getSourceState(tabId?)` → `{ mode, text, selection: { anchor, head },
folds: [[from, to]] }` for the active or a named tab.

## Work order (worktree `prose-1146` on the new branch; suite green after each commit)

0. `docs/issues/1150/plan.md` (this file).
1. **State**: `extensions/source/state.ts` (base extensions, compartments, `buildSourceState`, `sourceText`,
   `sourceSelection`, `sourceFolds`), `tab.mode` + `TabDraft.mode` + the copy sites; vitest for the state module
   (a state built from text keeps selection, folds and history across `new EditorView({ state })` in jsdom; the
   compartments reconfigure without a rebuild).
2. **The move**: `session.source`, `enterSource` / `exitSource` / `setSourceState` / `projectSource`, the per-session
   guards, leave / activate / close / replace / convert; the tab actions and every toggle entry point;
   `SourceEditor` state-in / state-out; `Editor.tsx`; `useActiveSource`; the seam; `session.test.ts` (enter builds
   the state from the projected text with the baseline; a typed state lands in the tab record after the flush and
   never in the ProseMirror state; exit unchanged dispatches nothing and does not dirty; exit changed is one
   replace with the annotations and comments re-anchored and one undo; a background tab's exit on close; a write
   refused per tab, `SOURCE_MODE`; a lazy source tab arrives in source mode).
3. **Specs**: case 3 (A in source with its caret on a line, switch to B through the tab bar, return: `.cm-editor`
   shown, text and caret kept; exit without changes: not dirty, file bytes unchanged) and case 4's comment half (a
   comment before entering, an edit elsewhere, exit, undo: the comment mark is on its text); falsified on a build of
   the release head's renderer (A comes back in rich mode; the comment half is new). Tripwire: no renderer file
   reads `editorStore.sourceMode` except `session.ts` (the mirror), `Editor.tsx` and the three toggles (PR 7 deletes
   it). Must stay green: `source-mode-authority` (11), `comment-auto-resolve`, `tab-caret`, `suggestions-persist`,
   `editor` / `web` toggle tests.
4. **Docs**: execution log; design doc §4.9 trued (the shipped signature, the tab-record projection); QA §5.

## Decisions folded in (say so to change any)

1. **`tab.mode` persists across a relaunch**: a tab in source mode reopens in source mode from its content (the
   caret does not survive a relaunch; the rich view state does).
2. **Source typing keeps the tab record current** (content, dirty, frontmatter) on the projection delay, as today,
   for the dirty dot, the close prompt, the session draft, Copy Markdown and custom-mode autosave; the ProseMirror
   state changes only at exit (#1102).
3. **A background tab in source mode refuses tool writes**; reads return the source text as markdown, node
   targeting waits for the exit.
4. **Closing a tab (active or not), a disk reload and a conversion exit source mode first**, writing the source
   text back as one undo step.
5. **One guarded toggle** for the Toolbar, the StatusBar, the View menu and ⌘⇧E (no source mode on a preview or
   reMarkable tab from any of them); editor-mutating shortcuts are inert while the tab is in source mode.
6. **A theme or font change reconfigures CodeMirror in place** (compartments), keeping caret, folds, history and
   unflushed keystrokes.

## Execution log

- **2026-11-03, step 0:** inventory (one pass over `1c0b22b`), plan written; branch `issue-1150-source-mode` from the PR 5 tip (`272a4ce`), to land onto `release/v1.9.0` after #1174 and #1175.
