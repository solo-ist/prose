# #1145 — Editor state 1/8: per-tab document sessions (plan, 2026-11-01)

Design of record: `docs/architecture/editor-state.md` (§3, §4.1–4.8, §4.10, §4.13, §7, §7.1, §8, §12; decisions
1, 4, 5, 6, 9). Issue: https://github.com/solo-ist/prose/issues/1145. This section becomes
`docs/issues/1145/plan.md` in the PR, verbatim. Branch `issue-1145-document-sessions` from `release/v1.9.0`
(`9699d4b`); renderer-only; one PR, merge commit, green CI + claude review, one QA pass on the dev server first.

### Context

Prose has one TipTap editor. A tab switch serialises the leaving document, re-parses the arriving one, and swaps
three global record stores (annotations, comment threads, suggestions) whose only link to a document is the order
of two calls (`setDocumentId` sync, `loadX` async). The §G failure wrote one document's annotations under another
document's IndexedDB key on an ordinary switch. PR 1 replaces the swap with one ProseMirror `EditorState` per open
tab, held in a module-level map and swapped into the single view with `view.updateState`, and routes every tab
lifecycle flow through one implementation. Records stay in today's stores for now, but as mirrors of the active
session, loaded and persisted only by the session layer, which is what closes the §G class before PRs 2, 3 and 5
move them into plugin state.

### What the inventory found (2026-11-01, three read-only passes over `qa/dev` = `9699d4b`)

Corrections to the design doc, folded into this plan:

- The content-sync effect is `Editor.tsx:579–696` (not 630–730). `useTipTapEditor` has no deps and `<Editor>` has
  no key: the editor is created once per app run (recreated only by a dev HMR remount). `setOptions` runs on every
  render but never rebuilds extensions.
- `setLoadingDocument` has 26 call sites (useTabs ×15, executors ×6, Editor, reanchor ×3, store ×2), not eleven.
- `tiptap-markdown`'s parser needs the extension list, the schema and a DOM, not a view: `parser.parse(md)` returns
  HTML, `createDocument(html, schema)` from `@tiptap/core` makes the node; `serializer.serialize(anyDoc)` already
  works for a document that is not in the view. The live editor supplies both.
- `node-ids`' `appendTransaction` runs only inside `applyTransaction` (never on `EditorState.create` or
  `updateState`); any doc-changing transaction fills every null id, so a session's normalise step must be a
  doc-changing transaction on a scratch state.
- `editorStore.readCache` has no callers at all; `executeReadDocument` reads the live editor plus
  `document.content`. It is deleted, not moved.
- Save As / quick save / `save_file` migrate conversations **and** annotations (not annotations only); rename copies
  all four sets in IndexedDB but re-points only the annotation store in memory; the converters migrate nothing.
- `select_tab` saves raw `getComments` (drops replies, resolved, author, share ids: `extension.ts:666-668` names
  this exact bug) and unguarded suggestion sets, confirmed at `tabs.ts:156-157`. `open_file` saves only the
  outgoing conversation and never loads comments, confirmed at `file.ts:115-123`.
- The `web.share-viewer` tripwire needs two `.replace(/ /g, '')` in `extensions/comments/extension.ts`; there are
  three (`:306`, `:307`, `:782`). The matchers stay in that file.
- No vitest, jsdom or fake-indexeddb is installed; no `paths` aliases; all renderer imports are relative. No listed
  module touches `window` or IndexedDB at import time, but `editorStore`/`tabStore`/`chatStore` have module-level
  subscriptions that write IndexedDB after a mutation.

Latent defects on the paths PR 1 rewrites, fixed by the single implementation (each gets a line in the PR body):

- **A** Closing the active tab writes the closed tab's content, cursor, view state, suggestions and merged comments
  into its neighbour (`removeTab` moves `activeTabId` first; `switchToTab`'s `saveCurrentTabState` then reads the
  neighbour as "current"; `useTabs.ts:729-735, 779-785, 827-829`). `saveComments` writes `[]` too, so the
  neighbour's stored threads can be wiped.
- **B** `tab.documentId` drifts from the editor's after Save As, quick save, `save_file`, `useEditor.openFile` /
  `openFileFromPath` and the reMarkable buttons; the next switch saves under the old id.
- **C** `useEditor.openFile`, `openFileFromPath` and `newFile` (Toolbar Open, Cmd+O, EmptyState, explorer New File)
  replace the active tab's document in place without saving it; the native menu's Open opens a tab. After PR 1 all
  Open paths open a tab (or replace an empty untitled one). User-visible: Toolbar/Cmd+O no longer open in place.
- **D** `openFileInTab`, preview, reopen, rename, `open_file` and the converters never record a disk baseline, so
  the focus-time stale check and the save guards are silent until the first save.
- **E** `select_tab`, `open_file`, `new_file` and `useEditor` force `setRemarkableReadOnly(false)` after
  `setDocument` derived it from the path; `select_tab` onto an OCR tab makes it editable.
- **F** `isPreviewTab` follows only four flows; `TabBar` double-click promotes without clearing it or restoring
  the chat panel.
- **I** Explorer rename/move updates `tab.path` and title only (`FileListPanel.tsx:557-586, 673-678`); the
  document identity and the record keys do not follow. It becomes a `setSessionIdentity` call.

Filed as issues, not fixed here (small, separable; board Quick Wins): **G** #1162 `persistSession` reads
`chatState.currentDocumentId`, which is not a store field, so the saved `activeChatId` is always null;
**H** #1163 `TabDraft` has no `isPreview`, so preview tabs restore as permanent; **J** #1164 Toolbar "Save and
close" saves the active document, then force-closes the pending (possibly background) tab, even when the save
was cancelled (trivial once `serializeSession(tabId)` exists).

### The design, made concrete for PR 1

**Modules (new):**

- `src/renderer/document/identity.ts`: `identityKey`, `IdentityState = { documentId, path, plain }`, the
  `Identity` extension with **`priority: 1000`** (TipTap sorts plugins by priority descending and reverses
  equal-priority extensions, so "first in the array" would run last; a plugin's `apply` receives the partially
  built new state, so identity must be applied before the annotation and comment plugins read it;
  `appendTransaction` always sees the full state), metas `IDENTITY_META`, `ACTIVATED_META`, `RELOAD_META`,
  `getIdentity(state)`.
- `src/renderer/document/session.ts`: the map, `attachEditor`, `attachSourceSurface`, `openSession`,
  `activateSession`, `applyToSession`, `replaceSessionDocument`, `mergeThreads`, `setSessionIdentity`,
  `serializeSession`, `closeSession`, `flushProjections`, `persistRecords`, `getActiveSession`,
  `useActiveSession`, `resolveDocumentHandle`. The only file that calls `EditorState.create`,
  `view.updateState`, or imports `saveAnnotations` / `saveComments` / `saveSuggestions` (and the `delete*` trio).
- `src/renderer/document/handle.ts`: the `DocumentHandle` type.
- `src/renderer/tabs/actions.ts`: every lifecycle flow as plain async functions.
- `src/renderer/components/editor/extensions.ts`: `createEditorExtensions({ bulletListMarker, onCommentAdded,
  onCommentBlocked })`, lifted from `Editor.tsx:339-440` so the vitest harness builds the same schema.

**Session object:** `{ tabId, state, records: { annotations, comments, suggestions }, baseline: { body,
serialized }, frontmatterRaw, projection: timer | null }`. `records` is PR 1's home for the three sets; the global
stores mirror the active session's. `baseline` reproduces today's `loadBaselineRef` (`Editor.tsx:533-537`): when
`serialize(doc) === baseline.serialized` the projection emits `baseline.body`, so an untouched document saves
byte-exact (#1102). `frontmatterRaw` reproduces `frontmatterRef` until PR 7 moves frontmatter onto the tab.

**`openSession(tab, { content, viewState? })`** (async only for the three IndexedDB reads, which come first):
1. `parseMarkdown(content)` → frontmatter, body, raw block (today's `lib/markdown.ts`).
2. `html = editor.storage.markdown.parser.parse(body)`; `doc = createDocument(html, schema)`.
3. Normalise on a scratch state: `EditorState.create({ schema, plugins })`, one transaction
   `replaceWith(0, size, doc.content)` carrying `IDENTITY_META` and `addToHistory: false`, applied with
   `applyTransaction` so node ids, the table trailing paragraph and plain-text flattening run once.
4. `EditorState.create({ schema, plugins, doc: normalised.doc, selection })` so history starts empty; the
   selection comes from `tab.viewState` through a doc-based `selectionFromViewState(doc, viewState)` split out
   of `lib/editorViewState.ts` (the editor-based wrappers stay for `persistSession`).
5. One seed transaction with `IDENTITY_META` and `addToHistory: false`: comment marks via `applyCommentMarks(tr,
   state, threads)` and suggestion marks via `applySuggestionMarks(tr, state, suggestions)`, the bodies of today's
   `restoreComments` (`comments/extension.ts:251`) and `restoreAISuggestions` (`ai-suggestions/extension.ts:955`)
   lifted into pure functions the commands keep calling; `applyCommentMarks` returns the anchor-lost ids instead
   of writing the store. Annotation records load as stored (positions only; text re-anchoring of annotations is
   PR 2's `anchorText`, which #1142 removed).
6. `session.records` = the loaded sets with anchor-lost applied; `baseline` from the seeded doc.

**`activateSession(tabId)`**, synchronous: `flushProjections(leaving)` (see source mode below); capture the
container `scrollTop` into the leaving tab's `viewState`; `active = arriving`; `view.updateState(arriving.state)`;
`editor.setEditable(!tab.isPreview && !tab.readOnly, /* emitUpdate */ false)` (the default emits `update`, which
would arm autosave); set the three mirror stores in one `setState` each (`{ documentId, annotations,
createdThisSession }`, `{ documentId, pendingComments, needsRestore: false }`, `{ documentId }`); write
`editorStore.setDocument(mirror)` and `setPreviewTab` **inside `react-dom`'s `flushSync`**, so the arriving
document's frontmatter block is committed before the container `scrollTop` is restored (otherwise the block
mounts a frame later and scroll anchoring moves the position; `electron.tab-caret.spec.ts:127-172` asserts the
exact `scrollTop` on every frame after a return); restore `scrollTop`; dispatch one `ACTIVATED_META`
transaction through the view (TipTap emits `transaction`; `selectionUpdate` is emitted explicitly with
`editor.emit`, because an equal selection does not fire it). `updateState` with a different plugins array
recreates plugin views and node views (plugin views get no `update` call with the previous tab's state) and sets
`view.dom.scrollTop = 0` (the editor element, not the container); that is what today's `Editor.tsx:655-660`
already pays on every new document, so the switch cost is strictly lower than serialise + parse + `setContent`.
The annotation plugin's first `apply` after activation is the `ACTIVATED` transaction, which runs after the
mirror write, so it reads the arriving records under the arriving identity.

**Source mode on a switch (data-loss hole found in review):** today the source edits reach `tab.content` live
through `handleSourceChange`, so leaving a tab in source mode and coming back re-parses them. With the state
as the truth, the leaving session's `EditorState` would be stale and the projection would overwrite
`tab.content` with the pre-edit document. So `flushProjections(leaving)` must, when `sourceMode` is on, read the
live source text through `attachSourceSurface({ getContent })` (registered by `Editor.tsx` while the source
surface is mounted, in the spirit of the old `flushPendingUpdate`), run the exit path on the leaving session
(`replaceSessionDocument(leaving, …, { keepHistory: true })` when the text differs from the entry text, nothing
otherwise) and then `setSourceMode(false)`, all before the next tab is activated. This also stops the last
500 ms of source keystrokes being dropped on a switch, which `electron.source-mode-authority.spec.ts:193-226`
tolerates today.

**Projections** (`projectSession`): registered in `attachEditor` on `editor.on('transaction')`, not in
`Editor.tsx`. On `docChanged` of the active session: the markdown projection (500 ms debounce; immediate on
`RELOAD_META`; `flushProjections` on switch, save, close) computes `content = frontmatterRaw + body` with the
baseline substitution and calls `editorStore.setContent(content)` (today's dirty semantics, unchanged in PR 1),
then `updateTab({ content, frontmatter, isDirty })` (replacing `syncActiveTabWithEditor`). The suggestion
projection is today's `Editor.tsx:872-916` moved: 500 ms, immediate on `AI_SUGGESTION_RESOLVED_META`, an empty
set only after a resolve or on close. The saved-session 1 s debounce stays in `tabStore`.

**Mirror-store rules for PR 1** (the §G closure):

- The stores' id-setting entry points (`loadAnnotations`, `setDocumentId`, `clearAnnotations`, `loadComments`,
  `clearComments`, suggestion `setDocumentId`) are called only from `session.ts`, and only inside
  `activateSession`, where id and records land in one `setState`. There is no moment with the next id and the
  previous records.
- `useAnnotationStore.subscribe` and `useCommentStore.subscribe` in `session.ts` copy `annotations` /
  `pendingComments` into `active.records` on every change. Because activation sets `active` before it writes the
  stores, a subscriber always copies into the session the records belong to. No flag.
- The stores' `saveAnnotations()`, `saveComments(id, list)`, `saveSuggestions(id, list)` and the `delete*`
  variants stay as the API their ~25 call sites use (popovers, review panel, share sync, executors) and delegate to
  `persistRecords(kind, documentId, records)` in `session.ts`: when a session owns that `documentId` it updates
  `session.records` too (so a write for a background document is honoured, as share sync and artifact import need);
  then it writes IndexedDB. Both arguments come from the caller's single synchronous read.
- The annotation plugin's `apply` mutates the store only when `getIdentity(newState).documentId` equals the
  store's; `autoResolveDeletedComments` bails when the identity of `prevState` and `view.state` differ or the
  transaction carries `RELOAD_META` or `ACTIVATED_META`. Identity checks, not timing flags.
- `isLoadingDocument` stays private to `addAnnotation`'s own ordering hack (store `:80-103`) until PR 2 removes the
  microtask deferral; every external `setLoadingDocument` call goes. `addAnnotation`'s branch that re-keys the
  whole store when a record carries another `documentId` (store `:80-85`, a (id, records) mismatch by
  construction) is replaced by a refusal: the record is logged and dropped; every PR 1 caller stamps the active
  identity, and PR 4 routes background records through their own handle. `__prose_tools.isAnnotationMappingPaused`
  and `getCommentStoreNeedsRestore` return false (their specs are updated in PR 8); the seam comment states why
  the readiness polls in `source-mode-authority` and `comment-auto-resolve` stay correct: `open_file` returns
  after `activateSession`, and `RELOAD` applies marks in the same transaction, so there is no "not yet restored"
  state to wait for.
- Share pulls and artifact re-imports into an open document (`shareSync.ts:246`, `artifactImport.ts:70`) today
  call `loadComments` to arm the restore effect. They call `session.mergeThreads(documentId, merged)` instead:
  when a session owns the id it applies `applyCommentMarks` for the new threads in one `addToHistory: false`
  transaction (through `applyToSession`, so a background tab is merged in place), updates `records.comments` and
  persists; otherwise it writes IndexedDB, as the import path already does.
- `useSuggestionStore` shrinks to `{ documentId }`; `pendingSuggestions`, `loadSuggestions`, `clearSuggestions`,
  `snapshotSuggestions` go (restore happens inside `openSession`, before a state is ever shown). PR 5 (#1149)
  keeps only its `RESOLVED` probe.

**`replaceSessionDocument(tabId, { body, frontmatter }, { keepHistory })`:**
- `keepHistory: true` (source-mode exit): parse + normalise as in `openSession`, then one transaction on the live
  state: `replaceWith(0, size, newDoc.content)` with `RELOAD_META` carrying the previous document's text index;
  in the same transaction re-apply comment and suggestion marks from `session.records` with the pure matchers, and
  re-anchor annotation records with `reanchor.ts`'s helpers (`textIndex`, `mapThroughDiff`, `nearestMatch`),
  exported and run on the store. One undo step (decision 10). Replaces `reloadKeepingAnnotations` and the 50 ms
  restore timer at `Editor.tsx:1090-1099`. Afterwards `session.baseline = { body, serialized: serialize(newDoc) }`
  (today's `loadBaselineRef` write at `Editor.tsx:1077-1085`), so a later mark-only transaction still saves the
  source bytes; `saveFile` resets the baseline the same way after a successful write. An unchanged exit dispatches
  nothing and does not call `setActiveFrontmatter` (`setFrontmatter` always sets `isDirty`); the byte-exact and
  untouched-toggle tests in `source-mode-authority` (`:118-131`, `:335-356`) are the gate.
- `keepHistory: false` (disk reload, reMarkable sync): re-run `openSession` under the same tab id from the new
  text and, when the tab is active, `activateSession` again. Records are re-anchored at load by text. For a tab
  without a session (lazy), only `updateTab({ content, frontmatter, isDirty: false })`, as today.
- Fixes the same-document branch (`Editor.tsx:665`) that strips marks for good (design §7.1).

**`setSessionIdentity(tabId, { documentId, path })`:** `IDENTITY_META` transaction through `applyToSession`;
copy the four IndexedDB keys to the new id (`load*` → `persistRecords` / `saveConversations`; old keys stay, as
today); update the tab record (`documentId`, `path`, `title`), the three mirrors, `setCurrentDocumentId`, the
conversations' own `documentId` fields; clear the old path's disk baseline. Callers: rename (tab bar and
explorer), Save As, quick save, `save_file`, the two converters. Each caller records the new baseline after it
has written the file, as today.

**`applyToSession(tabId, build)`:** active → `editor.view.dispatch(build(state))`; inactive →
`state.applyTransaction` + `projectSession`. PR 1 uses the inactive branch for identity transactions only;
doc-changing background transactions arrive with PR 2/4, once records are in plugin state.

**`closeSession(tabId)`:** flush projections; final `persistRecords` for all three sets (the one path where an
empty set is written on purpose); untitled → delete the four keys (as today); drop from the map.

**`DocumentHandle`** (`handle.ts`): `{ tabId, documentId, path, plain, state, schema, isActive, view, commands,
chain(), can(), serialize(), apply(tr) }`. `resolveDocumentHandle({ forWrite })` returns the active session's
handle; `forWrite` refuses source mode (today's `executors/editor.ts:154` rule; `document.ts:26` ignored source
mode, so reads keep working there). In PR 1 every handle is active and backed by the live editor; PR 4 adds
background handles with a `CommandManager` over the session state. Executors use `handle.state`,
`handle.commands`, `handle.chain()`, and `handle.view` only inside `if (handle.isActive)` for scroll, focus and
DOM measurement. `getEditor()` (18 calls across `document.ts` and `editor.ts`) and the direct
`useEditorInstanceStore` reads in `file.ts` / `tabs.ts` go. `read_document` and `get_outline` serialise from
`handle.serialize()`, never from the 500 ms cache.

**`tabs/actions.ts`:** `openFile(path, { preview, access })` (already open → switch; empty untitled active →
replace in place; else new tab), `openInTab(tabId, path)` (preview replace, the reMarkable Edit / View Original
buttons), `newTab(init)`, `switchToTab(tabId)` (lazy `openSession` from `tab.content`, as today's switch reads the
cache), `promotePreview()`, `closeTab(tabId, { force })`, `closeOtherTabs(keep)`, `closeAllTabs()`,
`reopenLastClosedTab()`, `renameTab(tabId, newTitle)`, `convertTab(tabId, 'txt' | 'md')`,
`reloadTabFromDisk(tabId, { content })`, `restoreTabs(drafts, activeTabId)` (launch; eager session for the
active tab only), `hydrateDraft(draft)`, `setActiveFrontmatter(fm)` (today's `handleFrontmatterSave`, until
PR 7), `updateFromSource(body, fm)` (today's `handleSourceChange`: store and tab only, the state untouched while
source mode is open, #1102). Each "leaving" step is `flushProjections` + `saveCurrentConversation`; each
"arriving" step is `openSession` (if lazy) + `activateSession` + chat `loadForDocument` + explorer reveal + recent
file + baseline. The preview chat-panel save/restore moves here. `useTabs` returns these functions under today's
names so `Toolbar`, `TabBar`, `FileListPanel`, `ProjectsPanel`, `ListFilesResult`, `useExplorerActions`, `App`
and `EmptyState` keep compiling; `useEditor.openFile` / `openFileFromPath` / `newFile` call `openFile` / `newTab`;
`App.recoverSessionState` keeps its stale-file logic and calls `restoreTabs`; `diskSync.loadDiskVersionIntoTab`
and `useRemarkableSync.refreshOpenOcrTab` call `reloadTabFromDisk`; `App.convertToTxt` / `convertToMarkdown`
call `convertTab` (the `commands.setContent` at `App.tsx:714` goes with them).

**`Editor.tsx` after PR 1** keeps the editor creation (extensions from `extensions.ts`), `editorProps`,
keyboard handling, popovers, dialogs, the focus pass (reduced to `focus(undefined, { scrollIntoView: false })`
on `document.documentId` change, as today's line 1000, the session having restored selection and scroll), the
`stableFrontmatter` pair (PR 7), and the source-mode layout effect re-pointed: entering serialises from
`serializeSession` and registers `attachSourceSurface`, exiting with changes calls
`replaceSessionDocument(active, …, { keepHistory: true })` then `setActiveFrontmatter`. Deleted from it: the
content-sync effect, the annotation/suggestion/comment load and restore effects, the suggestion persist effect,
the HMR snapshot, `onUpdate`'s store write and the document-changed discard, `flushPendingUpdate`, the refs
`lastDocumentIdRef`, `pendingViewRef`, `loadBaselineRef`, `savedSuggestionsRef`, `frontmatterRef`,
`debounceRef`, `pendingWriteRef`, `isUpdatingFromStore`, `sourceWriteRef`, the reset-source-mode-on-switch
effect (the actions do it). Kept until PR 6: `latestSourceRef`, `sourceEntryRef`, `sourceDocIdRef`,
`sourceEditorRef`, `prevSourceModeRef`.

**Dev HMR:** `attachEditor(editor)` is called from `setEditorInstance`; when the schema differs from the one the
sessions were built with (a remount), every session state is rebuilt with `Node.fromJSON(schema, doc.toJSON())`
+ `EditorState.create` + identity restamp (history lost, marks kept). Replaces the suggestion snapshot. The map
survives an HMR of `session.ts` itself via `import.meta.hot.data`.

### Work order (one branch, five commits, suite green after each)

1. **Actions first, today's stores behind them.** `tabs/actions.ts` built from the useTabs flows (§3 of the
   inventory), with `setDocument` and the four loads inside; `useTabs` → binding; executors `select_tab`,
   `open_file`, `create_and_open_file`, `new_file`, `save_file` onto the actions (+ `buildSaveContent` exported
   from `useEditor`); `useEditor.openFile` / `openFileFromPath` / `newFile` onto them; App, diskSync,
   useRemarkableSync, FileListPanel rename/move, the reMarkable buttons onto them. This commit alone fixes
   A–F and I and the §7.1 disagreements, with the content-sync effect still in place. Review this commit as "every
   entry point goes through one function".
2. **Session layer.** `identity.ts`, `extensions.ts`, `session.ts`; `PlainTextMode` reads `plain` from the
   identity state; the pure matchers; `Editor.tsx` loses the effects listed above; the actions switch from
   `setDocument` to `openSession` / `activateSession`; the mirror rules; `persistRecords` behind the store
   wrappers; `replaceSessionDocument` on the source-exit, disk-reload and reMarkable paths; `setSessionIdentity`
   behind the six identity callers.
3. **Handles.** `handle.ts`, `resolveDocumentHandle`, the executor rewrite off `getEditor()`.
4. **Tests.** vitest harness + unit tests; `e2e/electron.document-sessions.spec.ts` + tripwires; seams.
5. **Sweep.** Dead code from design §8 that PR 1 owns; `docs/issues/1145/plan.md` (this section);
   one status line in the design doc. `CLAUDE.md` waits for PR 8.

### Files

| File | Change |
|---|---|
| `document/identity.ts`, `document/session.ts`, `document/handle.ts`, `tabs/actions.ts`, `components/editor/extensions.ts` | New |
| `components/editor/Editor.tsx` | As above; expected to lose ~600 lines |
| `hooks/useTabs.ts` | Binding over the actions (from 1125 lines to ~100) |
| `hooks/useEditor.ts` | open/new → actions; `saveFile` serialises via `serializeSession`; Save As / quick save → `setSessionIdentity`; `buildSaveContent` exported |
| `stores/editorStore.ts` | `readCache` + accessors deleted; `document` documented as the mirror; `isPreviewTab` / `sourceMode` kept (PR 7) |
| `stores/tabStore.ts` | `Tab.readOnly` (derived at open with `isRemarkableOcrPath`); `persistSession` unchanged |
| `stores/editorInstanceStore.ts` | `flushPendingUpdate` removed; `setEditor` calls `attachEditor` |
| `extensions/ai-annotations/store.ts`, `plugin.ts`, `reanchor.ts` | `saveAnnotations` delegates; `addAnnotation` refuses foreign ids; identity guard in `apply`; `reanchor.ts` exports its helpers, `reloadKeepingAnnotations` deleted |
| `extensions/comments/extension.ts`, `store.ts` | `applyCommentMarks` pure; `needsRestore` / `markRestored` deleted; auto-resolve identity guard; `saveComments` delegates; matchers stay in the file (tripwire) |
| `extensions/ai-suggestions/extension.ts`, `store.ts` | `applySuggestionMarks` pure; store reduced to `{ documentId }` |
| `extensions/plain-text-mode/index.ts` | Reads `getIdentity(newState).plain`; `storage.enabled` and `executors/editor.ts:211` follow |
| `lib/tools/executors/document.ts`, `editor.ts`, `file.ts`, `tabs.ts` | Handles; actions |
| `components/layout/App.tsx` | `recoverSessionState` → `restoreTabs`; `recoverDraft` → `hydrateDraft`; converters → `convertTab`; conflict dialog → `reloadTabFromDisk` |
| `lib/diskSync.ts`, `hooks/useRemarkableSync.ts` | `reloadTabFromDisk` |
| `lib/editorViewState.ts` | `selectionFromViewState(doc, viewState)` split out |
| `components/files/FileListPanel.tsx`, `components/layout/TabBar.tsx` | rename/move → `renameTab`; double-click → `promotePreview` |
| `lib/artifactImport.ts`, `lib/shareSync.ts`, `lib/sharePush.ts`, `main.tsx` | `mergeThreads` instead of `loadComments`; the delegating store wrappers; seams re-pointed |
| `lib/persistence.ts` | No schema change, no `DB_VERSION` bump |
| `package.json`, `vitest.config.ts`, `.github/workflows/e2e.yml` | vitest + jsdom; `test:unit`; one CI step (if the OAuth merge refuses the workflow file: local `--no-ff` merge over SSH, as #1084) |

Also deleted: `editorStore.readCache`, `saveCurrentTabState`, `syncActiveTabWithEditor`, `flushPendingUpdate`,
`reloadKeepingAnnotations`, the switch logic in `executeSelectTab` / `executeOpenFile`, the external
`setLoadingDocument` calls, the 100 ms resume timers, `needsRestore` / `markRestored`, the suggestion store's
pending machinery. Left alone for PR 8: the `initialized` closure in node-ids.

### Tests

**vitest** (`vitest.config.ts`: `environment: 'jsdom'`, `include: ['src/**/*.test.ts']`; `npm run test:unit`;
persistence mocked with `vi.mock('../lib/persistence')`). A headless TipTap `Editor` built from
`createEditorExtensions` gives the schema and parser. `src/renderer/document/session.test.ts`:
1. `openSession` stamps identity, assigns node ids, appends the trailing paragraph after a table, flattens a
   `.txt`, and starts with an empty history.
2. Comment marks restore on the right occurrence (the #1137 fixtures), resolved threads are skipped, anchor-lost
   ids come back; suggestion marks restore by `originalText`.
3. The markdown projection is byte-exact for an untouched document and dirty after an edit.
4. `persistRecords` pairing: with B active, a write for A lands under A's key with A's records; the mirror never
   holds a (B id, A records) pair across an activation (the §G unit case).
5. `setSessionIdentity` copies the four keys and restamps the state.

**`e2e/electron.document-sessions.spec.ts`** (design §12 cases 1, 5, 7, 8, 10; isolated `PROSE_USER_DATA_DIR`,
`PROSE_DEBUG_PORT=9230`, settings seeded by hand as `source-mode-authority` does):
1. Two documents with annotations, comments and suggestions; switch twenty times with an edit on each visit via
   `select_tab` and the tab bar; every IndexedDB key holds only its own records, byte for byte. New seams
   `loadCommentsFromDB`, `loadSuggestionsFromDB` beside `loadAnnotationsFromDB`. The contamination is latent on
   the current code (it needs a writer in the ~ms gap), so this case is a guard; its falsification is unit test 4.
5. Relaunch with five tabs; each restores its records keyed to itself; `__prose_tools.getSessionTabIds()` lists
   only the active tab before any click, then grows per click.
7. Rename an open tab (`__prose_renameTab`), then `save_file` an untitled one to a path: comments and suggestions
   follow (fails today: K), and `getAnnotationDocId` / `getCommentDocId` carry the new id.
8. `select_tab`, `open_file` and the tab bar produce identical tab, store and IndexedDB state for one sequence
   (fails today: raw comments on `select_tab`, no outgoing save on `open_file`).
10. A switch more than 500 ms after the last keystroke performs no serialisation (`__prose_tools.getProjectionStats()`
    counts `serialize` calls; fails today on `select_tab`, which always calls `getMarkdown`), and twenty open
    tabs of a 100 KB fixture stay under a heap ceiling measured with `performance.memory.usedJSHeapSize`; the
    ceiling is calibrated on the first run (recorded in the spec with 2× headroom) since no baseline exists.
Tripwires (source-text, in `dialog-defaults` style): the three save functions and their deletes imported only by
`session.ts`; `view.updateState(` and ProseMirror's `EditorState.create(` only in `session.ts` (files importing
`@codemirror/state` excluded); `setDocument({` only in `session.ts` and `tabs/actions.ts`.

**Existing specs that must stay green** (design §12): `tab-caret`, `tab-switch-flush`, `comment-occurrence`,
`comment-auto-resolve`, `comment-threading`, `share-sync`, `source-mode-authority` (11), `suggestions-persist`,
`suggestions`, `restructure`, `ai-provenance`, `ai-edit-lifecycle`, `activity-panel`, `node-ids`, `tables`,
`stale-paths`, `file-explorer-qa`, `explorer-interactivity`, the five web specs. Local run:
`PROSE_DEBUG_PORT=9229 npx playwright test --global-timeout 0` from a worktree with its own `node_modules`
(never the main checkout while a suite runs); CI e2e on the PR is the gate of record. Baselines: tsc ≤ 16,
`typecheck:e2e` ≤ 8, `npm run build` clean.

### Verification and QA

1. After each commit: `npx tsc --noEmit -p tsconfig.json`, `npm run build`, the targeted specs above.
2. After commit 4: the full local suite, then push, CI green, claude review.
3. QA pass on the dev server (`qa/dev` = release + this branch, `--no-ff`; restart the server since main does not
   rebuild, renderer hot-reloads): open two docs with comments and AI edits, switch twenty times typing in each,
   relaunch; source-mode round trip with comments and annotations; rename, Save As, convert to `.txt` and back;
   preview browsing with arrow keys; close/reopen; trash an open file; explorer rename of an open file.
4. Merge on the operator's word; `qa/dev` reset to the release head.

### Review of this plan (2026-11-01, read-only pass against the installed sources)

Confirmed against `prosemirror-view` 1.42.6, `prosemirror-state` 1.4.4, `prosemirror-history`, `@tiptap/core`
2.27.1, `@tiptap/react` 2.27.1 and `tiptap-markdown` 0.8.10: plugin views are recreated (not updated) when the
plugins array differs and `EditorState.create` always makes a new array; `apply` sees a partially built state,
`appendTransaction` the full one; `setEditable(editable, emitUpdate = true)`; a meta-only transaction emits
`transaction` only and `@tiptap/react` re-renders on it; `createDocument` is exported and the markdown parser
reads nothing from the view; `PluginKey.getState` resolves by key string; `addToHistory: false` records nothing
and a fresh state has undo depth 0; `applyTransaction` loops every `appendTransaction`; `reconfigure`,
`Node.fromJSON` and `CommandManager` with a custom state exist as assumed. The four holes it found (source mode on
a switch, thread merges into an open document, scroll-restore timing, `addAnnotation` re-keying) and the
baseline reset are folded in above.

### Open points

- Memory ceiling for case 10 is calibrated, not agreed in advance (no baseline exists); the number lands in the
  PR body.
- `reanchor.ts` keeps `reloadKeepingAnnotations`'s algorithm; PR 2 folds it into the plugin's `RELOAD` handling.
- The `web.share-viewer` tripwire keeps the two matcher occurrences in `comments/extension.ts`; the pure
  `applyCommentMarks` lives there too.
- If a jsdom gap breaks an extension in the harness, the harness builds the schema from a reduced list and says
  so in the test file; the e2e spec is unaffected.


### Execution log

- **2026-11-01, step 0:** worktree `prose-1145` on `issue-1145-document-sessions` from `release/v1.9.0` =
  `9699d4b`; this plan and `inventory.md` committed (`4491275`); #1162 (G), #1163 (H), #1164 (J) filed.
- **2026-11-01, commit 1 (actions):** `src/renderer/tabs/actions.ts` holds every lifecycle flow; `useTabs` is a
  binding; `select_tab` / `open_file` / `new_file` / `save_file`, `useEditor`'s open / new / Save As / quick save,
  App's launch restore and converters, `diskSync`, `useRemarkableSync`, the explorer's rename / move / cut-paste /
  drag-move, the tab bar's double-click promote and the reMarkable buttons all call it. The editor-store →
  active-tab mirror (`syncActiveTabWithEditor`) is a module subscription in the actions file until the session
  projection replaces it. Behaviour changes to state in the PR: Toolbar Open / Cmd+O / EmptyState Open open a tab
  (finding C); explorer rename / move / cut-paste / drag-move carry the document identity and records (I);
  Save As / quick save / `save_file` migrate suggestions and comments too (K); a closed tab is flushed and
  persisted under its own id before it leaves (A); read-only is derived from the path on every arrival (E);
  the chat panel hides while a preview tab exists and returns when none does (F); a clean reopened tab re-reads
  its file and records a baseline; every open / reload records a baseline (D). `setDocument` + the four loads
  stay inside the arriving step until commit 2.
- **2026-11-01, commit 2 (session layer):** `document/identity.ts` (the `Identity` extension at priority 1000,
  `IDENTITY_META` / `ACTIVATED_META` / `RELOAD_META`, `getIdentity`), `components/editor/extensions.ts`
  (`createEditorExtensions`, the list lifted from Editor.tsx with the lowlight setup and the task-list marker),
  `document/session.ts` (the map, `attachEditor`, `openSession`, `activateSession`, `closeSession`,
  `applyToSession`, `replaceSessionDocument`, `mergeThreads`, `setSessionIdentity`, `serializeSession`,
  `persistRecords` / `deleteRecords`, the markdown and suggestion projections, source-mode entry and exit,
  `getSessionTabIds` / `getProjectionStats`). The Editor lost the content-sync, record load / restore / persist
  and HMR-snapshot effects, `onUpdate`'s store write, `flushPendingUpdate` and nine refs; it creates the editor
  with empty content and `attachEditor` hands it to the session layer. `applyCommentMarks` /
  `reconcileAnchorLost` (comments) and `applySuggestionMarks` (suggestions) are the pure bodies of the restore
  commands; the comment store is `{ documentId, pendingComments }`, the suggestion store `{ documentId }`;
  the three `save*` wrappers and the two `delete*` wrappers delegate to the session layer; `addAnnotation`
  refuses a record for another document; the annotation plugin reads and moves store records only under
  their own identity and leaves a `RELOAD` to the text re-anchoring (`reanchor.ts` exports the helpers;
  `reloadKeepingAnnotations` is gone); `autoResolveDeletedComments` bails on an activation, a reload or an
  identity mismatch; plain-text mode reads `identity.plain`. Share pulls and artifact imports call
  `mergeThreads`. `isAnnotationMappingPaused` still reads the store flag (true only inside `addAnnotation`'s
  microtask); `getCommentStoreNeedsRestore` returns false.
  Found while landing it: `npx tsc --noEmit -p tsconfig.json` never type-checks the renderer. `tsconfig.json`
  references `tsconfig.node.json`, which is not `composite`, so tsc stops at the 16 project-reference errors
  (TS6305/6306/6310) and checks nothing; the "16-error baseline" was that config noise. A config that extends
  `tsconfig.json` without the reference checks the renderer for real: 125 errors on the release head, 70 on this
  branch after commit 2 (no new ones; 55 of the old ones go with `getComments` / `getAISuggestions` taking
  `{ state: { doc } }` and with the deleted code). `electron-vite build` is esbuild and checks nothing either, so
  the e2e suite was the only gate. Commit 5 adds the config as `tsconfig.renderer.json` + `npm run
  typecheck:renderer` and the PR body lists the remaining pre-existing errors for a follow-up. Two e2e-found
  fixes folded into commit 2: `activateSession` sets the tab store's active tab (the tab bar and the store→tab
  mirror key on it), and a `BUILD_META` on the scratch-normalisation and seed transactions, without which the
  annotation plugin mapped the live store's records through the scratch state's replace when a session was
  rebuilt for the same document (source-mode exit: every annotation shifted by the new body's length).
- **2026-11-01, commit 3 (handles):** `document/handle.ts` (`DocumentHandle`, `resolveDocumentHandle({ forWrite })`;
  every handle is the active session's, backed by the live editor, with `apply`, `chain`, `can`, `commands`,
  `markdown`, `serialize`, `view` only for the active one). The document and editor executors and
  `create_and_open_file`'s readiness wait read `handle.state`, write through `handle.commands` / `handle.chain()`
  / `handle.apply()`, and never touch `useEditorInstanceStore`; `parseMarkdownToSlice` takes the markdown
  codec, `scrollSelectionIntoCenter` a `{ state, view }`. `read_document`'s markdown still comes from the
  store's content, which the projection keeps current (the 500 ms cache the plan names is now the projection;
  `handle.serialize()` lands it first).
- **2026-11-01, commit 4 (tests):** vitest + jsdom (`vitest.config.ts`, `src/renderer/test/setup.ts`, `npm run
  test:unit`, one CI step before the Playwright build in `e2e.yml`); `src/renderer/document/session.test.ts` (six
  cases over a headless TipTap editor built from `createEditorExtensions`: normalisation and empty history, `.txt`
  flattening, comment / suggestion mark restore with the #1137 fixture and a lost anchor, the byte-exact
  projection, the §G pairing invariant under a store subscription, `setSessionIdentity`);
  `e2e/electron.document-sessions.spec.ts` (§12 cases 1, 5, 7, 8, 10, each in its own profile because the tab bar
  collapses past a handful of tabs, plus the three tripwires). Case 10's heap: 97.4 MB with twenty 100 KB tabs on
  the first run (Electron 45, this machine), ceiling 200 MB. A settled switch spends no serialisation.
- **2026-11-01, commit 5 (sweep):** `editorStore.readCache` and its accessors, `resetDocument`, `hydrateFromDraft`;
  the annotation store's `loadAnnotations`, `clearAnnotations`, `setDocumentId`, `setLoadingDocument` (and their
  type entries); `restoreEditorViewState`. `tsconfig.renderer.json` + `npm run typecheck:renderer` is the real
  renderer type check (69 pre-existing errors on this branch, 125 on the release head; none new); the status line
  in `docs/architecture/editor-state.md`. The `initialized` closure in node-ids stays for PR 8, as planned.
