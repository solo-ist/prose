# Editor state: one document per tab

Status: decided 2026-11-01 with the operator; child issues filed the same day (section 11); PR 0a (#1143), 0b (#1144) and the dialog fix (#1153) landed 2026-11-01; PR 1 (#1145, the session layer, identity plugin, tab actions, handles, vitest harness) merged 2026-11-02 as `5b67ba9`, plan and execution log in `docs/issues/1145/`; PR 2 (#1146, AI annotation records in plugin state, `anchorText`, re-anchoring at load and across whole-document replaces) merged 2026-11-03 as `e47c4b7`, plan and execution log in `docs/issues/1146/`; PR 3 (#1147, comment threads in plugin state, auto-resolve in `apply`, share paths by `documentId`) merged 2026-11-03 as `1021558`, plan and execution log in `docs/issues/1147/`; PR 4 (#1148, chat tool calls and streams bound to the conversation's document) merged 2026-11-03 as `6377fc3` and PR 5 (#1149, the suggestion store deleted) as `d5b8fec`, plans in `docs/issues/1148/` and `docs/issues/1149/`; PR 6 (#1150, source mode per tab with a CodeMirror state per session) merged 2026-11-03 as `cb66710`, plan and execution log in `docs/issues/1150/`; PR 7 (#1151, frontmatter on the tab, one dirty rule in the projection, autosave from the tab record, `isPreviewTab` / `sourceMode` deleted) is on branch `issue-1151-frontmatter-tab`, plan and execution log in `docs/issues/1151/`. Follows Option 1 in `docs/issues/1094/reset-2026-11-01.md`. This file is the architecture record for the editor from here on; the "Tabs", "Editor" and "Annotation persistence invariant" sections of `CLAUDE.md` are rewritten from it in the last PR of section 11. Section 13 lists every decision taken and why, so a later reversal is a one-line change there and in the PR sequence.

How to read it cold: section 1 settles the two pre-flight questions (security backlog, TipTap 3). Section 2 is the list of behaviours the change must not break, each with its owner before and after. Sections 3 and 4 are the model and the lifecycles, with the seams named by file; 4.14 is the chat binding. Sections 5 and 6 cover the three annotation kinds and the smaller plugins. Section 7 lists every consumer that changes, section 8 what gets deleted, section 11 the PR sequence, section 12 the acceptance suite, section 13 the decisions.

## 1. Pre-flight decisions

### 1.1 The security backlog does not block this work; two dependency bumps go first

What exists, as of 2026-11-01:

| Item | Surface | Touches the editor seam? |
|---|---|---|
| 36 open Dependabot alerts: 14 Electron (41 → 45, a major; Dependabot names 42.11.x, which has been end-of-life since 2026-10-20), 5 Vite (7.3.7 patch), undici, body-parser, fast-uri, ip-address, hono, markdown-it (lockfile or override bumps; four of the fast-uri alerts are in the gateway lockfile) | Platform, lockfiles | No |
| #866 TipTap 2 → 3 (clears the `mergeAttributes` `__proto__` advisory; alert 143 is dismissed as "fix started") | Renderer editor | Yes, see 1.2 |
| #980 contain sync-metadata paths | `src/main` | No |
| #914 encode gateway client ids, coerce publish args | `src/main` | No |
| #908 MAS gating of share IPC | `src/main` | No |
| #904 annotated copy embeds the capability URL (product call plus a one-line change in `viewerScript.ts`) | Viewer bundle | No |
| #912 tokens at rest (gateway DB, `share-sync.json`, viewer localStorage) | Gateway, `src/main`, viewer | No |
| #913 anonymous route coercion, client-supplied `publishRev` | Gateway | No |
| #942 operator takedown, report-abuse link | Gateway, viewer | No |
| #1005 build-tool alerts | Withdrawn upstream (alerts 171 and 174 return 410); close after a check | No |

Nothing on the list except #866 touches `src/renderer/components/editor`, the stores, or the extensions. Serialising the editor work behind all of it buys no safety and costs weeks, and most of it is main-process or gateway work that needs the operator's security gate review anyway, so it is operator-bound, not agent-bound.

Decision: two platform bumps land before PR 1 of this design, because they change the runtime the acceptance suite runs on and attribution must stay clean:

1. Electron 41 → 45.2.1 plus the root-lockfile and override sweep (32 of the 36 alerts: the 14 Electron ones, Vite 7.3.7, and the transitive undici, body-parser, ip-address, hono, markdown-it and fast-uri bumps, all reachable within their declared ranges). Dependabot names 42.11.x as the first patched line, but Electron 42 reached end of life on 2026-10-20; 45 is the current line (EOL 2027-04-27) and 44.10.1 the fallback if 45 fails the suite. The PR touches `package.json`, the lockfile and one line of `CLAUDE.md`, so it is outside the security gate (`src/main/**`, `src/preload/**`, `electron-builder.*`, the vite config); PR #867 (Electron 41) is the precedent. Full e2e on the PR is the gate. Since Electron 42 the npm package no longer downloads its binary in `postinstall`, and electron-vite throws when the binary is missing, so our own `postinstall` runs `install-electron`. (#1143. Corrected 2026-11-01 while planning; the first draft used the Dependabot figure and assumed the gate.)
2. The gateway lockfile (fast-uri ×4), Node 22 on the e2e runner, and anything the first PR deferred (#1144).

An audit of every 42–45 breaking change against the code found three main-process follow-ups, all on the security track and none gating an editor PR: from Electron 43 a dialog without `defaultPath` opens in Downloads and the OS stops remembering the last folder, and from 44 `clipboard.writeText` returns a Promise the IPC handler does not await (one small gated fix inside 1.9.0, #1153); the sync `safeStorage` API is deprecated in 45 and removed in 46 (#1154). Electron 44 dropped macOS 12, so 1.9.0 ships for macOS 13 and later. The sandboxed preload, the permission handlers, the ASAR fuses and the rest of the main-process surface are unaffected.

Everything else on the security list runs in parallel as its own track, ordered by exposure: #904 (one product decision, then a small change), #914, #908, #980 (small, main-only), then #912, #913, #942 on the gateway's own deploy cadence. None of them waits for the editor work and the editor work waits for none of them.

### 1.2 TipTap 3 comes after this design lands, not before

Facts checked on 2026-11-01:

- TipTap 2's last release is 2.27.3 (2026-09-04), tagged `v2-latest`. TipTap 3 is at 3.32.2 (2026-10-30). The advisory needs 3.30.4 or later.
- `tiptap-markdown` 0.9.0 (2025-09-08) supports TipTap 3. Diffing its bundle against the installed 0.8.10 shows one change: the `setContent` command takes an options object instead of positional arguments. The parser, the serializer and the extension protocol are byte-identical, so the codec Prose depends on, with its five custom `markdown.serialize` and `parse.setup` hooks and the Wave 4 fixes, carries over unchanged. Its author has stopped maintaining it and points at the official extension.
- The official `@tiptap/markdown` is built on `marked`, is labelled an early release, allows one child per table cell, has no footnotes, and loses comments. It is not a drop-in for Prose's codec and would be its own migration with its own round-trip QA.
- `tiptap-footnotes` 3.0.1 supports TipTap 3.
- In 3.32.2, `editor.state` reads `this.view.state` whenever a view exists, and the editor itself calls `view.updateState` in six places. The one ProseMirror call this design is built on behaves the same in both majors.
- Breaking changes that touch Prose: `setContent(content, { emitUpdate })` with `emitUpdate` defaulting to true (today's code depends on the opposite default); `shouldRerenderOnTransaction` defaulting to false; table, list and placeholder extensions moving packages; StarterKit now bundling Link and Underline; `getPos` possibly undefined in node views. Counts in the renderer: 8 `setContent` call sites, 1 `editor.isActive` in render, 2 `getPos()`.

Why after and not before: this design deletes the content-sync effect and most of the `setContent` calls, moves components off `editor.*` reads in render onto session selectors, and leaves the ProseMirror layer, which TipTap 3 does not change, as the foundation. Migrating first means migrating code that is about to be deleted and running the refactor's QA on two moving parts at once. Migrating after means a smaller surface and a clean attribution for each.

Decision: TipTap 3 with `tiptap-markdown` 0.9.0 and `tiptap-footnotes` 3.0.1 opens the next epic as its first PR. It does not ride 1.9.0: the advisory is dismissed with a rationale and its exposure is low, the release is already long, and the migration is small once section 11 has landed, so it gains nothing from this train. Evaluating `@tiptap/markdown` stays a separate spike under #823 and is not a dependency of anything here.

## 2. What must not break

Every behaviour below exists today. The table says who owns it now and who owns it after. "Session" means the per-tab document session defined in section 3.

| Behaviour | Today | After |
|---|---|---|
| Click a tab: its document, caret and scroll come back | `useTabs.switchToTab` serialises the leaving doc, `Editor.tsx` content-sync effect re-parses the arriving one, `restoreEditorViewState` puts the selection back (#1103) | `activateSession`: `view.updateState(session.state)`; selection is part of the state; only `scrollTop` is restored from the tab |
| Typing right before a tab click is not lost (#1127) | `flushPendingUpdate` on the editor instance store | Nothing to flush: the state is the document; the markdown cache is a projection |
| Per-tab undo history | `EditorState.create` on every new document | Each session's state carries its own history |
| Single click in the explorer opens a preview tab; the next single click replaces it; double click or editing promotes it; a preview tab is read-only | `useTabs.openFileInPreviewTab`, `promoteCurrentPreview`, global `isPreviewTab` flag in `editorStore` | `tab.isPreview` is the only flag; `activateSession` sets `editor.setEditable` from the tab; promotion flips the flag |
| Arrow keys in the explorer preview files | `useExplorerActions.onFilePreview` | Same call into the tab actions module |
| Opening a file already open switches to it; opening into an empty untitled tab replaces that tab | `openFileInTab`, `openFileInPreviewTab`, `executeOpenFile` each reimplement it | One `tabs.openFile(path, { preview })` in `src/renderer/tabs/actions.ts` |
| Close tab, close others, close all, reopen last closed with unsaved content | `useTabs` plus `tabStore.closedTabs` | Same, through the actions module; the snapshot keeps markdown as today |
| Trash from the explorer closes the open tab | `FileListPanel` → `forceCloseTab` | Same |
| Rename an open tab or file: annotations, comments, suggestions, conversations and share metadata follow the new `documentId` | `renameTab` copies the four IndexedDB keys and re-points the annotation store | `setSessionIdentity(tabId, …)`: one function, also used by Save As, quick save and the .txt/.md converters |
| Session restore on launch: tabs, active tab, caret and scroll, stale-file handling (#829, #843) | `App.recoverSessionState` adds tabs and hydrates the active one through `editorStore` | Same restore logic; the active tab's session opens eagerly, the others open on first activation |
| Legacy single-draft recovery | `App.recoverDraft` | Unchanged; creates one tab |
| Stale-on-focus reload of a clean tab; conflict toast and dialog for a dirty one | `diskSync.loadDiskVersionIntoTab` writes `editorStore` for the active tab, `tab.content` for others | `replaceSessionDocument(tabId, …)` works for any tab, active or not |
| Save, Save As, quick save with title, autosave (auto and custom modes) | `useEditor`, `useAutosave` on `editor.on('update')` | Serialise from the session; autosave arms from the tab's dirty transition, which also covers frontmatter-only edits (#1105 defect 1) |
| Save guard against newer disk content | `diskSync` baselines | Unchanged |
| Dirty flag follows real content change only; a comment or suggestion mark alone does not dirty the document | `editorStore.setContent` compares markdown strings | The markdown projection compares against the body as loaded or last saved; marks serialise to nothing, so the comparison is unchanged |
| Source mode: toggle, authority while open (#1102), untouched exit writes nothing (#1125), caret kept, frontmatter shown, comments and annotations survive the round trip | `Editor.tsx` layout effect, six refs, `reloadKeepingAnnotations` | `tab.mode` and a CodeMirror state per session; exit is one replace transaction with a reload meta that every annotation plugin re-anchors through |
| Source mode is remembered per tab (#1132) | Not today; global `sourceMode` resets on switch | `tab.mode` |
| Frontmatter block: edit fields, add, remove, AI-suggested frontmatter overlay, no flicker on explorer clicks (#1104), edits persisted (#1105) | `stableFrontmatter` mirror in `Editor.tsx`, `frontmatterRef` prepend in `onUpdate`, `pendingFrontmatter` in `editorStore` | Frontmatter lives on the tab record; the editor never prepends it; `FrontmatterEditor` is controlled by the tab's value |
| `.txt` files are plain text: marks stripped, blocks flattened, no frontmatter on save | `PlainTextMode` reads `editor.storage.plainTextMode.enabled`, set in the content-sync effect | The identity plugin state carries `plain`; `PlainTextMode` reads it from the state |
| reMarkable OCR view is read-only with Edit and View Original buttons | Derived from path in `editorStore.setDocument`; the buttons set the document directly | Derived from path on the tab at open; the buttons open files through the tab actions |
| A reMarkable sync that rewrites an open document updates the tab in place | `useRemarkableSync` writes `editorStore`, the same-document branch of the content-sync effect re-parses | `replaceSessionDocument` with re-anchoring, so marks survive |
| Selection toolbar's AI-authored toggle marks or unmarks a range | `SelectionPopover` calls the annotation store | Dispatches annotation metas on the active session |
| Comments: add from selection, from the menu, from `add_comment`; refuse overlaps (#830); popover with replies and resolve; Comment Review panel; status bar and chat chip counts; auto-resolve on deleting the text (#928); AI replacement keeps the thread open as anchor-lost (#1099); restore on the right occurrence (#1137) | Marks in the doc plus the global comment store, restored by text after every load | Marks in the doc plus thread metadata in the comments plugin state of that tab; restore by text only when loading from disk or exiting source mode |
| Share sync: new thread push, resolve push, pull merge with revisions and tombstones, author deletion does not resurrect | `sharePush.ts`, `shareSync.ts` read and write the global store for the active document | Same functions, addressed to the session that owns the `documentId`; a document that is not open is merged in IndexedDB as today |
| Artifact import merges travelling comments before the first persist | `openDocument.ts` writes IndexedDB before load | Unchanged; the load reads it |
| AI annotations: created by `edit`, `insert`, accept, accept-all, paste prompt; time fade; tooltip; hide and show; history panel with detached entries (#674); rename migration; relaunch | Global annotation store, decorations rebuilt from it, positions mapped in the store from the plugin | Records in the annotations plugin state of that tab, mapped in `apply`; the history panel reads the active session through a selector |
| AI annotations keep their text across a reload or round trip (#1138) | `reanchor.ts` on source exit only | Reload meta re-anchoring in the plugin, for source exit, disk reload and load from IndexedDB |
| AI suggestions: `suggest_edit`, popover, accept, reject, accept-all, reply, block conversion, persistence across switch and relaunch, resolved sets do not come back (#1126) | Marks in the doc plus the suggestion store's `pendingSuggestions` and a persist effect | Marks in the doc; restore by text at load; persistence projected from the marks |
| Find bar with highlights | `SearchHighlight` storage plus plugin state | Plugin state only; the bar re-runs its query on activation |
| Selection popover, link popover, table rails, footnotes, images, code block highlighting, persistent selection while blurred | Read the editor | Unchanged; they read the active state through the same editor |
| Status bar cursor line and column; selection cache for `read_selection` | `selectionUpdate` handler in `Editor.tsx` | Unchanged |
| Cmd+Shift+C copies markdown; HTML export; share publish HTML | `editorStore.document.content`, `editor.getHTML()` | The projection and the active editor, unchanged |
| MCP and chat tools: `read_document`, `get_outline`, `edit`, `insert`, `delete_node`, `suggest_edit`, `accept_diff`, `add_comment`, `list_comments`, `resolve_comment`, `list_tabs`, `select_tab`, `open_file`, `create_and_open_file`, `new_file`, `save_file` | Executors reach into the stores and reimplement the switch | Executors call the tab actions and the session; `read_document` serialises from the state, so it never reads a stale debounce |
| A chat turn keeps acting on its own document after the user switches tabs, including a turn still streaming | `useChat` reads the document id from `editorStore` when each call is made and the executors act on whatever the single editor shows, so the rest of the turn lands on the new tab or fails | Each tool call resolves a handle from `conversation.documentId`; an inactive tab receives background transactions; the stream is keyed to its conversation (4.14) |
| Chat conversations, summaries, emoji titles keyed by document | Per `documentId` stores | Unchanged |
| Hot reload in dev keeps live suggestions | `snapshotSuggestions` on unmount | Sessions live outside React, so a remount reattaches the same states |
| Test seams `__prose_editor`, `__prose_tools`, `__prose_share` | Read the global stores | Keep the same names; re-point them at the active session (section 12) |
| Web build (`npm run test:web`, the browser fallback API) | Same renderer | Same renderer; the session layer has no Electron dependency |

## 3. The model

### 3.1 Terms

- **Tab record**: the serialisable row in `tabStore`. Identity, path, title, flags, frontmatter, scroll offset, the markdown cache. What the session file on disk holds.
- **Document session**: the runtime object behind a tab. Holds the tab's ProseMirror `EditorState`, its CodeMirror state when in source mode, and its pending projection timers. Lives in a module-level map keyed by tab id, outside React. Never serialised.
- **EditorState**: ProseMirror's immutable state. The document, the selection, the undo history, and one state slot per plugin. The editor view shows exactly one at a time; every other open tab's state waits in its session.
- **Projection**: a value derived from a session's state and written somewhere else: the markdown cache and dirty flag on the tab record, the `editorStore.document` mirror, the three IndexedDB record sets, the saved session.
- **Identity**: the `documentId` and `path` stamped into the state by the identity plugin. Every projection takes the id from the same state object it projects.

### 3.2 Ownership

| State | Owner after this design | Notes |
|---|---|---|
| Document content, selection, undo history | The tab's `EditorState` | Switching tabs swaps states; nothing is re-parsed |
| `documentId`, `path`, `plain` | Identity plugin state inside the `EditorState` | Changed only by an identity transaction |
| AI annotation records and decorations | Annotations plugin state | Section 5.2 |
| Comment marks | The document | Unchanged |
| Comment thread metadata (replies, resolved, anchorLost, author, shareId, publishRev) | Comments plugin state | Section 5.1 |
| AI suggestion marks | The document | Unchanged; no separate record store |
| Node ids, search highlights, persistent selection | Their plugin states | Node ids already are; search highlight moves out of extension storage |
| Frontmatter | Tab record | Never inside the ProseMirror document |
| Source or rich mode, CodeMirror state | Tab record (`mode`) and session (`source`) | Section 4.9 |
| Preview, read-only, dirty, title, scroll offset | Tab record | `isDirty` is written by the markdown projection |
| Markdown cache (`tab.content`) | Tab record, written by the markdown projection | Still body-only, as today; it feeds the saved session, list_tabs, the H1 title, emoji generation |
| `editorStore.document` | A mirror of the active tab, written by `activateSession` and the markdown projection | Kept for its many readers; the editor no longer reads it to decide what to show |
| Review mode, suggestion index | `reviewStore.tabStates` | Already per tab; the precedent this design follows |
| Annotation visibility toggle | `editorStore.annotationsVisible` | Global UI preference, applied by the existing `hide-annotations` class; the plugin stops tracking it |
| Chat, summaries, emoji, command history | Their stores, keyed by `documentId` | Unchanged |
| Disk baselines | `diskSync` | Unchanged |

### 3.3 The four rules, as mechanisms

The reset document stated four rules. Here is what enforces each.

1. **No write without the producing state's document id.** Persistence functions are called only from `projectSession(session, state)`, which reads `identityKey.getState(state).documentId` and the records from the same `state`. The three IndexedDB writers (`saveAnnotations`, `saveComments`, `saveSuggestions` in `persistence.ts`) stop being imported anywhere else. A tripwire spec greps for that.
2. **Id and records change together.** They are fields of one immutable `EditorState`. There is no moment where a state has the next id and the previous records, because a state is created whole and only ever replaced whole.
3. **No timing flag guards shared state.** `isLoadingDocument`, `pendingSave`, `needsRestore`, `isUpdatingFromStore`, the `contentLoadInDispatch` closures and the 100 ms timers are deleted (section 8). Load-time work is a pure function that returns a finished state; nothing observes a half-built one.
4. **Design before touching shared editor state.** The session module is the only code that calls `view.updateState`, creates an `EditorState`, or persists annotation records. Everything else goes through its named functions (3.4). Adding a new writer means adding a function here, in a PR that cites this document.

### 3.4 The session API

Module `src/renderer/document/session.ts`. Names are proposals; the shape is the point.

```
openSession(tab, source): Promise<Session>
  source = { markdown, frontmatter } from disk, a snapshot, a draft, or a tool
  parse → normalise → seed annotations from IndexedDB (re-anchor by text here) → state

activateSession(tabId): void
  sync: view.updateState(state), setEditable from the tab, restore scrollTop,
  write the editorStore mirror, dispatch one no-op ACTIVATED transaction so
  TipTap emits its events and React re-renders

applyToSession(tabId, build: (state) => Transaction): void
  for a tab that is not active: state.applyTransaction, then projectSession;
  for the active tab: editor.view.dispatch

replaceSessionDocument(tabId, next, { keepHistory }): Promise<void>
  source-mode exit (keepHistory true): one replace transaction carrying a bare
  RELOAD meta; each annotation plugin re-anchors by text from the old state's
  document inside its own apply (PR 2: the annotations plugin does, for the
  exit and for its undo). Disk reload (keepHistory false): the session is
  re-opened and the seed re-anchors the stored rows.

setSessionIdentity(tabId, { documentId, path }): Promise<void>
  IDENTITY transaction; migrate the four IndexedDB keys; update tab, chat and
  share metadata. Replaces the five copies of this logic.

serializeSession(tabId): { body, frontmatter, full }
  from the state, memoised on the doc object

closeSession(tabId, { persistEmptySets }): Promise<void>
  flush projections, final persist (an empty set is allowed here), drop

getActiveSession(): Session | null
useActiveSession<T>(selector: (state: EditorState) => T): T
  React hook; re-evaluates after each transaction of the active session

resolveDocumentHandle(target?: { tabId } | { documentId } | { path }): Promise<DocumentHandle>
  default: the active tab. An open document resolves to its session (opened
  on demand if it is still lazy); a path that is not open is opened as a
  background tab; a tab in source mode is refused.

DocumentHandle = { tabId, documentId, state, schema, serialize(), apply(tr), isActive }
  apply is the view's dispatch for the active tab and applyToSession for any
  other. Tool executors take a handle, never the editor instance.
```

Executors are written against `DocumentHandle` from PR 1, with the target fixed to the active tab. The chat binding (4.14) and MCP targets (4.15) change only how a handle is resolved.

The tab lifecycle (open, preview, replace preview, new, switch, close, close others, close all, reopen, rename, convert) moves out of the `useTabs` React hook into plain functions in `src/renderer/tabs/actions.ts` that call the session API. `useTabs` becomes a thin binding so existing React callers keep their names. The MCP executors call the same functions, which ends the three parallel implementations in `useTabs.ts`, `executors/tabs.ts` and `executors/file.ts`.

## 4. Lifecycles

### 4.1 Load

`openSession` is the only place a `ProseMirror` document is built from markdown, and the only place annotations are matched to text.

1. Parse: `tiptap-markdown`'s parser, as today, body only. Frontmatter goes to the tab record.
2. Normalise: apply the parsed content to a scratch state so `appendTransaction` plugins run once (node ids, trailing paragraph after a table, plain-text flattening). Then create the real state from the normalised document so the undo history starts empty.
3. Seed, in one transaction with `addToHistory: false`: annotation records loaded for the `documentId`, comment threads loaded and their marks re-applied by the current `restoreComments` matching (raw occurrence first, space-stripped fallback), suggestion marks re-applied by the current `restoreAISuggestions` matching. These three matchers become pure functions over a document; the code is the code that exists, moved.
4. Stamp identity.

The function has no view, no store reads and no awaits after the IndexedDB reads, so it works for the active tab, a background tab, session restore and tests alike. It is the natural first target for a unit-test harness (#820).

### 4.2 Activate

`activateSession` runs synchronously. It captures the leaving tab's `scrollTop` into its record, swaps the view's state, applies editable, restores the arriving tab's `scrollTop`, writes the `editorStore` mirror, and dispatches one no-op transaction tagged `ACTIVATED`. That transaction exists so TipTap fires `transaction` and `selectionUpdate` (toolbar states, popovers, the status bar and the session save re-arm all hang off those) and so plugins that keep per-view caches can refresh. It changes no content and adds no undo step.

Chat conversations, summaries and the explorer selection load after activation as they do today; they were never part of the race.

### 4.3 Edit

A user transaction goes through TipTap's `dispatchTransaction` as before. The session's state is the view's state, so nothing copies anything. `projectSession` runs on TipTap's `transaction` event for the active session and after `applyToSession` for a background one. It schedules:

- The markdown projection (500 ms, flushed on switch, save and close): serialise body, compute `isDirty` against the saved body and frontmatter, write `tab.content`, `tab.isDirty` and the `editorStore` mirror. The 500 ms matches today's debounce, which several specs encode in their waits.
- Annotation persistence when the annotations plugin state changed (debounced; immediate when a record was added, removed or detached).
- Comment persistence when the threads state changed (at once: add, resolve, reply, remove, merge, anchor-lost, a share write-back; the leave and close projection carries the marks' fresh positions). (PR 3: as shipped.)
- Suggestion persistence when the set of suggestion marks changed (debounced; immediate on a `RESOLVED` meta, including an empty result).
- The saved session (1 s, as today).

Each write is `persistX(identity.documentId, projection(state))` with both taken from the one `state` argument.

Shipped in PR 7 (#1151): the markdown projection writes the tab record (`content`, `isDirty`) for the shown tab and a background one alike, and the editor store's `document` is a mirror of the active record written by one subscription in `session.ts`; `isDirty` is one comparison of the projected body and the tab's frontmatter against the session's saved snapshot (`session.saved`, the load or the last save), so it is not sticky: an undo back to the saved text is clean. A frontmatter write (`setTabFrontmatter`) and the source projection run the same comparison.

### 4.4 Background mutation

Three things write to a document that may not be on screen: a share pull merging threads, a disk reload of a clean stale tab, and an identity change. Each is a transaction built against that tab's state and applied with `applyToSession`, so the same plugins and the same projections run as for a visible tab. Today the first bails when the document is not active and the other two patch `tab.content` by hand.

### 4.5 Save

`serializeSession(active)` gives the body; `buildSaveContent` adds frontmatter or skips it for `.txt`. After a successful write the session records the saved body so the dirty projection has its baseline. The disk-baseline guard is unchanged.

Shipped in PR 7 (#1151) as `saveSnapshot(tabId)` → `{ text, body, frontmatter }` (the typed text verbatim in source mode; the body alone for a plain identity, else `serializeMarkdown(body, tab.frontmatter)`), the one path behind ⌘S, Save As, quick save, autosave, `save_file` and the conflict overwrite; `markTabSaved(tabId, path, snapshot)` records the snapshot on the session (`recordSaved`) and re-projects, so typing during the write keeps the tab dirty. `buildSaveContent` is gone. Autosave (`hooks/useAutosave.ts`) arms from the tab record through the pure `hooks/autosavePlan.ts`: one timer per dirty tab with a path, `auto` re-arming 1.5 s after every projection, `custom` on the clean→dirty transition; a frontmatter-only edit, a source-mode edit and a background edit all save, and a tab switch cancels nothing.

### 4.6 Close and reopen

Close flushes projections, persists final sets (this is the one path where an empty set is written on purpose, as today's tab-close delete is), snapshots markdown and scroll for reopen, drops the session. An unsaved document's IndexedDB keys are deleted as today. Reopen goes through `openSession` from the snapshot.

### 4.7 Identity change

Rename, Save As, quick save, and the two converters all call `setSessionIdentity`. It dispatches an `IDENTITY` transaction (plugins restamp), copies the annotation, comment, suggestion and conversation keys to the new id, updates the tab, the chat store's current id and the share metadata. The old keys are left as today.

### 4.8 Preview tabs

`tab.isPreview` is the only preview flag. Replacing the preview tab with another file is `closeSession` of the old document and `openSession` of the new one under the same tab id, then activate. Promotion flips the flag and re-applies editable. The chat-panel save and restore around preview browsing stays in the actions module.

Shipped in PR 7 (#1151): `applyActiveEditable()` in `session.ts` sets `editable = !tab.isPreview && !tab.readOnly` at activation and whenever the mirror sees either flag flip on the active record (promotion by click, by typing, by an open of the previewed path, by the dirty rule), which is what the Editor's `isPreviewTab` effect used to do; `editorStore.isPreviewTab` is gone and components read `useActiveTab(t => t.isPreview)`.

### 4.9 Source mode

`tab.mode` is `'rich'` or `'source'`. Entering: serialise the state (or reuse the body as loaded when nothing changed, the #1102 baseline logic, now a comparison of the saved body against the current serialisation), build a CodeMirror state, store it on the session, show the source surface. The ProseMirror view keeps the rich state; it is simply not shown. Switching tabs while in source mode keeps the CodeMirror state in the session, so the caret and folds survive a round trip through another tab. Exiting with changes: parse frontmatter out, `replaceSessionDocument(tabId, body, { keepHistory: true, reanchor: true })`; the replace is one transaction with a bare `RELOAD` meta; every annotation plugin re-anchors by text from the old state's document inside its own `apply` (5.1 to 5.3; the meta carries nothing, since `apply` sees the old state), and undo after exit reverts the whole source edit in one step and takes the same re-anchoring path (a whole-document replace with no meta of ours). Exiting without changes dispatches nothing (#1125). Source edits reach the store only on exit (#1102), through the projection.

`.txt` files behave as today; the identity plugin's `plain` flag drives flattening.

Shipped in PR 6 (#1150), with these corrections to the paragraph above. The exit call is `replaceSessionDocument(tabId, { content, body, frontmatter }, { keepHistory: true })`; there is no `reanchor` option, every plugin re-anchors in its own `apply` (5.1 to 5.3). `tab.mode` is on the tab record and in the session draft, so a tab in source mode reopens in source mode after a relaunch (from its content; the caret, folds and source undo history do not survive a relaunch). The CodeMirror state lives on the session (`session.source = { state, entryText, scrollTop }`), built by the session from the projected text with the #1102 baseline as the state's initial document (`extensions/source/state.ts`: module-level base extensions and two compartments, appearance and read-only, that `SourceEditor` reconfigures on the live view through a view-level `dispatchTransactions`; nothing component-bound is baked into the state, so a settings change never rebuilds it). `enterSource` / `exitSource` work for a shown or a background tab; `enterSourceMode` / `exitSourceMode` / `toggleSourceMode` in `tabs/actions.ts` are the one guarded entry point behind the toolbar, the status bar, the View menu and ⌘⇧E. "Source edits reach the store only on exit" means the ProseMirror state: the typed text is projected into the tab record (content, dirty, frontmatter) and the editor store after the projection delay, as before, for the dirty dot, the close prompt, the session draft, Copy Markdown and custom-mode autosave; `projectSessionContent` and `serializeSession` return the source text while the tab is in source mode, so a save, `read_document` and `get_outline` see it. A switch keeps the leaving tab in source mode; the transaction handler's projection guard and the tool writers' refusal are per session (a background tab in source mode refuses writes); closing a tab in source mode, a disk reload and a conversion exit it first. The editor-mutating keyboard shortcuts are inert while the active tab is in source mode. `editorStore.sourceMode` stays as a mirror the session sets on activation, enter and exit, for PR 7 to delete.

### 4.10 Launch

`recoverSessionState` adds tab records as it does now, with the stale-file handling unchanged. The active tab's session opens eagerly before the renderer signals ready. Other tabs open on first activation or first background mutation; until then their `tab.content` from the saved session is their truth, as it is today. This bounds startup time and memory by the active document rather than the session size.

### 4.11 External change

The focus-time check and the conflict dialog call `replaceSessionDocument` for the tab in question, with `reanchor: true` so comments and annotations whose text survived the external edit stay attached. Today a reload drops them until the next restore.

### 4.12 Frontmatter

Frontmatter is on the tab record. `FrontmatterEditor` reads it from the active tab and writes it back; a write marks the tab dirty through the same projection as a body edit, so autosave arms (#1105 defect 1), and the mirror in `Editor.tsx` with its identity comparison goes away (#1105 defect 3). The AI-suggested frontmatter overlay stays in `editorStore.pendingFrontmatter`, cleared on activation of another tab as it is now.

Shipped in PR 7 (#1151). `tab.frontmatter` is always an object (the store normalises `{}`), written by the open paths, `setTabFrontmatter` (the frontmatter editor, the `edit` tool for a shown or a background tab, the overlay's Accept), the source projection and a disk reload; `session.frontmatterRaw` and the raw-block helpers are gone, and `newTab` parses a block out of its content so no record carries one. `FrontmatterEditor` is `{ frontmatter, onChange }`, keyed by tab, with local rows that re-initialise from the prop only when its value differs from what the rows serialise to (the store's echo and an equal-valued new object never wipe a row; an outside write lands) and `onChange` outside the state updater (#1105 defects 3 and 4). `parseMarkdown` keeps the body's bytes after the closing fence, so an untouched frontmatter document saves byte for byte through the baseline (the #1105 trailing-newline note); an edited body still serialises without a final newline, as tiptap-markdown writes it, and the YAML block is still re-dumped (#862).

### 4.13 Read-only

`editable = !tab.isPreview && !tab.readOnly`, applied in `activateSession` and on promotion. `tab.readOnly` is derived from the path at open with the existing `isRemarkableOcrPath`.

Shipped in PR 7 (#1151): `tab.readOnly` is set by `addTab` / `reopenLastClosedTab` and recomputed by `updateTab` whenever `path` changes; `isEditorReadOnly` and `enterSourceMode` read the flags; `editorStore.isRemarkableReadOnly` stays, path-derived in `setDocument` and equal to the active tab's `readOnly`, for its UI readers. `editorStore.sourceMode` is gone too: components read `useActiveSource() !== null`, handlers `getActiveSession()?.source`.

### 4.14 Tool calls and the conversation's document

A chat conversation belongs to one document. Every tool call it makes resolves its handle from `conversation.documentId`, never from the active tab. When that tab is on screen the call goes through the view and the writer watches it land. When it is not, the call is a background transaction on that tab's state, applied atomically rather than streamed, with provenance stamped from that state's identity. The result is the same either way: the edit, suggestion, comment or annotation is in that document and persisted under its id, and it is there when the writer switches back.

The stream has the same binding. Today the chat store holds one `messages` slot that `loadForDocument` swaps on a switch, so a turn still streaming for the previous document appends into the next document's panel. After this design the stream appends to the conversation it was started for, keyed by conversation id, and the panel renders a stream only when its document is the active one. The `read_document` cache moves from `editorStore` into the session, so a background read is served from the right document.

Edge cases: a tab closed while its turn is in flight is reopened as a background tab from disk when it has a path; when it is untitled the remaining calls fail with an error naming the closed document rather than acting elsewhere. A target in source mode is refused as today, because the source text is authoritative while it is open. Effects that need a view, scrolling to a suggestion, the transform animation, the find bar, run only when the handle is active; a tool result card for an inactive document activates its tab on click.

Shipped in PR 4 (#1148), with these corrections to the paragraphs above. The `read_document` cache (`editorStore.readCache`) had already been deleted in PR 1; what PR 4 changes is that `read_document`, `get_outline` and `get_metadata` serialise the handle's state instead of reading the editor store's 500 ms mirror. Conversation lists are per document, so a tool result card is only ever shown while its document is active; nothing activates a tab on click. The binding is explicit, not inferred from provenance (specs and MCP clients pass stale or synthetic ids on purpose): `useChat` creates a `ToolBinding` `{ conversationId, documentId, path, tabId }` for the turn and passes it to `executeTool(name, args, mode, provenance, binding)`, which resolves the handle once (`resolveToolHandle`: the bound tab, else the tab holding the document, else a background reopen of the path from disk with `addTab({ activate: false })`, else `DOCUMENT_CLOSED` naming the document; a lazy tab gets its session; a writer is refused while the target is in source mode) and hands `{ handle, provenance }` to the executor; without a binding the active tab is the target, as before. One handle shape (`handleForTab`) serves active and background tabs: `state`, `isActive` and `view` read the registry on every access, `apply` goes through `applyToSession`, and `commands` / `chain()` / `can()` are the editor's when the tab is shown and a run over the session's state otherwise (TipTap's `CommandManager` with `focus`, `blur` and `scrollIntoView` as no-ops; the chain built by hand because the manager's own never dispatches over a custom state). A background insertion is one transaction; frontmatter writes on a document that is not shown are refused until PR 7 puts frontmatter on the tab. A tool that puts another document in front of the user (`open_file`, `new_file`, `create_and_open_file`, `select_tab`) rebinds the turn and moves its conversation to that document, so "create a file and write into it" keeps working. The chat store keeps every live turn (`turns`, by conversation id) and parks the conversations of a document that has a live turn when another document is shown (`parked`, saved under their own id and winning over the stored list when the document returns); stream events route by stream id to their turn's conversation wherever it lives; the streaming flags are the active conversation's; a rename rekeys, a discarded untitled document orphans its turn. `applyToSession`'s inactive branch schedules the same markdown and suggestion projections as the view's transaction handler, so a background suggestion or its resolve is persisted. The conversation list carries the document it belongs to and a pending save is flushed before the list is replaced, which closes the autosave race on a switch. Pipeline log: `tool:call { tool, conversationId, documentId, tabId, active }`, `tool:rebind`, `tab:background-open`.

### 4.15 Targets for MCP clients

MCP clients keep addressing the active tab unless they say otherwise. The handle makes an explicit `target` (tab id, path or document id) on the tool schemas in `src/shared/tools/registry.ts` a small addition, with `select_tab` kept as the fallback for clients that do not pass one. It is deferred to the next epic (section 13); nothing in 1.9.0 depends on it.

## 5. The three annotation kinds

### 5.1 Comments

Marks stay in the document; that part already works per tab. What moves is the thread metadata, today `pendingComments` in a global store, into the comments plugin state as a map by thread id. Transactions carry metas: `thread:add` (from `setComment`, replacing `onCommentAdded`), `thread:update` (reply, resolve, anchor flags, share ids), `thread:remove`, `threads:merge` (share pull, artifact import), `threads:load` (seed). The pending-style decorations derive from the map and the marks in `apply`; the `view()` subscription that nudges the view on store changes is deleted because every change is now a transaction.

Auto-resolve on text deletion (#928) and anchor-lost on AI replacement (#1099) move from the view-update hook into `apply`, comparing mark ids between the old and new document when `docChanged` and no `RELOAD` or `ACTIVATED` meta is present. The share push for a resolve is a side effect, so `apply` records it in a `pendingPushes` list on the state and `projectSession` performs it; nothing inside `apply` touches the network.

Re-anchoring by text runs in two places only: `openSession` and the `RELOAD` meta. Both use today's matching code. This also carries #1122: an AI replacement that keeps a comment's text sets `RELOAD`-style re-anchoring over the replaced range instead of letting the mark vanish.

Share sync addresses the session by `documentId`. `syncShareComments(entry, documentId)` finds the open tab with that id and merges with `threads:merge`; when no tab has it, it writes IndexedDB directly, as the import path already does. `sharePush` reads the thread from the session that owns the document rather than from "the store".

The `web.share-viewer` spec has a source-text tripwire on `extensions/comments/extension.ts` (it requires the space-stripping normaliser to appear twice). Keep the matching helpers in that file or update the tripwire in the same PR.

Shipped in PR 3 (#1147): `extensions/comments/transactions.ts` holds the key, the state (`threads`, the scanned `marks`, decorations, `revision` / `urgentRevision`, the `pushes` of the latest transition with `pushRevision`), the metas (`load`, `merge`, `add`, `update`, `remove`, `quiet`) and the helpers `threadsOf`, `selectThreads`, `selectOpenThreadCount`, `countOpenThreads`; `threads.ts` the pure transitions (`scanMarks`, `applyThreadMetas`, `reconcileThreads` in its two modes, `diffPushes`); `plugin.ts` the `apply` and the pending decoration; the `Comment` mark's commands `setComment` (thread and mark in one transaction, replacing `onCommentAdded`), `resolveThread`, `reopenThread`, `replyToThread`, `removeThread`, `updateThread`. `apply` runs the metas, then reconciles against the marks of the document being applied: in edit mode a mark that is gone resolves its thread (#928) or, under `AI_REPLACEMENT_META`, leaves it anchor-lost (#1099), and a mark that is back (an undo) reopens and re-anchors; the seed, `RELOAD`, a merge and a re-open only set `anchorLost`. An orphan mark (pasted commented text) is adopted as a thread from its attributes. Share pushes are the diff of the thread set (a new local thread, a resolve toggle, a new local reply, a removal), recorded on the state and performed once per transition by `lib/sharePush.ts`, which the session layer calls through a registered performer; every push, backfill and queued retry is addressed by `documentId` and reads the owning session's state (or the stored rows of a closed document) at send time, writing its `shareId` back with a quiet transaction. `mergeThreads` replaces a session's set in one history-free transaction that marks the new open threads and unmarks a tombstone's, active or background; `syncShareComments` no longer refuses a document that is not the active one (a background merge is silent: no toast, no unseen badge), and `artifactImport` merges against the session's threads when the document is open. The session layer writes any thread change at once and the leave/close projection with fresh positions; a seed writes nothing. `list_comments` includes anchor-lost open threads and `get_metadata.commentCount` counts open threads, matching the status bar. Undo of a resolve reopening the thread, orphan adoption, the silent background merge and the tombstone unmark are decisions 1 to 5 in `docs/issues/1147/plan.md`.

### 5.2 AI annotations

Records move from the global store into the annotations plugin state. `apply` does what the store's `updatePositions` and `updatePositionsWithSplitting` do today, as a pure function: map through `tr.mapping`, split around insertions, detach on collapse, never delete. Metas: `annotations:add` (with the record), `annotations:remove`, `annotations:removeRange`, `annotations:load` (seed), and the shared `RELOAD` meta, handled with today's `reanchor.ts` logic (diff map, then nearest match, then detach).

The `add` meta is applied after mapping within the same transaction, so a command that replaces text and annotates the replacement does both in one dispatch. The microtask deferral in `acceptAISuggestion` and `acceptAllAISuggestions`, which exists because the store could not order itself against the plugin, goes away, and with it the window where a tab switch could mis-key a new record. `createWordDiffAnnotations` in `diffUtils.ts` becomes a builder of `add` metas rather than a caller of `addAnnotation`.

`anchorText` is filled at creation and refreshed on `docChanged` in `apply`, from the state being applied, so it can never hold another document's text. Decorations are rebuilt from the records; the tooltip reads the record from plugin state by id instead of a module closure. Visibility is a CSS class on the container, as it already is; the plugin stops tracking it.

The history panel, the activity badge and `__prose_tools.getAnnotations` read the active session through `useActiveSession`. The detached-entry semantics (#674) are unchanged.

Shipped in PR 2 (#1146): `extensions/ai-annotations/records.ts` holds the pure transitions (map with split and detach, re-anchor across a whole-document replace, load with re-anchoring by `anchorText`, refresh, remove in range, restamp); `transactions.ts` the key, the state and meta types, `addAnnotationsTo` / `removeAnnotationFrom` / `removeAnnotationsInRangeFrom` / `loadAnnotationsInto`, `annotationsOf` and `selectAnnotations`; `plugin.ts` the `apply` and the decorations; `extension.ts` the commands `addAIAnnotations`, `removeAIAnnotation`, `removeAIAnnotationsInRange`; `document/useActiveSession.ts` the React hook over `subscribeActiveSession`. `reanchor.ts` stays as the text-index helpers the plugin calls. The seed `load` re-anchors stored rows by their `anchorText` (kept when the text still sits at the stored range, moved to its nearest occurrence otherwise, detached when it is gone; rows from before the field are filled in), which is what covers a relaunch, a disk reload and a conversion. Any whole-document replace re-anchors, not only one carrying `RELOAD`, so the undo of a source exit and a select-all paste keep the records whose text survives. A zero-width AI deletion marker follows its position and never detaches (before PR 2 it detached on the first edit, by accident of `from >= to`). The session layer persists the set by watching the plugin state's revision: an add, remove, detach, split, re-anchor or restamp at once, a plain move after the projection delay, a seed never.

### 5.3 AI suggestions

Marks already live in the document. The suggestion store (`pendingSuggestions`, `loadSuggestions`, `clearSuggestions`, `snapshotSuggestions`) is deleted. Restore by `originalText` happens in `openSession` and on `RELOAD`. Persistence is projected from the marks: debounced on `docChanged`, immediate on the `RESOLVED` meta, where an empty set is a real result (#1126). The accept paths are unchanged apart from emitting the annotation `add` meta instead of calling the store.

Shipped across PRs 1, 2, 4 and 5: PR 1 moved restore into the seed and `replaceSessionDocument` and the projection into the session layer, leaving a `{ documentId }` facade; PR 2 made the accept paths emit the annotation metas; PR 4 gave a background tab the same projection; PR 5 (#1149) deletes the facade and the session's `records` copy, and `replaceSessionDocument` re-anchors the live marks of the state being replaced rather than the set as loaded. A tripwire keeps `useSuggestionStore` out of the renderer.

## 6. The smaller plugins

- **Node ids**: already plugin-driven. The `initialized` first-run closure is removed; the load path's normalise step is the first run.
- **Plain text mode**: reads `plain` from the identity plugin state instead of `editor.storage`.
- **Search highlight**: results move from extension storage into plugin state, set by meta. The find bar re-runs its query when the active tab changes. The mapped set is kept across `docChanged` when the query has not changed (#1106 lands here or right after PR 1).
- **Persistent selection**: unchanged.
- **Table trailing paragraph, table cell keymap, footnotes, link hover, image upload, focus mode**: unchanged. Node views are rebuilt on activation, which is what a re-parse already does today.
- **`tiptap-markdown` storage** (parser, serializer, `bulletListMarker`): per editor, not per document. Unchanged.

## 7. Consumers that change

| File | Change |
|---|---|
| `src/renderer/components/editor/Editor.tsx` | Loses the content-sync effect (lines 630 to 730), the two load effects and three restore effects for annotations, suggestions and comments, the suggestion persist effect, the source-mode layout effect and its six refs, the frontmatter mirror, `onUpdate`'s store write, `flushPendingUpdate`, the HMR snapshot. Keeps the TipTap editor creation, keyboard shortcuts, popovers, dialogs, focus handling. The reMarkable Edit and View Original buttons call the tab actions. Expected to shrink by well over half (#822). |
| `src/renderer/hooks/useTabs.ts` | Becomes a binding over `tabs/actions.ts`. `saveCurrentTabState`, the five `setLoadingDocument` pairs and the per-flow store calls go. |
| `src/renderer/stores/tabStore.ts` | `Tab` gains `mode`, `readOnly`; `cursorPosition` stays for the status bar; `persistSession` reads the markdown cache the projection keeps current. |
| `src/renderer/stores/editorStore.ts` | `document` becomes the mirror; `isPreviewTab` and `sourceMode` are deleted (derived from the active tab); `setContent` is no longer called by the editor; `hydrateFromDraft` and `resetDocument` route through the actions module; `readCache` moves into the session. *PR 7: shipped; `setContent`, `setFrontmatter`, `setDirty`, `setPath` and `setRemarkableReadOnly` are deleted outright (`hydrateFromDraft` / `resetDocument` / `readCache` never existed on the store: the draft hydrate is `hydrateDraft` in the actions module and the cache went in PR 1).* |
| `src/renderer/stores/editorInstanceStore.ts` | `flushPendingUpdate` removed; `__prose_editor` unchanged. |
| `src/renderer/hooks/useEditor.ts` | `openFile`, `openFileFromPath`, `newFile` call the tab actions instead of setting the document directly (today they bypass the tab layer and rely on `syncActiveTabWithEditor` to patch the tab). `saveFile` serialises from the session; `saveContentAs` and `quickSaveWithTitle` call `setSessionIdentity`. |
| `src/renderer/hooks/useAutosave.ts` | Arms from the active tab's dirty transition, not `editor.on('update')`. The three copies of `handleUpdate` collapse. *PR 7: shipped, per tab rather than the active tab (`hooks/autosavePlan.ts`).* |
| `src/renderer/lib/tools/executors/tabs.ts`, `file.ts` | `select_tab`, `open_file`, `create_and_open_file`, `new_file` call the actions module; their mirrored switch logic is deleted. `save_file` uses `serializeSession`. |
| `src/renderer/lib/tools/executors/document.ts`, `editor.ts` | Every executor takes a `DocumentHandle` instead of calling `getEditor()`; `read_document` and `get_outline` serialise from the handle's state; `edit`, `insert`, `delete_node`, `accept_diff` emit annotation metas; the `documentId` they stamp comes from the handle's identity; effects that need a view check `handle.isActive`. |
| `src/renderer/hooks/useChat.ts`, `stores/chatStore.ts` | Tool calls resolve their handle from `conversation.documentId`; streaming state is keyed by conversation and the panel shows a stream only for the active document; `setCurrentDocumentId` keeps driving conversation autosave (4.14). |
| `src/shared/tools/registry.ts` | Unchanged in 1.9.0. The optional `target` parameter for MCP clients is the next epic's addition (4.15). |
| `src/renderer/components/layout/App.tsx` | `recoverSessionState`, `recoverDraft`, the converters and the focus check call the actions and session functions. The `editorInstance.commands.setContent` at line 714 becomes `replaceSessionDocument`. |
| `src/renderer/lib/diskSync.ts` | `loadDiskVersionIntoTab` calls `replaceSessionDocument`. |
| `src/renderer/lib/shareSync.ts`, `sharePush.ts`, `commentMerge.ts`, `openDocument.ts` | Address the session by `documentId`; `commentMerge` is unchanged in logic. (PR 3: done.) |
| `src/renderer/lib/diffUtils.ts` | Builds `annotations:add` metas. |
| `src/renderer/extensions/ai-annotations/*` | Store deleted except selectors; plugin owns records; `reanchor.ts` folds into the plugin's `RELOAD` handling. (PR 2: done; `reanchor.ts` stays as the text-index helpers `records.ts` calls.) |
| `src/renderer/extensions/comments/*` | Store deleted; plugin owns threads; `mergeCommentsForPersistence` becomes the persistence projection minus its empty-set safety net, which the design makes unnecessary. (PR 3: done.) |
| `src/renderer/extensions/ai-suggestions/store.ts` | Deleted. |
| `src/renderer/extensions/plain-text-mode`, `search-highlight`, `node-ids` | Section 6. |
| `src/renderer/components/CommentPopover.tsx`, `components/review/CommentReviewPanel.tsx`, `components/editor/AIEditsHistoryPanel.tsx` | Today each writes `pendingComments` with `setState`, calls `saveComments(store.documentId)` and pushes to the share (remove, resolve, reopen, reply). After: each dispatches a `thread:update` or `thread:remove` transaction on the active session; the projection persists and performs the push. (PR 3: done, as the `resolveThread` / `reopenThread` / `replyToThread` / `removeThread` commands.) |
| `src/renderer/lib/tools/executors/document.ts` (`list_comments`, `add_comment`, `resolve_comment`, `reply_to_comment`, `get_metadata`, `ensureInStore`) | Same change as the popover: thread writes become transactions; reads go through the session's threads state merged with the live marks, which is what `list_comments` already does by hand. (PR 3: done; `ensureInStore` deleted, orphan marks are adopted in `apply`.) |
| `src/renderer/components/editor/SelectionPopover.tsx` | The AI-authored toggle calls `removeAnnotationsInRange` and `addAnnotation`; it dispatches the `annotations:removeRange` and `annotations:add` metas instead. |
| `src/renderer/components/chat/ChatPanel.tsx`, `ChatInput.tsx`, `components/layout/StatusBar.tsx`, `stores/shareStore.ts` | Counts of open threads, annotations and live suggestions come from `useActiveSession` selectors. `countOpenThreads` keeps its signature. |
| `src/renderer/components/review/QuickReviewPanel.tsx`, `SideBySideDiffPanel.tsx`, `AISuggestionPopover.tsx`, `components/chat/ChatMessage.tsx`, `hooks/useChat.ts` | Already read suggestions from the live marks through `getAISuggestions(editor)` and call the mark commands. Unchanged, apart from `useChat` reading comment replies from the threads state rather than live marks only. |
| `src/renderer/components/share/ShareStatusPopover.tsx`, `ShareDialog.tsx`, `lib/shareArtifact.ts`, `components/layout/Toolbar.tsx` (export HTML) | Read threads for the active document from the session instead of guarding on two stores' `documentId` fields agreeing. `mergeCommentsForPersistence` keeps producing the export shape. |
| `src/renderer/lib/artifactImport.ts` | Writes IndexedDB before the load as today; the "if this is the open document, also set the store" branch becomes a `threads:merge` on that document's session when it has one. (PR 3: done; the merge base is the session's threads when the document is open.) |
| `src/renderer/hooks/useRemarkableSync.ts` | Line 89 updates an open document's content from a sync; it calls `replaceSessionDocument` with re-anchoring. Today that write goes through the same-document branch of the content-sync effect, which strips every mark and never restores them. |
| `src/renderer/components/editor/FrontmatterEditor.tsx` | Controlled by the tab's frontmatter. *PR 7: shipped (`{ frontmatter, onChange }`, value-compare sync).* |
| `src/renderer/components/editor/SourceEditor.tsx` | Accepts and returns a CodeMirror state so a tab's source view survives a switch. |
| `src/renderer/main.tsx` | Test seams re-pointed (section 12). |
| `src/renderer/lib/persistence.ts` | No schema change, no `DB_VERSION` bump. The three save functions are imported only by `session.ts`. |

Unchanged readers, listed so nobody looks for them: `App.tsx` undo and redo menu items, `lineNavigation`, `tableCommands`, `TableControls`, `FindBar`'s scroll helper, `editorViewState`, `diffUtils`' scroll helper. They read or scroll the active editor, which keeps meaning the active tab.

### 7.1 What the consumer inventory found

A read of every consumer on 2026-11-01 (branch `revert-1141`) turned up differences between paths that are supposed to do the same thing. Each is a defect the design removes by having one implementation, and each is a check for PR 1's review.

- Two tab-switch implementations disagree. `useTabs.switchToTab` persists comments through `mergeCommentsForPersistence` and skips empty suggestion sets; `executeSelectTab` persists raw `getComments` and unguarded suggestions.
- `open_file` does less than a switch: it saves only the outgoing conversation, never the outgoing content, comments, suggestions or annotations, and never loads comments for the new document. Its already-open branch re-reads the file from disk into the live editor and reloads annotations without the pause.
- Five paths load a document without loading its records and depend on the effects in `Editor.tsx` to notice: `useEditor.openFile` and `openFileFromPath` (annotations only), `newFile`, `new_file` (comments), session restore, `loadDiskVersionIntoTab`.
- Identity changes migrate inconsistently: `saveContentAs`, `quickSaveWithTitle` and `save_file` migrate annotations in memory and nothing else; `renameTab` copies comments and suggestions in IndexedDB but not in memory; the .txt and .md converters migrate nothing.
- The three record sets are keyed differently on the same switch: annotations save under the annotation store's own `documentId`, comments and suggestions under `activeTab.documentId`, and `sharePush` under `store.documentId` read after an `await`.
- The same-document branch of the content-sync effect (`Editor.tsx:665`, used by disk reload and reMarkable sync) strips comment and suggestion marks and nothing restores them, because the one-shot restore flags were already consumed.
- The `Editor.tsx` cleanup that snapshots suggestions for hot reload runs on every document switch, not only on unmount, because `document.documentId` is in its dependencies.
- Chat slash commands call `executeTool` with no provenance, so their edits create no annotations and their `suggest_edit` marks carry an empty `documentId`. Out of scope here; worth its own issue.

## 8. Deleted

Flags and timers: `isLoadingDocument`, `setLoadingDocument` and its eleven call sites, the 100 ms resume timers, `pendingSave`, `needsRestore`, `markRestored`, `isUpdatingFromStore`, `contentLoadInDispatch` and `aiReplacementInDispatch`, the `initialized` closure in node ids, the `currentAnnotations` and `activeTooltip` closures.

Refs in `Editor.tsx`: `lastDocumentIdRef`, `pendingViewRef`, `sourceWriteRef`, `latestSourceRef`, `sourceEntryRef`, `loadBaselineRef`, `savedSuggestionsRef`, `sourceDocIdRef`, `frontmatterRef`, `debounceRef` and `pendingWriteRef` (the debounce moves into the session), the `stableFrontmatter` state pair.

Effects in `Editor.tsx`: content sync, annotation load, suggestion load, suggestion restore, suggestion persist, comment load, comment restore, source-mode toggle, source-mode reset on switch.

Stores and functions: the suggestion store; the comment store; the annotation store's mutators and loaders; `saveCurrentTabState`; `flushPendingUpdate`; `reloadKeepingAnnotations`; the switch logic in `executeSelectTab` and `executeOpenFile`; `isPreviewTab` and `sourceMode` in `editorStore`; the microtask deferrals in the accept commands; the three `handleUpdate` copies in autosave.

Entry points that bypass the tab layer: `useEditor.openFile`, `openFileFromPath`, `newFile`, the reMarkable buttons, the executors' "existing tab" branch.

Chat and tools: the `onUpdate` write that discards itself when the active document changed, the document-id capture in `useChat` at call time, `editorStore.readCache`, `getEditor()` in the executors.

## 9. TipTap 2 and 3

Nothing in this design depends on the TipTap major. `EditorState.create`, `state.applyTransaction`, `view.updateState`, plugin state, `tr.setMeta` and `addToHistory` are ProseMirror. TipTap's wrapper reads `view.state` in both 2.27 and 3.32, so `editor.state`, `editor.commands` and `editor.chain()` follow the swapped state.

What changes for the later TipTap 3 PR because this landed first: the `setContent` calls that remain are the tool executors' `insertContent` family and the initial empty editor, so the `emitUpdate` default flip touches almost nothing; components already read through selectors, so `shouldRerenderOnTransaction: false` costs nothing; the package moves (`@tiptap/extension-table` named exports, `@tiptap/extension-list`, `@tiptap/extensions`) are import edits; the StarterKit Link and Underline duplication is a configuration edit; the two `getPos()` sites gain an undefined check.

## 10. Risks

- **PR 1 is a single large change on one seam.** Every open and switch path must convert in the same PR, because the content-sync effect it deletes is what today's paths rely on. Mitigation: the actions module is written first with the existing stores behind it; the PR is reviewed as "every entry point goes through one function" and the acceptance suite in section 12 runs on it before anything else lands.
- **Memory.** One `EditorState` per open tab holds a document and up to 100 undo steps. Documents share structure with their history and a large markdown file is a few megabytes of nodes. Lazy sessions keep launch cost proportional to one document. Measure with 20 tabs open in PR 1.
- **Activation cost.** `updateState` with a different document re-renders the whole editor DOM and rebuilds node views. That is strictly less than today's serialise, parse and `setContent`. Measure the switch time in the pipeline log in PR 1 and assert no `getMarkdown` call during a switch.
- **Plugin instance closures.** Any per-instance mutable variable in a plugin becomes cross-tab state the moment two states share the instance. The ones that exist are listed in section 8; the review checklist for every later plugin change asks the question.
- **Undo across source exit.** One replace step means undo after exit reverts the whole source edit. That is today's behaviour too, since `setContent` is one step. Stated, not changed.
- **Specs encode today's timing.** Fixed waits of 300, 700, 800, 1200 and 1500 ms in the tab, comment and suggestion specs assume the 500 ms markdown debounce and the 100 ms restore timers. The debounce is kept; the timers go away, which can only make those waits generous. Specs that poll `isAnnotationMappingPaused()` keep working because the seam returns false.
- **Share sync for documents open in a background tab** changes from "skipped" to "merged in place". That is the intended behaviour, but it is new, so it gets its own probe.
- **A chat turn in flight on a tab that is closed or renamed.** Rename is an identity transaction the handle follows. Close reopens the tab in the background when it has a path and fails the remaining calls when it does not (4.14). Both get a probe.
- **The `editorStore.document` mirror can drift** if a path writes it directly. The tripwire spec that greps for direct persistence calls also greps for `setDocument({` outside the session and actions modules.

## 11. Delivery

Each PR is one issue, renderer-only (no security gate), green CI plus a review before merge, and leaves the app shippable. Tracking: child issues of #1094, filed 2026-11-01, one per PR (numbers in the table); #1153 is the gated dialog and clipboard follow-up from the Electron audit; #1132 and #1138 are subsumed by PRs 6 and 2 and close from the `release/v1.9.0 → main` PR like every other child.

| PR | Scope | Closes or unblocks | Size |
|---|---|---|---|
| 0a (#1143) | Electron 45 and the root-lockfile sweep (section 1.1) | 32 of 36 alerts | Small, ungated |
| 0b (#1144) | Gateway lockfile, Node 22 on the e2e runner, remaining bumps | The last 4 | Small |
| 1 (#1145) | Session layer: `session.ts`, identity plugin, `openSession` with load-time re-anchoring, `activateSession`, projections, `tabs/actions.ts` with every lifecycle flow, executors rewritten against `DocumentHandle` with the target fixed to the active tab, `useEditor` onto the actions, `Editor.tsx` without the content-sync effect. The three annotation stores stay as mirrors written only by `projectSession`, so the contamination class closes here even before the plugins move. Includes the vitest harness for `openSession` and the projections (#820). | Section G, #1103 residue, the #1127 class; unblocks everything below | Large: roughly 1000 lines added, 900 removed across 14 files; 4 days of agent work plus a QA pass |
| 2 (#1146) | AI annotations into plugin state; metas; `RELOAD` re-anchoring; history panel on selectors | #1138 | Medium: 2 days |
| 3 (#1147) | Comments into plugin state; auto-resolve in `apply`; share paths by `documentId`; comment follows an AI replacement | #1122, the #1137 class | Medium: 2 to 3 days |
| 4 (#1148) | Chat binding: handles resolved from the turn's binding; stream keyed by conversation; background reopen of a closed tab; reads serialise the handle's state (4.14; `readCache` was already gone) | The switched-tab chat failure | Medium: 2 to 3 days |
| 5 (#1149) | Suggestions: delete the store; restore at load; projection from marks | #1126 class | Small: 1 day |
| 6 (#1150) | Source mode per tab; CodeMirror state per session; untouched exit; history as one step | #1132, part of #885 | Medium: 2 days |
| 7 (#1151) | Frontmatter on the tab; dirty and autosave from the projection; delete `isPreviewTab` and `sourceMode` globals; controlled `FrontmatterEditor` | #1104, #1105 | Small to medium: 1 to 2 days |
| 8 (#1152) | Seams, tripwires, `CLAUDE.md` and this document trued up, dead code removed | #822 in part | Small: 1 day |
| Next epic, first | TipTap 3 with `tiptap-markdown` 0.9.0 and `tiptap-footnotes` 3.0.1 (section 1.2) | #866 | Medium: 1 to 2 days plus the comment and suggestion QA the issue asks for |
| Next epic, second | `target` parameter on the tool schemas for MCP clients (4.15) | None open | Small: 1 day |

Total for 1 to 8: about 14 to 18 agent-days, three weeks elapsed with one QA pass per PR on the dev server. The estimate for PR 1 is the least certain; the others are bounded by files already read.

What proceeds in parallel: section B of the reset outline (#1107, #1119, #1133, #1108, #1109, #1110, #1111, #1134, #1135, #862, #1113, #1139) touches the serializer, the tool pipeline, panels and the main process, none of which these PRs edit. #1106 (find bar) waits for PR 1 because it touches the search-highlight plugin state. The security track in 1.1 proceeds on its own.

What waits: #885 beyond the switch path (per-keystroke serialisation is now a 500 ms debounce, never a switch; incremental dirty tracking is a later item), the `@tiptap/markdown` evaluation (#823), TipTap 3 (#866) and the MCP `target` parameter, which open the next epic, and the operator's release tail in section C of the reset document.

## 12. Acceptance

Existing specs that must stay green, by what they pin: `electron.tab-caret` (selection and scroll across switch and relaunch, frontmatter hop), `electron.tab-switch-flush` (typing before a tab click), `electron.comment-occurrence` (right occurrence after a switch), `electron.comment-auto-resolve` (delete resolves, AI accept keeps anchor-lost, source toggle keeps the thread), `electron.comment-threading` (reply, resolve, reopen), `electron.share-sync` (pull merge, tombstones, no resurrection), `electron.source-mode-authority` (11 tests: caret, byte-exact save, comments and annotations across a round trip, no leak across `select_tab`, untouched toggle), `electron.suggestions-persist`, `electron.suggestions`, `electron.restructure`, `electron.ai-provenance`, `electron.ai-edit-lifecycle` (accept annotates, counts hold across `select_tab`, rename migration, relaunch), `electron.activity-panel`, `electron.node-ids`, `electron.tables` (tool part), `electron.stale-paths` (seeded session restore), `electron.file-explorer-qa`, `electron.explorer-interactivity`, and the five web specs.

New spec `electron.document-sessions.spec.ts`, each case falsified against the current code first where the current code can fail it:

1. Two documents each with annotations, comments and suggestions. Switch between them twenty times with an edit in each on every visit. Each IndexedDB key holds only its own records, byte for byte, and no key holds another document's `anchorText`. This is section G.
2. Edit above a highlight in A, switch to B, type, switch back. A's highlight is on its words; B's records are untouched.
3. Open A in source mode, switch to B, return. A is still in source mode with its caret; exiting without changes writes nothing and does not dirty A.
4. Exit source mode with an edit; one undo restores the pre-edit document; annotations and comments whose text survived are attached.
5. Relaunch with five tabs. Each restores its records keyed to itself; only the active tab has a session before it is clicked.
6. A share pull for a document open in a background tab lands in that tab's state and IndexedDB; activating it shows the merged thread without a reload.
7. Rename an open tab, then Save As an untitled one: records migrate and the live state carries the new id.
8. `select_tab`, `open_file` and the tab bar produce identical tab, store and IndexedDB state for the same sequence.
9. A frontmatter-only edit dirties the tab and autosaves in auto mode.
10. The pipeline log for a tab switch contains no serialisation event, and twenty open tabs stay under an agreed memory ceiling.
11. Start a chat turn that edits document A and switch to B before it finishes. The edits, suggestions and annotations land in A's state and IndexedDB, B is untouched, the stream appears under A's conversation when A is active again, and the pipeline log shows every call resolved to A's document id.
12. Close A's tab mid-turn. A saved A reopens in the background and receives the rest of the turn; an untitled A fails the remaining calls with an error naming it, and nothing lands in B.

Tripwires (source-text specs in the style of the existing ones): the three IndexedDB save functions are imported only by `session.ts`; `view.updateState` and `EditorState.create` appear only in `session.ts`; `setDocument({` appears only in `session.ts` and `tabs/actions.ts`.

Test seams keep their names and are re-pointed: `__prose_tools.getAnnotations` and `getAnnotationDocId` read the active session; `getCommentStore` and `getCommentDocId` read the comments plugin state; `isAnnotationMappingPaused` and `getCommentStoreNeedsRestore` return false until the specs that poll them are updated, then they are removed; `loadAnnotationsFromDB` is unchanged; `__prose_share.sync` and `deleteThread` go through the session.

## 13. Decisions

Taken on 2026-11-01 with the operator. Each is reversible by editing this section and the PR sequence; none is encoded anywhere else.

1. Per-tab `EditorState` with annotations in plugin state (Option 1), in 1.9.0, before the remaining polish. Section 3.
2. Pre-flight is Electron 42 plus the dependency sweep, and only that. The other security items run as a parallel track and never gate an editor PR. Section 1.1.
3. TipTap 3 opens the next epic; it does not ride 1.9.0. `tiptap-markdown` 0.9.0 is kept; `@tiptap/markdown` is a separate spike under #823. Section 1.2.
4. Sessions for restored tabs open lazily; only the active tab's session opens at launch. Section 4.10.
5. PR 1 introduces the vitest harness for `openSession` and the projections (#820), the first editor code that is a pure function.
6. `editorStore.document` stays as a mirror of the active tab after PR 8. Readers migrate to tab and session selectors as they are touched, not in this epic.
7. A chat conversation's tool calls bind to the conversation's document through `DocumentHandle`, and its stream is keyed to the conversation, so a tab switch mid-turn changes nothing about where the turn lands. In 1.9.0 as PR 4. Section 4.14.
8. MCP clients keep addressing the active tab in 1.9.0. The explicit `target` parameter is the next epic's second item, after TipTap 3. Section 4.15.
9. Executors are written against `DocumentHandle` from PR 1, so decisions 7 and 8 change only how a handle is resolved.
10. Undo across a source-mode exit stays one step, as today. Section 4.9.
11. Section B of the reset outline proceeds in parallel with PRs 1 to 8; #1106 waits for PR 1. Section 11.
