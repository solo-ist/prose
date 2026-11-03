# PR 4 (#1148): chat tool calls and streams bound to the conversation's document

Design of record: `docs/architecture/editor-state.md` §4.14, §4.15, §7 (`useChat`, `chatStore`), §12 cases 11 and
12, decisions 7 and 9. Issue: https://github.com/solo-ist/prose/issues/1148 (part of #1094 Wave 3b; fixes the
unfiled "a chat turn keeps acting on whatever tab is on screen" failure). Branch `issue-1148-chat-binding` from
`release/v1.9.0` after PR 3 (#1173) merges; renderer-only; one PR, merge commit, green CI + claude review; the
operator's standing direction (2026-11-03) is to proceed in sequence with one QA pass on their return, so QA §4 is
written into `docs/qa/v1.9.0-editor-state.md`. Estimate: two to three days.

## Context

PR 1 gave every tab its own `EditorState` and rewrote the executors against a `DocumentHandle`, with the target
fixed to the active tab; PRs 2 and 3 moved the annotation and comment records into plugin state so a background
transaction carries its own records. The chat pipeline is the last consumer that assumes "the document" is the
one on screen: `useChat` reads the document id from `editorStore` when each roundtrip completes, every executor
resolves the active handle when it runs, the handle's `state` / `commands` / `apply` are getters over the live
editor, and the chat store holds one `messages` slot that `loadForDocument` swaps on a switch. A turn still
streaming for document A therefore lands the rest of its edits on B after a switch (a streamed `edit` even moves
its later chunks into B at A's positions), its annotations carry B's id, its continuation prompt describes B, and
its stream text is dropped (B's panel shows A's spinner, B's input is disabled, Stop on B aborts A). PR 4 binds a
turn to its conversation's document: handles are resolved from the binding, a background tab receives atomic
transactions through `applyToSession`, the stream is routed to its conversation wherever that conversation
lives, and the edge cases (rename, close, untitled, source mode, tab-changing tools) are defined.

## What the inventory found (2026-11-03, three read-only passes over `e84f61a`)

- **No binding exists anywhere.** `executeTool(name, args, mode, provenance)` has no target; provenance's
  `documentId` and `conversationId` are sampled from `editorStore` / `chatStore` at each completion
  (`useChat.ts:345-350`) and only decide whether an annotation is created. The continuation system prompt is
  rebuilt from `editorStore` (`:481-487`); `resolveToolPosition` sorts calls on the active handle.
- **`provenance.documentId` cannot be the binding key**: case 7 passes a stale id on purpose, `ai-provenance`
  passes `'previous-document'` and expects the new document, MCP passes `conversationId = requestId` and keeps
  the active tab (decision 8), specs pass conversation ids that are not in the store. The binding has to be an
  explicit target from `useChat`, with the active tab as the default for every other caller.
- **The handle follows the view, not the tab** (`handle.ts:78-94`): a mid-stream switch puts chunks 2..n of a
  streamed `edit` (`editor.ts:137-142`, one rAF per chunk) and the follow-up `addAIAnnotations` into the newly
  shown document. No executor reads `handle.view` or `handle.isActive`; the view effects hide in `.focus()`
  inside chains (`editor.ts:111, 1003, 1188, 1258`; `document.ts:519`) and the `search:show` event.
- **`editorStore.readCache` no longer exists** (deleted in PR 1); the design's "move it into the session" is
  moot. What remains is `read_document` returning `store.document.content`, the 500 ms mirror, so a read right
  after an `edit` in the same turn can return the pre-edit text; `handle.serialize()` flushes and is correct.
- **TipTap 2.27.1 `CommandManager({ editor, state })`**: `get commands` never dispatches with a custom state and
  drops the transaction; `createChain(tr)` with a start transaction never dispatches; `buildProps` keeps the LIVE
  editor and view, so `focus()` steals focus and dispatches `scrollIntoView` on the active document. A background
  handle therefore builds its own chain and commands over `manager.rawCommands` (public) with `focus` / `blur` /
  `scrollIntoView` replaced by no-ops, then applies the transaction through `applyToSession`.
- **Background suggestions are never persisted until leave or close**: `applyToSession`'s inactive branch runs
  `afterTransaction` (annotations, comments) and an immediate, undebounced `projectMarkdown`, but never
  `projectSuggestions` or the `RESOLVED` check; a rejected suggestion on a background tab comes back after a
  relaunch. A background edit marks the tab dirty through `projectMarkdown`; autosave arms only from the live
  editor's `update` event or the active document's dirty flag.
- **The stream is dropped after a switch, not appended to B**: writes look up the message id in B's `messages`,
  find nothing, and still bump B's active conversation. `isStreaming` / `isLoading` / `currentStreamId` /
  `streamingMessageId` / `toolMode` are per app. The API history loses the assistant's text (`:315`) and the
  consecutive-failure stop overwrites the round's result tags with a stale snapshot (`:424-428`).
- **Tab-changing tools break their own turn today**: `open_file`, `new_file`, `create_and_open_file` and
  `select_tab` run `arriveTab`, which resets or swaps the chat, so every later append is lost. The design's
  "never the active tab" would send the edits that follow a `create_and_open_file` to the original document.
- **No way to open a tab without activating it** (`tabStore.addTab` always sets `activeTabId`); the closed-tab
  snapshot has no tab or document id; a saved file's id is `generateIdFromPath(path)`, so a background reopen
  from the path recovers the conversation's document id. `closeSession` deletes the session before awaiting the
  persist and `removeTab` runs later: a resolver in that window would find a tab without a session and open an
  orphan. Closing an untitled tab deletes its conversations (`deleteDocumentRecords`).
- **Conversation save race**: `arriveTab` sets `currentDocumentId = B` before `await loadForDocument(B)`; a
  1 s debounce firing in that gap writes A's conversations under B's key. `useEditor.ts:53-55` is a second writer.
- **Pipeline log has no per-call event**; `edit:start` / `suggest_edit:*` carry no document id. Case 11 needs one.
- **Specs that drive tools** pass `executeTool(name, args, mode, provenance?)` (the third argument is the mode);
  `ai-provenance`'s `writeWhileTyping` is the existing in-flight precedent. A deterministic turn without an LLM
  is a stubbed `llm:stream` IPC handler installed from `app.evaluate` (the case 6 precedent), scripted per
  roundtrip and gated so the spec can switch or close tabs between roundtrips; settings need `aiConsent`, a fake
  `llm.apiKey` and `toolMode: 'create'` (the `screenshot-chat` precedent); the turn starts through the
  `prose:mode-switch-and-run` event ChatPanel already handles.
- **"A tool-result card for an inactive document activates its tab"** is moot: conversation lists are per
  document, so a card is only ever shown while its document is active.

## The design, made concrete for PR 4

**The binding.** `useChat.sendMessage` creates a `TurnBinding = { conversationId, documentId, path, tabId }`
from the conversation's document (the active tab at send time) and keeps it on the turn (`turns` in the chat
store, keyed by conversation id, each `{ streamId, messageId, binding }`). Every tool call of the turn goes
through `executeTool(name, args, mode, provenance, binding)`; the binding is a mutable object owned by the turn,
not a global: two turns on two documents may run at once.

**Resolution** (`document/handle.ts`, new async `resolveToolHandle(binding, { forWrite })`):
1. `binding.tabId` names a tab that exists and is not closing → that tab (a lazy tab gets `openSession` from its
   `tab.content` first).
2. Else a tab whose `documentId` equals `binding.documentId` → bind to it.
3. Else `binding.path` → **reopen in the background**: `addTab(…, { activate: false })` with
   `generateIdFromPath(path)`, content from `readDocumentFromDisk`, `openSession`; bind to it.
4. Else → `DOCUMENT_CLOSED`: "The document this conversation belongs to (Untitled) was closed; open it again to
   continue." Every remaining call of the turn fails the same way; the consecutive-failure stop ends the turn.
Then `forWrite` and the target tab's own source surface (`isSourceSurfaceFor(tabId)`) → `SOURCE_MODE` refused;
read-only is the target tab's (`tab.isPreview || isRemarkableOcrPath(tab.path)`), not `editorStore`'s. The
handle's `documentId` / `path` / `plain` read the identity live, so a rename mid-turn stamps the new id.
`resolveDocumentHandle({ forWrite })` stays for callers without a binding (MCP, slash commands, specs): the
active tab, as today.

**The handle** (`handle.ts`, `handleForTab(tabId)`): one shape for active and background. `state` reads the
session; `isActive` reads the registry each access (a turn can start active and go background mid-way, or the
reverse); `view` is the editor's view when active, else null; `apply(tr)` is `applyToSession(tabId, () => tr)`
(the session routes through the view when active). `commands` / `chain()` / `can()`: when active, the editor's;
when not, built over `new CommandManager({ editor, state })` per call: a chain Proxy of our own (`rawCommands`
+ `buildProps(tr, true)`, `run()` applies `tr` whatever the callbacks return, as the view path dispatches
regardless), `commands` the one-shot form, `can()` the manager's; `focus`, `blur` and `scrollIntoView` are no-ops
on the manager's `rawCommands` copy. `handle.serialize()` = `projectSessionContent(tabId)` (flushes).

**Executors** (`lib/tools/index.ts`, `executors/*`): `executeTool` resolves the handle once (`forWrite` for the
writers: `edit`, `insert`, `delete_node`, `suggest_edit`, `accept_diff`, `reject_diff`, `add_comment`,
`resolve_comment`, `reply_to_comment`, `move_cursor`) and passes `{ handle, provenance }` to the executor; the
internal `resolveDocumentHandle()` calls go; document-less tools (`list_files`, `read_file`, `list_tabs`,
`request_mode_switch`) take none; tab-changing tools (`open_file`, `new_file`, `create_and_open_file`,
`select_tab`) take the binding and **rebind it** to the tab they land on (decision 2). `isEditorReadOnly(handle)`.
`shouldStreamInsertion(handle)` is false when `!handle.isActive` (atomic background insert; no rAF, no focus).
Frontmatter writes (`edit` of `frontmatter`, `suggest_edit`'s `setPendingFrontmatter`) are refused on a
background handle (`FRONTMATTER_BACKGROUND`, PR 7 puts frontmatter on the tab). `read_document.markdown` and the
`get_outline` summary come from `handle.serialize()`; `get_metadata` from the handle's identity and the tab
record (`frontmatter`, `isDirty`); `read_selection` from `handle.state.selection` (the `lastSelection` fallback
only when active); `search_document` dispatches `search:show` only when active; `list_diffs` drops `forWrite`;
`add_comment` gains it. `executeTool` logs `tool:call { tool, conversationId, documentId, tabId, active }`.

**Session layer** (`session.ts`): `applyToSession`'s inactive branch schedules the same suggestion projection as
`onTransaction` (`RESOLVED` meta → at once, else the 500 ms timer) and the debounced markdown projection instead
of an immediate serialisation (both flushed by `flushProjections`); `openSessionForTab(tabId)` opens a lazy tab
from its record; `markTabClosing(tabId)` / `isTabClosing` guard the close window. `tabs/actions.ts`:
`openInBackground(path)`; `closeTab` marks closing before `retireTab` and clears after `removeTab`; `retireTab`
with `discard` calls `chatStore.discardDocument(documentId)`; `setTabIdentity` calls `chatStore.rekeyDocument`;
`arriveTab` loads the conversations before it sets the autosave key (`useEditor`'s duplicate writer removed).
`tabStore.addTab(tab, { activate })`.

**Chat store** (`stores/chatStore.ts`): `turns: Record<conversationId, { streamId, messageId, binding }>` and
`parked: Record<documentId, ChatConversation[]>` (the conversation lists of documents that have a live turn and
are not active). `loadForDocument(B)` parks the leaving document's list when it has a turn, and prefers a parked
list over IndexedDB when arriving. Stream writes take the stream id and route by turn: into `conversations` /
`messages` when the conversation is in the active list, else into `parked[binding.documentId]`, which is saved
under that id (a per-document debounce; `completeStreaming(conversationId)` flushes it). `isStreaming`,
`isLoading`, `currentStreamId`, `streamingMessageId` keep their names and reflect the **active conversation**
(recomputed when turns or the active conversation change), so ChatPanel's caret, ChatInput's disabled state and
Stop apply to what is on screen. `moveConversation(conversationId, documentId)` (decision 2),
`rekeyDocument(old, new)`, `discardDocument(documentId)` (drops the parked list and marks its turns orphaned:
they finish, nothing is saved). `useChat`: the listeners find the turn by `chunk.streamId`; the loop reads the
binding, builds provenance from the resolved handle (`documentId` live), the continuation prompt from
`handle.serialize()`, sorts with `resolveToolPosition(call, handle)`, appends result tags to the turn's message
through the routed `updateMessage`, and fixes the stale-snapshot overwrite in the consecutive-failure stop;
`stopGeneration` aborts the active conversation's turn.

**Seams** (`main.tsx`): `__prose_chat.getState()` → `{ activeConversationId, turns, conversations, parked }`
(copies); `__prose_tools.getSessionState(tabId)` → `{ documentId, text, annotations, suggestionIds }`;
`loadConversationsFromDB`; `__prose_tabs.closeTab(tabId, { force })`.

## Work order (worktree `prose-1146` on the new branch; suite green after each commit)

0. `docs/issues/1148/plan.md` (this file).
1. **Handle and session**: `handleForTab`, the background commands, `resolveToolHandle`, `openSessionForTab`, the
   closing guard, the inactive-branch projections, `addTab({ activate })`, `openInBackground`; `handle.test.ts`
   (a background `setComment` / `addAIAnnotations` / `insertContent` lands in the session state and not in the
   view; `focus` is a no-op; the same handle routes through the view once the tab is active) and session tests
   (a background suggestion is projected and persisted; a lazy tab opens from its record).
2. **Executors**: `executeTool` with a binding, the `{ handle, provenance }` signature, the per-executor changes,
   `tool:call`, rebinding by the tab-changing tools.
3. **Chat**: turns, parking, routed writes, derived flags, move / rekey / discard, `useChat` on the binding, the
   `arriveTab` order fix, `useEditor` writer removed; `chatStore.test.ts`.
4. **Specs**: cases 11 (switch mid-turn) and 12 (close a saved A mid-turn → background reopen; close an untitled
   A → errors naming it), falsified on a build of the release head's renderer; seams.
5. **Docs**: execution log; design doc §4.14 trued (readCache gone, rebinding, per-document lists); QA §4.

## Tests

vitest as above (`handle.test.ts`, `session.test.ts` +2, `chatStore.test.ts`: a chunk for a parked conversation
lands in the parked list and is saved under its document; `loadForDocument` prefers the parked list; flags
follow the active conversation; `moveConversation`; `discardDocument`). e2e: cases 11 and 12 with the stubbed,
gated `llm:stream` handler (settings seeded with consent, a fake key, `toolMode: 'create'`, the pipeline flag);
roundtrip 1 edits A, the gate holds roundtrip 2 while the spec switches to B (11) or closes A (12), roundtrip 2
edits A's text that B does not contain (so the release head fails with `NODE_NOT_FOUND`), roundtrip 3 ends the
turn; assert A's IndexedDB and session state, B untouched, the `tool:call` events, the fake's recorded tool
results (the `DOCUMENT_CLOSED` error for untitled A), and A's panel showing the finished stream when A is active
again. Must stay green: `ai-edit-lifecycle`, `ai-provenance`, `activity-panel`, `restructure`, `suggestions`,
`document-sessions` (case 7's stale provenance id still lands under the new id: the binding follows the tab).

## Decisions folded in (say so to change any)

1. **The turn binds to the conversation's tab**, follows a rename, and when the tab is gone resolves by document
   id, then by path (a silent background reopen from disk), else fails every remaining call with an error naming
   the document.
2. **A tab-changing tool rebinds the turn and moves the conversation** to the document it lands on, so "create a
   file and write into it" keeps working and the chat follows the new file (today the stream is dropped).
3. **Background writes are atomic**: no streamed insertion, no focus or scroll, frontmatter writes refused until
   PR 7.
4. **One live turn per conversation; turns on different documents may overlap.** The streaming flags, the input
   lock and Stop are the active conversation's.
5. **A background tab's suggestions are projected like the active tab's** (closes the rejected-suggestion
   resurrection gap); a background edit marks the tab dirty and autosave arms on activation (PR 7 makes it per
   tab).
6. **`read_document` returns the serialised state**, not the 500 ms mirror.
7. **The conversation autosave key is set after the arriving list is loaded** (the save race).

## Execution log

- **2026-11-03, step 0:** inventory (three passes over `e84f61a`), plan written; branch `issue-1148-chat-binding` from the PR 3 tip (`458678d`), to land onto `release/v1.9.0` after #1173 merges.
- **2026-11-03, commits 1–4:** `beca72c` handle + session (`handleForTab` for active and background tabs over
  TipTap's `CommandManager` with a hand-built chain and one-shot commands, `focus`/`blur`/`scrollIntoView`
  no-ops; `resolveToolHandle` with the tab → document → background reopen → `DOCUMENT_CLOSED` ladder;
  `openSessionForTab`, the closing guard, the inactive branch's debounced markdown and suggestion projections;
  `addTab({ activate })`, `openInBackground`; `handle.test.ts` 6) · `0bbd967` executors on `{ handle, provenance }`
  from `executeTool(name, args, mode, provenance, binding?)`, rebinding by the tab-changing tools, `tool:call`,
  read-only from the handle's tab, atomic background insertion, reads from `handle.serialize()`, frontmatter
  writes refused on a background document, `save_file` on the bound tab (`markTabSaved`); `handle.test.ts` +1 ·
  `c5a9784` chat store `turns` + `parked` + routed writes + active-conversation flags + move / rekey / discard,
  `useChat` on the binding with per-stream loop state, `arriveTab` loads before anything saves under the new id
  (the shown list carries its document id, a pending save is flushed before the list is replaced; `useEditor`'s
  duplicate writer removed), seams `__prose_chat.getState`, `__prose_tools.getSessionState`,
  `loadConversationsFromDB`, `closeTab`; `chatStore.test.ts` 5 · `d895271` + the behaviour-first reorder: cases 11
  and 12 (saved and untitled) over a scripted, gated `llm:stream` stub installed from `app.evaluate`, the turn
  started through the `prose:mode-switch-and-run` event, tabs closed from the tab bar with Discard. Unit 85/85;
  `typecheck:renderer` 69 and `typecheck:e2e` 8 = baselines; build clean. **Falsified on a build of `1021558`'s
  renderer** (the specs assert behaviour before any new seam): case 11 leaves one annotation in A (the later calls
  acted on B), the saved case 12 never reopens A, the untitled case 12 reports `NODE_NOT_FOUND` over B's nodes
  instead of `DOCUMENT_CLOSED`; all three pass on the branch (14.9 s). Fixture lesson: `findNodeByContent` wants
  the node's whole text (the trailing period included). Design doc §4.14 shipped paragraph and §11 row trued;
  QA §4 (ten checks) written into the operator's QA doc.
