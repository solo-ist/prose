# #1145 — code inventory behind the plan (2026-11-01, read on `release/v1.9.0` = `9699d4b`)

Three read-only passes over the renderer, condensed to what the implementation needs. Line numbers are from
that commit; they drift as the branch moves, the function names do not. See `plan.md` for what is done with it.

## 1. `Editor.tsx` (1778 lines)

Editor creation `useTipTapEditor` 338–554: no dependency array, `<Editor>` mounted once without a key
(`App.tsx:957`), so the editor is created once per run. `setOptions` runs on every render (new extension
instances fail `compareOptions`) but never rebuilds extensions; that is why `bulletListMarker` is patched by the
effect at 777–783. Extensions 339–440 in order: StarterKit (document off, codeBlock off), DocumentWithFootnotes,
CodeBlockLowlight, Placeholder, Link, Underline, Superscript, Subscript, Table/Row/Header/Cell, TableCellKeymap,
TableTrailingParagraph, TaskListDashMarker (167–177), TaskItem, Footnotes/Footnote/FootnoteReference, Markdown
(388–394; `bulletListMarker` is the only setting-derived option), FocusMode, Comment.configure({ onCommentAdded,
onCommentBlocked }) (396–424: mirrors into `pendingComments`, `saveComments(store.documentId)`,
`pushNewThreadToShare`), AISuggestion, AIAnnotations({ showTooltip }), NodeIds, SearchHighlight, LinkHover,
PlainTextMode, ImageWithUpload, PersistentSelection. `content: initialContent` (mount-only memo 295–298, also
seeds `frontmatterRef`). `editorProps` 442–502: `clipboardTextSerializer` (120–152, reads the instance store's
serializer), `handlePaste` (447–492, reads sourceMode / isRemarkableReadOnly / isPreviewTab / documentId, then a
`setTimeout(0)` guarded on the active id), `handleDOMEvents.mousedown` → `promoteCurrentPreview()` when
`isPreviewTab`.

`onUpdate` 505–553: bail on `isUpdatingFromStore` (506) or `sourceMode` (509); capture the document id (515);
`write()` 522–544 discards when the active id changed (525–528), `getMarkdown()` (530), keeps
`loadBaselineRef.content` when the serialisation matches the baseline (533–537) else `frontmatterRef.current +
markdown`, `editorStore.setContent(full)` (543); `pendingWriteRef` (547) and a 500 ms timer (548–552). Note
`editor.setEditable()` emits `update` by default, so the editability effect (767–770) also fires it.

Content-sync effect **579–696**, deps `[editor, document.content, document.documentId]`: 584–588 parse +
`currentMarkdown`; 591–601 `isNewDocument` (writes `lastDocumentIdRef`, sets `pendingViewRef` from
`getActiveTab().viewState` when the tab's id matches); 610–616 source-mode echo branch (`sourceWriteRef`,
`latestSourceRef`, `setSourceContent`); 624–630 `matchesBaseline`; 631 `if (newBody !== currentMarkdown &&
!matchesBaseline)`: 632 flag on, 633 `frontmatterRef`, 637–638 **`editor.storage.plainTextMode.enabled =
path.endsWith('.txt')`** (the only writer of that flag), 646–662 new-document branch (`setContent(newBody)`,
`EditorState.create({ doc, plugins: editor.state.plugins, schema })`, `view.updateState`,
`restoreEditorViewState(pendingViewRef)`), 663–666 same-document branch (`setContent` only, keeps history,
strips marks), 668 flag off, 669–673 `loadBaselineRef = { documentId, markdown: getMarkdown(), content }`, 681
`setLoadingDocument(false)`, 685–688 `.overflow-auto` `scrollTop = 0` unless `pendingViewRef`; 689–691 same body
with a pending view → restore in place; 692–695 frontmatter-only change. Never calls `setEditable`; never
touches the comment/suggestion restore flags (their effects re-fire on `document.content`).

Other effects: 320–336 `stableFrontmatter` same-doc re-sync (render-time sync 314–318); **702–738** register
instance + `selectionUpdate`/scroll → `scheduleSaveSession`, `flushPendingUpdate` registration (713–721),
cleanup snapshots suggestions for HMR (731–736) — runs on every document switch because `document.documentId`
is a dep; 743–764 selection cache + cursor; 767–770 editability; 777–783 bullet marker; 786–805 reMarkable link
lookup; **811–820** annotation load (`setDocumentId` then `loadAnnotations`); **823–836** suggestion load;
**839–864** suggestion restore (content gate, 100 ms, `restoreAISuggestions`, `clearSuggestions`); **872–916**
suggestion persist (`editor.on('transaction')`, 500 ms, immediate on `AI_SUGGESTION_RESOLVED_META`, skips while
pending non-empty, empty set only via `deleteSuggestions` after a resolve); **921–934** comment load; **940–970**
comment restore (needsRestore, same id, content, 100 ms, `markRestored`); 973–1016 focus pass (consumes
`pendingViewRef`; `focus(undefined, { scrollIntoView: false })` at 1000); **1019–1101** source-mode layout
effect (entering 1025–1042: `savedSuggestionsRef`, `sourceDocIdRef`, baseline-or-live markdown, `latestSourceRef`
= `sourceEntryRef`; exiting 1043–1100: id mismatch → bail, unchanged → bail, else `parseMarkdown`,
`setFrontmatter`, `reloadKeepingAnnotations(editor, () => setContent(bodyOnly))` (1072), `loadBaselineRef`
(1077–1085), `setContent`, 50 ms later `restoreAISuggestions(saved)` + `restoreComments(pending)`); 1106–1108
`setSourceMode(false)` on id change; 1111–1117 unmount clears the debounce; 1422–1429 focus on leaving empty
state. `handleSourceChange` 1432–1443 (guard on `sourceDocIdRef`, `latestSourceRef`, `setSourceContent`,
`parseMarkdown`, `sourceWriteRef = body`, `setContent(body)`, `setDocument({ frontmatter })`).
`handleFrontmatterSave` 1447–1458 (`setFrontmatter`, `setStableFrontmatter`, `frontmatterRef = ''`,
`setContent(getMarkdown())`).

Refs: `debounceRef` 237, `pendingWriteRef` 239, `isUpdatingFromStore` 240, `frontmatterRef` 241,
`lastDocumentIdRef` 242, `pendingViewRef` 245, `sourceWriteRef` 248, `latestSourceRef` 251, `sourceEntryRef` 253,
`loadBaselineRef` 259, `sourceContent` state 274, `savedSuggestionsRef` 276, `sourceEditorRef` 277,
`sourceDocIdRef` 282, `stableFrontmatter` 305–318, `hasFocusedRef` 973, `prevSourceModeRef` 1019.

Kept: module helpers 120–222, `openAddCommentDialog` 557, `openLinkPopover` 567, `handleKeyDown` 1120–1366,
menu/window events 1369–1394, `showEmptyState` 1402, `showFrontmatter` 1412, paste-AI handlers 1460–1505, JSX
1507–1778. reMarkable **Edit** 1561–1607 (`remarkableCreateEditableVersion`, `setRemarkableReadOnly(false)`,
explorer `setViewMode/setRootPath/selectFile`, `readFile` → `parseMarkdown` → `generateIdFromPath`,
**`setDocument({...})` 1590**, `setEditing`); **View Original** 1614–1657 (`remarkableGetOCRPath`,
`setRemarkableReadOnly(true, id)`, `readFile`, **`setDocument` 1644**). Both replace the active tab's document in
place and bypass the tab layer.

`editorInstanceStore.ts` (30 lines): `editor`, `setEditor` (also `window.__prose_editor`, 27),
`flushPendingUpdate` (only caller `useTabs.ts:101`). No `getEditor`; the executors have two private copies
(`document.ts:26` ignores source mode, `editor.ts:154` returns null in source mode).

`tiptap-markdown` 0.8.10: `onBeforeCreate` builds `storage.markdown = { options, parser, serializer,
getMarkdown }`; `parser.parse(md)` → `parse.setup` hooks → markdown-it → `window.DOMParser` → `parse.updateDOM`
→ `normalizeDOM(editor.schema)` → **returns an HTML string**; the core's `setContent` turns it into a node with
`createDocument(html, schema)` (exported by `@tiptap/core`). The parser and serializer read only
`extensionManager.extensions`, `schema`, `storage.markdown.options`; `editor.state` appears only in
`getMarkdown()`. `serializer.serialize(anyDoc)` works for a document not in the view. Call sites of
`storage.markdown` / `getMarkdown`: Editor.tsx 147–150, 530, 588, 671, 779, 1033, 1082, 1456;
`ai-suggestions/extension.ts:50,61` (parser → DOMParser → slice); `executors/document.ts:69`; `tabs.ts:136-137`;
`file.ts:49`. `lib/markdown.ts parseMarkdown` (14) only splits frontmatter (callers: App 889, Editor 1068/1439/
1588/1642, useRemarkableSync 74, useTabs 416/556, useEditor 92/156, diskSync 86, file.ts 104/135, editor.ts 822).

`plain-text-mode/index.ts`: storage `{ enabled }` 31–35, `appendTransaction` 44–107 reads `extension.storage`;
readers: the plugin and `executors/editor.ts:211` (`isPlainTextDocument`). `node-ids/index.ts`: `initialized`
closure at 51, `appendTransaction` 56–124 (first run or `docChanged`; a doc-changing transaction fills every
null id and dedupes). `SourceEditor.tsx`: `SourceEditorHandle { getContent }` 12–14, props 16–24 (`content`,
`onChange`, `fontSize`, `lineHeight`, `fontFamily`, `isDark`, `readOnly`); the CodeMirror view is recreated on
style deps; its own debounce is cleared, not flushed, on unmount; external content applied as a minimal diff
310–330; `EditorState.create` at 264 is CodeMirror's (exclude from the tripwire).

Tripwire sites today: `view.updateState` Editor 660; PM `EditorState.create` Editor 655; `commands.setContent(`
Editor 652/665/1072, App 714; `setDocument({` App 417/715/751, Editor 1442/1590/1644, useRemarkableSync 89,
useEditor 94/158/229/410, file.ts 106/172/241/350, tabs.ts 180, useTabs 199/297/457/589/655/1004/1075,
diskSync 112. `setLoadingDocument` callers: main 52 (seam), reanchor 119/120/124, Editor 681, useTabs
185/247/276/338/393/397/404/491/545/569/610/625/676/1065/1105, file.ts 127/202/225/272, tabs.ts 169/215,
store 80/103.

## 2. Tabs: types, store, flows

`Tab` (`tabStore.ts:9-23`): `id`, `documentId`, `path | null`, `title`, `baseTitle?`, `isDirty`, `isPreview?`,
`content?`, `frontmatter?`, `cursorPosition?`, `viewState?: EditorViewState` (22). `ClosedTabSnapshot` 26–35
(no documentId; max 10). `TabDraft` (`persistence.ts:36-49`): `tabId`, `documentId`, `path`, `title`,
`baseTitle?`, `content` (required), `isDirty`, `frontmatter?`, `cursorPosition?`, `viewState?`, `activeChatId`;
no `isPreview`. `SessionState` 52–57 under key `'session'` in `drafts` (legacy draft key `'current'`).
Actions: `addTab` 114–127 (**activates**), `removeTab` 129–155 (same index else last), `setActiveTab` 157,
`updateTab` 165, getters 173–191, `promotePreviewTab` 193, `pushClosedTab` 77, `popClosedTab` 84,
`reopenLastClosedTab(snapshot, documentId)` 92–112, `closeOtherTabs` 248, `closeAllTabs` 255.
`persistSession` 292–322 reads `tabs`, `activeTabId`, `chatStore.activeConversationId`, the nonexistent
`chatState.currentDocumentId` (#1162), `captureEditorViewState(editor)` for the active tab (fallback
`tab.viewState`); content from the `tab.content` cache. 1 s debounce 346–356, armed by the subscription 359–368
and by Editor 709–711. No flush on quit. `lib/editorViewState.ts`: capture 24–31, restore 38–51 (selection
only).

`editorStore.ts`: `document = { documentId, path, content, frontmatter, isDirty }` (87–95); `setDocument`
113–128 (merges; always clears `readCache`; clears `pendingFrontmatter` on id change; derives reMarkable
read-only from path, 15–23); `setContent` 130–143 (`isDirty = true` only on change); `setFrontmatter` 158–161
(always `isDirty: true`); `resetDocument` 176–187; `hydrateFromDraft` 189–199; `readCache` + `getCachedRead` /
`updateReadCache` / `invalidateReadCache` 202–230 (no callers); `setPreviewTab` 238, `setSourceMode` 243,
`setPendingFrontmatter` 247. Legacy draft autosave subscriptions 277–319. `content` is the full text
(frontmatter block + body) as `onUpdate` writes it.

`useTabs.ts` flows (shared pattern: `setLoadingDocument(true)`, annotation `setDocumentId`, activate,
`setDocument` + cursor + `setCurrentDocumentId`, await chat / annotations / suggestions / comments loads,
`setEditing`, explorer reveal, 100 ms timeout then flag off; no flow records a disk baseline):

- `saveCurrentTabState` 94–157: live active tab (95), `flushPendingUpdate` (101), `saveCurrentConversation`
  (closure `document`, 112), annotations after the in-flight save under **the store's own id** (117–119),
  suggestions under **`activeTab.documentId`** only if non-empty (126–136), `mergeCommentsForPersistence` under
  **`activeTab.documentId`** always (140–144), `updateTab({ content, frontmatter, cursor, viewState, isDirty })`
  (149–156).
- `switchToTab` 162–249: early return on closure `activeTabId` (164); leaving → `saveCurrentTabState` (174);
  arriving → flag (185), annotation id (192), `setActiveTab` (195), `setDocument` from the tab cache, **no disk
  read** (199–205), cursor (207), chat (212–213), three loads (217–227), `setPreviewTab(target.isPreview)` (234),
  `setEditing` (237), reveal (240), timeout (246).
- `createNewTab(init?)` 263–342: save current (273), flag, `addTab` (281–290), id, `setDocument` (297), chat
  reset (309–314), `clearAnnotations` (317), suggestion/comment `setDocumentId` (320/323),
  `setRemarkableReadOnly(false)` (326), `setPreviewTab(false)` (331). `FileListPanel.tsx:1460` passes it as an
  onClick (event as `init`, harmless).
- `isEmptyUntitled` 348–365 (reads the cache; lags the editor by the debounce).
- `openFileInTab(path)` 371–498: already open → `promoteCurrentPreview()` if a preview is involved, then
  `switchToTab` (373–381); empty untitled → replace without saving it (384–385) else save (388); flag; `readFile`
  (402; missing → `handleMissingPath`); `generateIdFromPath` (412); `resolveOpenedFileContent` (artifact import +
  `.txt`, 415); `parseMarkdown` (416); replace via `updateTab` (427–438, leaves `baseTitle`/`isPreview`) or
  `addTab` (441–449); loads; `addRecentFile` (484); returns "should auto-describe" (495). Does not reset
  `isPreviewTab`.
- `openFileInPreviewTab(path)` 507–681: `setPreviewTab(true)` (509), save chat-panel state once (512–514),
  `setPanelOpen(false)`; in a permanent tab → `switchToTab` (518–523, which flips `isPreviewTab` back); already
  the preview → switch (526–533); read failure → `restoreAfterPreviewBrowsing` (536–551); replace the existing
  preview in place (564–615: `updateTab(isPreview: true)`, `setActiveTab`, loads; old preview not snapshotted or
  cleaned); no preview yet → replace empty untitled or save current, `updateTab`/`addTab` with `isPreview`
  (618–680).
- `closeTab` 687–738: dirty → false (caller confirms); snapshot from the **cache** for non-preview (697–709);
  `removeTab` (715); untitled → delete four keys (718–723); last tab → `createNewTab` (727); was active →
  `switchToTab(new active)` (729–735) → finding A. `forceCloseTab` 743–786 same without the dirty check.
  `closeOtherTabs(keep)` 791–830 (closure `tabs`; snapshots incl. dirty; deletes keys only for clean untitled;
  `switchToTab(keep)` 827). `closeAllTabs` 835–869 (`createNewTab` finds no active tab, nothing flushed).
- `syncActiveTabWithEditor` 874–910 (effect 913–915 on `isDirty`/`path`/`content`): auto-promotes a preview when
  dirty (879–881); `updateTab({ isDirty, path, title, content, frontmatter })`; never syncs `documentId`, cursor,
  viewState. The patch layer every in-place `setDocument` writer relies on.
- `renameTab(tabId, newTitle)` 921–1026: path required; sanitise, keep extension; `fileExists` refuse;
  `api.renameFile` (949); if ids differ copy annotations (re-keyed), conversations, suggestions, comments in
  IndexedDB (964–986, old keys kept); `shareUpdateLocalPath` (991); `updateTab({ path, title, documentId })`
  (995); if active: annotation `setDocumentId`, `setDocument({ ...closure document, path, documentId })`,
  `setCurrentDocumentId`, re-point in-memory annotations (1003–1014). Not: suggestion/comment store ids,
  conversations' own `documentId` field, baselines.
- `reopenLastClosedTab` 1039–1107: `popClosedTab` first; path open → switch; id = path hash or fresh; save
  current; store reopen; `setDocument` from the snapshot (**no disk read**); loads. Not: `isPreviewTab` reset,
  baseline, recent file.
- `promoteCurrentPreview` 57–63, `restoreAfterPreviewBrowsing` 45–51 (callers Editor 497, useTabs 377/880).

Callers outside useTabs: `openFileInTab` App 675/833/870, FileListPanel 763/992, ProjectsPanel 371;
`openFileInPreviewTab` FileListPanel 754/296/303 (useExplorerActions 118/196/347/361/380), ListFilesResult 123;
`switchToTab` Toolbar 172; `closeTab` Toolbar 184 (Cmd+W via `menu:closeTab`), useExplorerActions 71 (wired to
`forceCloseTab` at FileListPanel 310); `forceCloseTab` Toolbar 195/202, FileListPanel 310/363;
`closeOtherTabs`/`closeAllTabs` Toolbar 217/232/226/234; `renameTab` Toolbar 539 → TabBar 130,
`window.__prose_renameTab` Toolbar 118; `reopenLastClosedTab` App 813; `createNewTab` Toolbar 284/541, App
500/606/620/647/668/860/890, FileListPanel 1460. Direct `tabStore` writes outside useTabs: App 192/302/397/441/
724/760, FileListPanel 564/584/677 (rename/move: path + title only), useRemarkableSync 78, diskSync 110, file.ts
96/151/160/231, tabs.ts 140/177, TabBar 86 (double-click → store `promotePreviewTab`, no flag/chat restore).

## 3. Executors, useEditor, App, background writers, autosave

`executors/tabs.ts`: `executeListTabs` 36–50; `executeSelectTab` 57–227: find by id or unique title/file match
(61–111), active → no-op; leaving: `serializeMarkdown(getMarkdown(), frontmatter)` (135–138, always serialises),
`isDirty = doc.isDirty || liveContent !== document.content` (145), `updateTab` (139–147), conversation (148),
annotations (151–153), **suggestions unguarded** (156), **raw `getComments`** (157); arriving: flag (169), id
(174), `setActiveTab` (177), `setDocument` (180), cursor, chat + loads (196–200), **`setRemarkableReadOnly(false)`**
(203), `setEditing`, reveal, timeout; no `setPreviewTab`.
`executors/file.ts`: `executeOpenFile(args, access)` 70–209: already open (94–120: `setActiveTab` before any
save, **re-reads from disk**, `setDocument(isDirty false)`, no comments/pause/cursor/preview/reveal); new file
(saves **only the conversation** 123, flag 127, read with `access` 131, inline `isEmptyUntitled` 145, replace
without cursor 150–158 or `addTab` 160–168, `setDocument` 172, loads without comments 184–186,
`setRemarkableReadOnly(false)` 189, recent file, reveal, timeout). `executeNewFile` 214–282 (conversation only;
`addTab` without `baseTitle`/frontmatter 231; `clearAnnotations` 261 without id; comment store untouched;
`setRemarkableReadOnly(false)` 265). `executeSaveFile` 287–360 (`serializeMarkdown(store content)` 297, no
flush / `.txt` case / guard; path from args / document / dialog 302–316; on path change migrates conversations +
annotations 321–348, `setDocument({ documentId, path })` 350; not suggestions, comments, `tab.documentId`).
`executeCreateAndOpenFile` 461–542 (sanitise 475, folder 485, `name N.md` 488–498, `saveToFolder` 501,
`executeOpenFile` 504, `waitForEditorDocumentContent` 43–63, `addAnnotation` 516–535).
`executors/document.ts`: `getEditor` 26; `executeReadDocument` 81 (live editor + `document.content` /
frontmatter / `pendingFrontmatter`; no readCache), `executeReadSelection` 148, `executeGetMetadata` 196,
`executeSearchDocument` 249, `executeGetOutline` 339, `executeListComments` 409, `executeAddComment` 460,
`executeResolveComment` 590, `executeReplyToComment` 640; 9 `getEditor()` calls. `executors/editor.ts`:
`getEditor` 154, `isEditorReadOnly` 166, `resolveToolPosition` 281, `executeEdit` 341, `executeInsert` 517,
`executeSuggestEdit` 754, `executeAcceptDiff` 1060, `executeRejectDiff` 1106, `executeDeleteNode` 1152,
`executeMoveCursor` 1226, `executeListDiffs` 1278; 9 calls. Dispatch `executeTool(name, args, mode, provenance?)`
`lib/tools/index.ts:63` (switch 94, file/tab tools 136–152); `ToolProvenance` `{ model, conversationId,
messageId, documentId }` (`provenanceTypes.ts:7-12`); callers `useChat.ts:366` (documentId from editorStore at
331), `App.tsx:908` (MCP), `ChatInput.tsx:370,493` (no provenance, #1156), `main.tsx:45` (seam).

`useEditor.ts`: `buildSaveContent` 31–40 (`.txt` raw, else `serializeMarkdown(content, frontmatter)`);
`openFileFromPath(path, isOCR)` 78–139 (conversation, read, `resolveOpenedFileContent`, **`setDocument` in place
94**, `setRemarkableReadOnly(false)` unless OCR, baseline 109, conversations + annotations without id/pause,
`clearDraft`, recent, reveal); `openFile` 141–195 (same via the dialog; baseline 170); `saveContentAs` 197–242
(dialog; migrate conversations 203–214 and annotations 217–227; `setDocument({ documentId, path })` 229;
baseline 232); `saveFile` 244–280 (store content, no flush; `isDiskNewerThanBaseline` → conflict 252–255; save,
`setDirty(false)`, baseline; missing → `handleMissingPath` + Save As); `saveFileAs` 282; `newFile` 291–311
(`resetDocument`, chat reset, `clearAnnotations`; only caller EmptyState 27); `quickSaveWithTitle` 313–427
(TabBar 134; rename = write new + delete old 366–374; collision names 339–363; baseline 381; migrate as Save As
385–408; `setDocument` 410; `clearDraft`).

`App.tsx`: `recoverSessionState` 350–460 (per draft: missing → `handleMissingPath('restore')` 362–366; stale clean
→ `readDocumentFromDisk` + baseline 373–381; stale dirty → `notifyRestoreConflict` 382–390; else baseline 393;
`addTab` 397–408 activates each; active tab `setDocument` 417 + conversations 427–435, no cursor/record loads;
`setActiveTab` 440; dead `fileList` branch 445–455; `tabsInitialized` 457). `recoverDraft` 286–338
(`hydrateFromDraft` 288, `addTab` 302 without frontmatter/`baseTitle`, fileList 313–324, conversations 327).
`convertToTxt` 696–736 (`editor.getText` 705, rename + save 706, new id 710, **`commands.setContent` 714**,
`setDocument` 715, `updateTab` 722; no migration/flush). `convertToMarkdown` 737–768 (same shape, `setDocument`
751, `updateTab` 760). Focus-time stale check 156–178 (baselines only, finding D). Conflict dialog 183–211
(overwrite / `loadDiskVersionIntoTab`). Menu wiring 668–898 (`prose://` → `createNewTab` 886–898).

`diskSync.ts`: `readDocumentFromDisk` 75–91 (HTML extraction + `.txt`, no artifact import);
`loadDiskVersionIntoTab(tabId, path)` 98–121 (every tab `updateTab` 110; active tab `setDocument` 111–119 with the
same id → Editor's same-document branch strips marks; baseline 120). `useRemarkableSync.refreshOpenOcrTab`
57–96 (`updateTab` 78; active `setDocument` without id 87–94; no baseline).

`useAutosave.ts`: `handleUpdate` copies 110–122, 167–173, 200–206 (1500 ms); auto mode arms on
`editor.on('update')` 124/175/208; custom mode subscribes to `{ isDirty, path }` 132–148; `performSave` 30–82
(`serializeMarkdown`, no `.txt` case; guard → conflict toast; `setDirty(false)` + baseline); `forceSave` 229.

## 4. Records: persistence, stores, matchers

`persistence.ts`: `DB_NAME 'prose-db'`, `DB_VERSION 9` (68); stores `drafts`, `conversations`, `annotations`,
`command_history`, `suggestions`, `emoji_cache`, `summaries`, `comments` (69–78). `saveSession` 598 /
`loadSession` 614 / `clearSession` 634; `saveConversations` 652 / `loadConversations` 671 /
`deleteConversations` 693; `saveAnnotations(documentId, AIAnnotation[])` 724 / `loadAnnotations` 747 /
`deleteAnnotations` 774; `saveSuggestions` 849 / `loadSuggestions` 878 / `deleteSuggestions` 908;
`saveComments` 933 / `loadComments` 962 / `deleteComments` 992; `generateId` 520, `generateIdFromPath` 528
(SHA-256 of the path, 36 hex). No copy/migrate helpers; callers compose load + save. Direct importers of the
record functions: `ai-annotations/store.ts:9`, `comments/store.ts:11-13`, `ai-suggestions/store.ts:11-13`,
`useTabs.ts:25-36` (all twelve; rename copy 966–977; deletes 719/769/817/858), `useEditor.ts:20-21` (212/223/393/
404), `executors/file.ts:22-23` (330/341), `artifactImport.ts:13` (54/67), `main.tsx:4`, `chatStore.ts:6-7` and
`App.tsx:59-60` (conversations only).

Store wrappers and their callers: `useAnnotationStore.saveAnnotations()` — internal `trackedSave` 96/116/153/
221/333, external `useTabs.ts:119`, `tabs.ts:153`. `useCommentStore.saveComments(id, list)` — `main.tsx:100`,
`comments/extension.ts:541`, `Editor.tsx:410`, `CommentPopover.tsx:242/254/266/308`,
`CommentReviewPanel.tsx:126/146`, `AIEditsHistoryPanel.tsx:164`, `useTabs.ts:143`, `shareSync.ts:244`,
`sharePush.ts:173/344`, `document.ts:625/683`, `tabs.ts:157`. `useSuggestionStore.saveSuggestions` —
`Editor.tsx:898`, `useTabs.ts:135`, `tabs.ts:156`; `deleteSuggestions` `Editor.tsx:895`. Store `load*` callers:
annotations Editor 818, useTabs 217/472/601/667/1091, useEditor 115/176, file.ts 115/185, tabs.ts 198;
suggestions Editor 834, useTabs 222/475/602/668/1092, file.ts 116/186, tabs.ts 199; comments Editor 932,
useTabs 227/478/603/669/1093, **`shareSync.ts:246`**, **`artifactImport.ts:70`**, tabs.ts 200.

`ai-annotations/store.ts`: state `annotations`, `isVisible`, `documentId`, `isLoadingDocument`, `pendingSave`,
`createdThisSession` (39–44); `trackedSave` 26; `addAnnotation` 47 (sets `isLoadingDocument` 80–103, **re-keys the
store when the record's `documentId` differs** 80–85, `trackedSave`); `removeAnnotation` 111,
`removeAnnotationsInRange` 120 (persist); `updatePositions(mapping)` 157, `updatePositionsWithSplitting` 227
(return early when loading; detach on collapse; persist only if something detached); `loadAnnotations(id)` 348
(sets `{ annotations, documentId, createdThisSession }`); `saveAnnotations()` 378 (under `get().documentId`);
`clearAnnotations` 396, `setDocumentId` 401, `setLoadingDocument` 406. `plugin.ts`: module `activeTooltip` 20;
closures `currentAnnotations`, `isVisible` 98–99; `init` 106 / `apply` 156 build decorations from the store;
on `docChanged` maps then calls `updatePositionsWithSplitting` (199) or `updatePositions` (206) — store
mutations inside `apply`; rebuild triggers 171; `view()` 336–377 subscribes and dispatches a rebuild meta.
`reanchor.ts`: `reloadKeepingAnnotations(editor, reload)` 115 (only export; helpers `textIndex`, `snapshot`,
`toDocRange`, `mapThroughDiff`, `nearestMatch`).

`comments/store.ts`: `documentId`, `pendingComments`, `needsRestore` (67–69); `setDocumentId` 71 (clears);
`saveComments` 75 (IndexedDB only); `loadComments` 89 (sets `needsRestore: true`); `markRestored` 108;
`clearComments` 112; `deleteComments` 116; `countOpenThreads` 62. `comments/extension.ts`: `restoreComments`
command 251 (needs `tr`, `state.doc`, `schema.marks.comment`; side effect: writes `anchorLost` into the store
370–385; resolved skipped; raw occurrence first via `findOccurrence` 744 / `charRangeToPositions` 770, stripped
fallback); `autoResolveDeletedComments(view, prevState, contentLoad, aiReplacement)` 509 (from the plugin view
`update` 441; guards: doc unchanged 515, `needsRestore` 517, no previous marks 520, all gone on a content load
524 via `preventUpdate` meta 418; `AI_REPLACEMENT_META` 28 → anchorLost; `setState` + `saveComments` 540–541;
`pushResolveToShare`); `findFullyCoveredCommentIds` 554; `getComments` 584; `mergeCommentsForPersistence(editor,
stored)` 670 (no live marks + unresolved stored → stored unchanged 684); options `onCommentAdded` /
`onCommentRemoved` / `onCommentBlocked` (`types.ts:86-96`, wired only in Editor 402–423). Space-stripping
normaliser occurrences 306, 307, 782 (the `web.share-viewer` tripwire at `:290-293` needs ≥ 2 in this file).

`ai-suggestions/store.ts`: `documentId`, `pendingSuggestions`; `setDocumentId` 50, `saveSuggestions` 54,
`loadSuggestions` 68, `clearSuggestions` 84, `deleteSuggestions` 88, `snapshotSuggestions` 98 (HMR buffer).
`extension.ts`: `AI_SUGGESTION_RESOLVED_META` 25 (set at 597/708/849/947); `restoreAISuggestions(list)` 955
(needs `tr`/`state`/`dispatch`; first `indexOf(originalText)`; no store use); `getAISuggestions(editor)` 1064
(`{ state: { doc } }`-shaped input). Suggestion persistence lives in Editor.tsx (872–916), not the extension.
Readers of `pendingSuggestions` / `loadSuggestions` / `clearSuggestions` / `snapshotSuggestions`: Editor.tsx,
useTabs.ts, file.ts, tabs.ts, the `index.ts` re-export only. Readers of `needsRestore` / `markRestored`:
Editor.tsx, extension.ts 517, main.tsx 60, plus the two `loadComments` callers above.

`sharePush.ts:170-173` re-reads the store after each await and saves `(store.documentId, updated)` from one
synchronous read; `shareSync.ts:200` bails when `store.documentId !== documentId` (consistent pairs under
`persistRecords`).

## 5. Test seams and e2e conventions

`main.tsx` `__prose_tools` 44–61: `executeTool`, `getAnnotations`, `getAnnotationDocId`,
`isAnnotationMappingPaused` (`isLoadingDocument`; activity-panel 49, ai-edit-lifecycle 66), `getActiveTabId`,
`getDocumentIsDirty` (source-mode-authority), `loadAnnotationsFromDB` (`shared.ts:404 readAnnotationsFromDB`;
ai-edit-lifecycle 228/252), `getCommentStore` (comment-auto-resolve, comment-threading, share-sync,
source-mode-authority), `getCommentDocId` (share-sync), `getCommentStoreNeedsRestore` (comment-auto-resolve
135/184/244; source-mode-authority 69 as a readiness gate). `__prose_share` 83–102: `sync()`, `deleteThread(id)`
(uses `__prose_editor`; share-sync 276/295/687). `__prose_editor` set at `editorInstanceStore.ts:27` (~18 specs).
Others: `__prose_debug` 28, `__prose_setEditing` 39, `__prose_about` 41, `__prose_account` 68, `__prose_chat` 113,
`__prose_renameTab` (Toolbar 116–124).

`e2e/helpers.ts launchApp({ env, args })` 28: env merged over `process.env`, `PROSE_HEADLESS=1` default; packaged
build if present else `out/main/index.js`. `PROSE_USER_DATA_DIR` read at `src/main/paths.ts:29` and
`index.ts:59`; `PROSE_DEBUG_PORT` honoured for unpackaged launches (`index.ts:77-78`; ports in use 9225, 9226,
9227, 9229); `PROSE_MCP_PORT` default 9877. `PROSE_DOCS_DIR` is inert (nothing reads it); specs work because they
write `settings.json` with `defaultSaveDirectory` (tool paths are restricted, #918). `e2e/shared.ts`:
`dismissConsentDialog` 66, `waitForAppReady` 96, `waitForEditor` 110, `dismissOnboarding` 183, `dismissOverlay`
213, `executeProseTool` 374 (→ `__prose_tools.executeTool`; how specs call `select_tab`, `open_file`,
`create_and_open_file`), `preseedSettings` 345 (web only). No `seedSettings` helper: Electron specs write
`settings.json` by hand (`source-mode-authority.spec.ts:41-46`, `ai-edit-lifecycle.spec.ts:85-100`). Opening a
temp file: `mkdtempSync` user-data + docs dir, `settings.json { defaultSaveDirectory }`, `writeFileSync` the
`.md`, `executeProseTool(page, 'open_file', { path })`, wait on `getCommentStoreNeedsRestore() === false` or the
editor text (`source-mode-authority:61-73`, `suggestions-persist:52-64`). Raw IndexedDB from a spec only in
`electron.stale-paths.spec.ts:80-95` (`seedSession`). Raw MCP HTTP only in `electron.path-containment.spec.ts:
268-289`. Source-text tripwire style: `electron.dialog-defaults.spec.ts` (`ROOT`, `readFileSync`, `stripComments`
26–31, `toContain` / `toMatch` / counts), `electron.icon-variants.spec.ts:57-71`. `playwright.config.ts`:
`testMatch` smoke + `electron.*.spec.ts`, `workers: 1`, `retries: 1`, `globalTimeout 300_000` (run locally with
`--global-timeout 0`).

Vitest feasibility: nothing installed (vitest, jsdom, happy-dom, @testing-library, fake-indexeddb absent);
`"type": "module"`; `tsconfig.json` includes `src/renderer/**` and `src/shared/**` (DOM lib, bundler resolution,
strict); `tsconfig.node.json` main/preload/shared; `tsconfig.e2e.json`; no `paths`; no renderer `resolve.alias`
(`vite.web.config.ts:21` has `@shared`, unused). Import-time behaviour: `persistence.ts` only a session id +
`console.log`; `browserApi.ts` top-level imports `ai` / `@ai-sdk/anthropic`, `getApi()` checks `typeof window`;
`editorStore.ts` calls `crypto.randomUUID()` at import (99) and subscribes at 293/305 (debounced `saveDraft`);
`tabStore.ts` subscribes at 359; `chatStore.ts` at 363/378; `editorInstanceStore.setEditor` writes
`window.__prose_editor`; `comments/extension.ts` → `sharePush` → `browserApi`, `featureFlags` → `settingsStore`
→ sentry; `ai-suggestions` → `diffUtils`, `aiPipelineLog` → `settingsStore`; `lib/markdown.ts` pure (js-yaml).

## 6. Library mechanics verified (versions installed on the branch)

`@tiptap/core` 2.27.1, `@tiptap/react` 2.27.1, `@tiptap/pm` 2.27.1 (prosemirror-state 1.4.4, -view 1.42.6,
-model 1.25.12), `tiptap-markdown` 0.8.10. `editor.state` is `this.view.state`. `updateStateInner`: plugins
array identity differs → node views rebuilt, plugin views destroyed and recreated with no `update(prevState)`
call, `view.dom.scrollTop = 0` only when the docs also differ; `EditorState.create` always makes a new plugins
array. `applyInner` applies plugin fields in `config.fields` order and hands `apply` the partially built state;
`appendTransaction` gets the full state. TipTap sorts extensions by `priority` descending (default 100) and
reverses equal-priority order when collecting plugins; final array `[inputRules, ...pasteRules, ...plugins]`;
an extension with `priority: 1000` contributes its plugins first. `setEditable(editable, emitUpdate = true)`.
A meta-only transaction emits `transaction` only; `@tiptap/react` re-renders on every `transaction` unless
`shouldRerenderOnTransaction === false`. `createDocument(content, schema, parseOptions?, options?)` exported.
`PluginKey.getState(state)` = `state[key]`. `prosemirror-history`: `addToHistory: false` records nothing; fresh
state has undo depth 0. `EditorState.reconfigure`, `Node.fromJSON`, `CommandManager({ editor, state })`
(no dispatch when a custom state is given) exist.
