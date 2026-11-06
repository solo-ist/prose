# PR 7 (#1151): frontmatter on the tab, dirty and autosave from the projection, `isPreviewTab` and `sourceMode` deleted

Design of record: `docs/architecture/editor-state.md` §4.3 (the dirty projection), §4.5 (the saved baseline), §4.8
(promotion re-applies editable), §4.12 (frontmatter), §4.13 (read-only), §7 (the `editorStore`, `tabStore`,
`useAutosave` and `FrontmatterEditor` rows), §12 case 9. Issue: https://github.com/solo-ist/prose/issues/1151
(subsumes #1104 and #1105, incl. the trailing-newline note). Branch `issue-1151-frontmatter-tab`, stacked on PR 6
(#1176, `issue-1150-source-mode`) until it merges; renderer-only; one PR onto `release/v1.9.0`, merge commit, green
CI and the claude review; per the operator's 2026-11-03 direction the QA pass is written into
`docs/qa/v1.9.0-editor-state.md` §6 for one pass on their return.

## Context

After PR 6 every tab owns its ProseMirror state, its records and its source mode, but three things still live in
the one `editorStore`: the frontmatter object (the tab record only gets a copy through a mirror that drops most
updates), the dirty flag (three notions, none of them "differs from the last save"), and the two flags
`isPreviewTab` / `sourceMode` that mirror per-tab truth. Autosave in `auto` mode arms only from TipTap's `update`
event, so a frontmatter-only edit, a source-mode edit and a background edit never save. PR 7 makes the tab record
the truth for content, frontmatter, dirty, preview and read-only, computes dirty in the one projection against a
saved snapshot the session keeps, arms autosave from the tab record, and deletes the two flags.

## What the inventory found (2026-11-03, one read-only pass over `5bb43de`)

- **Frontmatter has no single owner.** The active tab's truth is `editorStore.document.frontmatter`; the tab record
  gets a copy from `syncActiveTabWithDocument` only when `isDirty` or `content` also changed (a second frontmatter
  keystroke is not mirrored; `persistSession` stores the stale object until a leave or a save);
  `session.frontmatterRaw` holds an unparsed raw block for the odd cases (invalid YAML, `---\n---`, `new_file`
  content with a block) and the projection prepends it; `serializeSession` and `enterSource` strip it again and
  re-dump the object.
- **Three dirty notions.** The store flag is a sticky "the projected string differed from the previous store string,
  or a frontmatter object was set" (`setContent` compares strings, `setFrontmatter` always dirties, `setDocument`
  never does, so **a frontmatter-only edit in source mode never dirties and closing loses it silently**); the tab
  flag mirrors it (background: sticky "projection ≠ cached content"); the session baseline (load bytes) and the disk
  baseline (mtime) feed nothing. Undoing back to the saved text stays dirty.
- **Autosave.** `auto` arms on `editor.on('update')` in three identical copies; `custom` arms on the store's
  `isDirty` and is cancelled by any tab switch; `performSave` serialises the store copy with no `.txt` branch and
  its late `setDirty(false)` targets whichever document is active after the ≥500 ms await (a switch in that window
  marks the new tab clean and leaves the saved one dirty). Four save paths build bytes four ways (⌘S from the store
  copy, autosave `serializeMarkdown`, `save_file` via `serializeSession`, Save As from the store copy).
- **`isPreviewTab` is load-bearing**: the Editor effect keyed on it is the only thing that re-applies editable when a
  preview tab is promoted. `sourceMode` is read in Editor (×9), Toolbar and StatusBar; `useActiveSource` already
  exists.
- **#1105's four defects located:** autosave never fires for a frontmatter-only edit (auto arms on `update` only);
  `setContent` cannot mark dirty (body compare); the identity compare in `Editor.tsx`'s `stableFrontmatter` effect
  (arrays, objects and Dates differ by reference, the child's prop-sync wipes in-progress rows); side effects inside
  `FrontmatterEditor`'s `setFields` updater (StrictMode double-fires `onSave`).
- `parseMarkdown` `.trim()`s the body of any document with frontmatter: the blank line after the fences and the
  trailing newline are lost at load, so an untouched frontmatter document does not save byte for byte
  (`source-mode-authority:130` encodes the trim).
- Dead: `serializeFrontmatter` (imported, never called), `setPath`, `setRemarkableReadOnly`, `useEditor`'s returned
  setters, Toolbar's `isEditing` subscription, two different `hasFrontmatter` functions, the design's
  `hydrateFromDraft` / `resetDocument` / `readCache` references.
- Pre-existing, left alone (noted for the parallel track): `parseMarkdown` drops a scalar or array YAML block
  between fences; tiptap-markdown serialises an edited body without a final newline; `pendingFrontmatter` is cleared
  on any `documentId` change (rename, first save), not only on activation; Toolbar's "Save and close" saves the
  active document (#1164); the share module keys its auto push on the store's dirty flip rather than on a save.

## The design, made concrete

**The tab record is the truth** for `content` (the body, never a raw block), `frontmatter` (always an object; the
store normalises `{}`), `isDirty`, `isPreview`, `readOnly` (new, derived from the path with `isRemarkableOcrPath`
in `addTab` / `reopenLastClosedTab` and whenever `updateTab` changes `path`) and `mode`. `editorStore.document` is
a mirror of the active tab: written by `activateSession` (inside its `flushSync`, as today), by `setTabIdentity`
(identity only) and by one subscription in `session.ts` that copies the active tab's `content`, `frontmatter` and
`isDirty` into the store whenever its record changes (and re-applies editable when `isPreview` / `readOnly`
flipped, which is what the Editor's `isPreviewTab` effect did). `setContent`, `setFrontmatter`, `setDirty`,
`setPath`, `setRemarkableReadOnly`, `isPreviewTab` / `setPreviewTab`, `sourceMode` / `setSourceMode` /
`toggleSourceMode` are deleted from the store. `pendingFrontmatter`, `isRemarkableReadOnly` (path-derived in
`setDocument`, equal to the active tab's `readOnly`), `isEditing`, `isAutosaving`, `lastSelection`,
`annotationsVisible`, `cursorPosition`, `activeChatId` stay.

**Dirty is one definition.** The session records `saved: { body, frontmatter } | null` (`frontmatter` as a stable
key, `JSON.stringify` in insertion order): seeded at `openSession` from the loaded content and the tab's object
when the tab arrives clean, `null` when it arrives dirty (a restored dirty draft, `prose://`, a missing-path
restore: dirty until saved); replaced by `markTabSaved` with the snapshot the save wrote. The markdown projection
and the source projection compute

    tab.isDirty = saved === null || body !== saved.body || key(tab.frontmatter) !== saved.frontmatter

and write `tab.content` and `tab.isDirty` for active and background tabs alike; the store mirror follows. Dirty is
not sticky: an undo back to the saved text is clean, a mark-only transaction stays clean. A frontmatter write
(`setTabFrontmatter(tabId, fm)` in `tabs/actions.ts`: the frontmatter editor, the `edit` tool, the overlay's Accept)
updates the tab record and lands the projection at once, so the dirty flag, the store mirror, the close prompt and
autosave all see it. A lazy tab (no session) keeps its recorded flag; a frontmatter write on one marks it dirty
directly.

**One save path.** `saveSnapshot(tabId)` in `session.ts` lands the projections and returns `{ text, body,
frontmatter }`: in source mode the typed text verbatim and its parse; otherwise the projected body and the tab's
frontmatter, with `text` = the body alone for a plain (`.txt`) identity, else `serializeMarkdown(body,
frontmatter)`. `serializeSession(tabId)` is `saveSnapshot(tabId).text`. ⌘S, Save As, quick save, autosave,
`save_file` and the conflict overwrite all write `snapshot.text` and then `markTabSaved(tabId, path, snapshot)`,
which records `saved` on the session and re-projects (typing during the write keeps the tab dirty). `buildSaveContent`
and `currentDocument` go; the `.txt` rule lives in `saveSnapshot`.

**Autosave arms from the tab record** (`hooks/useAutosave.ts`, one subscription on `useTabStore` and one on the
settings): a pure planner `hooks/autosavePlan.ts` maps `(prevTabs, tabs, mode)` to `{ arm, clear }` per tab id —
`auto`: arm the 1.5 s timer whenever a dirty tab with a path had its `content` or `frontmatter` replaced (the
projection runs 500 ms after the last keystroke, so a save lands about 2 s after typing stops, as before within
the debounce), clear when it is clean; `custom`: arm the interval on the clean→dirty transition, clear on clean;
removed tabs clear. Timers are per tab, so a background edit (a chat turn, PR 4) saves and a switch cancels nothing.
`performSave(tabId)` uses `saveSnapshot`, the disk-newer guard, `markTabSaved(tabId, …)`; the three `handleUpdate`
copies and the editor-instance subscription go.

**Frontmatter UI.** `FrontmatterEditor` is `{ frontmatter, onChange }`, rendered from the active tab
(`useActiveTab(t => t.frontmatter)`, keyed by tab id); its local rows re-initialise from the prop only when the
prop's *value* differs from what the rows serialise to (so the store's echo and an equal-valued new object never
wipe an in-progress row, and an outside write — the `edit` tool, Accept — does land), and `onChange` is called
outside the state updater. `Editor.tsx` loses `stableFrontmatter`, its render-time re-sync and the identity-compare
effect; `showFrontmatter` is the overlay, a non-empty object, or an editable non-empty document. The tab-caret
frame assertions hold because the tab store's activation update and the `flushSync` store write land in one commit.
`FrontmatterDisplay` takes the object only; the raw-block helpers go.

**Read-only and preview.** `applyActiveEditable()` in `session.ts` sets `editable = !tab.isPreview && !tab.readOnly`
on the view; called by `activateSession` and by the mirror when either flag flips (promotion by click, by typing,
by `openFile` of a previewed path, by the dirty rule). `isEditorReadOnly` and `enterSourceMode` read the tab's
flags. Components read `useActiveTab(t => t.isPreview)` and `useActiveSource() !== null`.

**`parseMarkdown`** keeps the body's bytes after the closing fence (no `.trim()`), so an untouched frontmatter
document saves byte for byte through the baseline; `source-mode-authority`'s `.trimEnd()` goes. `newTab` parses a
block out of its `init.content` (the `new_file` tool), so no tab record ever carries one.

## Work order (worktree `prose-1146`, suite green after each)

0. This plan.
1. **The move**: `tabStore` (`readOnly`, `frontmatter` default, `activeTabOf` / `useActiveTab`), `lib/markdown.ts`,
   `session.ts` (`saved`, `saveSnapshot`, `recordSaved`, `markFrontmatterChanged`, `applyActiveEditable`, the mirror,
   the projections computing dirty, `frontmatterRaw` gone, source paths on the tab), `tabs/actions.ts`
   (`setTabFrontmatter`, `markTabSaved` with the snapshot, `newTab` parse, the preview-on-dirty subscription,
   `leaveTab` / `convertTab` / `reloadTabFromDisk` / `syncPreviewMode` trimmed, the store→tab mirror deleted),
   `useEditor.ts` saves over `saveSnapshot`, `useAutosave.ts` + `autosavePlan.ts`, `executors/{file,editor,document}.ts`,
   `App.tsx` conflict overwrite, `editorStore.ts` deletions, `Editor.tsx` / `FrontmatterEditor.tsx` /
   `FrontmatterDisplay.tsx` / `Toolbar.tsx` / `StatusBar.tsx`, `handle.ts`; vitest: `markdown.test.ts`,
   `autosavePlan.test.ts`, `session.test.ts` (+ frontmatter dirty, non-sticky undo, the saved snapshot, a background
   frontmatter write; the four `sourceMode` asserts re-pointed).
2. **Specs**: `document-sessions` case 9 (a frontmatter-only edit dirties the tab and autosaves in auto mode; the
   source-mode half) falsified on a build of the base's renderer; `source-mode-authority` byte expectation without
   the trim; a tripwire that the editor store defines no `sourceMode` / `isPreviewTab` / `setContent` /
   `setFrontmatter` / `setDirty`; `tab-caret`, `source-mode-authority`, `stale-paths`, `file-explorer-qa`,
   `explorer-interactivity`, `document-sessions`, `web.spec` preview promotion all green.
3. **Docs**: this log; design §4.3 / §4.5 / §4.12 / §4.13 / §7 trued; QA §6.

## Decisions folded in (say so at approval to change any)

1. Dirty means "differs from the last save (or the load, when nothing was saved since)" for body and frontmatter
   together; it is not sticky. A dirty draft restored at launch stays dirty until a save.
2. The editor store keeps `document` as a mirror of the active tab (content, frontmatter, dirty, identity) for its
   ~40 readers; nothing computes on it. `isRemarkableReadOnly` stays path-derived there.
3. Autosave timers are per tab: a background edit saves; a tab switch cancels nothing. The `auto` delay is 1.5 s
   after the last projection.
4. `serializeMarkdown` keeps today's shape (no blank line added after the fences; an edited body has no final newline,
   as tiptap-markdown serialises it). Only the parse-side trim is fixed.
5. A frontmatter block in `new_file` content is parsed into the tab's object at creation; a body that happens to start
   with `---` is body text (the parser's scalar/array edge stays as it is).
6. The AI frontmatter overlay stays active-only in `editorStore.pendingFrontmatter`; a background `suggest_edit` of
   frontmatter is still refused with `FRONTMATTER_BACKGROUND`; a background `edit` of frontmatter now lands on the tab.

## Execution log
- **2026-11-03, commits 1–3:** `b84ce2f` the move (tab record the truth; `session.saved` + `writeProjection`;
  `saveSnapshot` / `recordSaved` / `markFrontmatterChanged` / `applyActiveEditable` and the store mirror in
  `session.ts`; `setTabFrontmatter`, `markTabSaved(tabId, path, snapshot)`, `newTab` parse, the preview-on-dirty
  subscription in `tabs/actions.ts`; `useEditor` saves over `saveSnapshot`; `useAutosave` over the pure
  `autosavePlan`; executors, the conflict overwrite, `editorStore` deletions, `tabStore` `readOnly` /
  `activeTabOf` / `useActiveTab`, `parseMarkdown` without the trim; `Editor.tsx` / `FrontmatterEditor` /
  `FrontmatterDisplay` / `Toolbar` / `StatusBar`; vitest `markdown.test` 2, `autosavePlan.test` 4, `session.test`
  +4, `handle.test` re-pointed) · `aa4be37` case 9 (both halves), the store tripwire, `source-mode-authority`
  without `.trimEnd()` · docs. Found while testing: an untouched source exit after text was typed and undone
  dropped the pending projection and left the record dirty with the undone text (fixed: it re-projects). Unit
  101/101; `typecheck:renderer` 65 (baseline 67); `typecheck:e2e` 8; build clean. **Falsified on a build of
  `cb66710`'s renderer:** case 9's rich half fails at the autosave poll (the file never changes), its source half at
  the dirty poll (the tab never goes dirty). Branch build, 13 specs (tab-caret, source-mode-authority, stale-paths,
  file-explorer-qa, explorer-interactivity, document-sessions, tab-switch-flush, suggestions-persist,
  comment-auto-resolve, markdown-create, remarkable-sync, remarkable-path, ai-edit-lifecycle): 74 passed, 0 failed,
  3.7 min. `web.spec`'s preview-promotion case (the Source button enabling on promotion) is not run locally and
  CI's web-e2e is label-gated; the Electron preview specs and the mirror's editable re-apply cover the same path.
  QA §6 (eighteen checks) written into the operator's QA doc.
