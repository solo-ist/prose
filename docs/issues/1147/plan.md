# PR 3 (#1147): comment threads in plugin state, auto-resolve in `apply`, share paths by `documentId`

Design of record: `docs/architecture/editor-state.md` §5.1, §4.4, §7, §12 case 6. Issue:
https://github.com/solo-ist/prose/issues/1147 (subsumes #1122 and the #1137 class; the #1140 fix stays).
Branch `issue-1147-comment-plugin-state` from `release/v1.9.0` = `e47c4b7` (PR 2 merged); renderer-only; one PR,
merge commit, green CI + claude review. The operator asked (2026-11-03) for the tranches to proceed in sequence
with one QA pass over all of them on their return, so this PR merges on green CI and a clean review, and its QA
section (§3 of `docs/qa/v1.9.0-editor-state.md`) is written for that pass. Estimate: two to three days.

## Context

PR 1 gave every tab its own `EditorState`; PR 2 moved the AI annotation records into the annotations plugin's
state. Comment thread metadata (`pendingComments`: replies, resolved, anchorLost, author, shareId, publishRev) is
the last record set that lives in a global zustand store (`extensions/comments/store.ts`) mirrored from the
active session. The mirror is what makes every thread write a two-source affair: the popover, the review panel
and the history panel compute the new list from `getState()` but save it under a render-time `documentId`
closure; the `resolve_comment` / `reply_to_comment` executors remove the mark through the handle but save under
the store's id; every share push reads "the store" again after its network awaits, so a tab switch mid-push
writes the other document's set back unchanged and the pushed thread loses its `shareId`. Auto-resolve (#928) and
anchor-lost (#1099) run in the plugin view's `update` hook with three per-dispatch closure flags shared by every
session (states are created with the one `plugins` array), and they never run for a transaction applied to a
background state. Share sync refuses any document that is not the active one. PR 3 moves the threads into the
comments plugin's state, makes every thread change a transaction on its own session, records share pushes on
the state for the session layer to perform, and addresses every share path by `documentId`.

## What the inventory found (2026-11-03, three read-only passes over `e47c4b7`)

Corrections to the issue text, folded into this plan:

- **The session layer already merges into a background tab.** `mergeThreads` (`session.ts:888-909`) finds the
  session by `documentId` and applies the new marks through `applyToSession`, inactive branch included. What
  blocks case 6 is `syncShareComments` bailing unless the store's `documentId` matches (`shareSync.ts:200-203`),
  its use of `store.pendingComments` as the merge base, and the `__prose_share.sync()` seam and the pull loop
  addressing only the active document. A bailed pull still spends the network call and the 30 s debounce.
- **Auto-resolve is not "a view-update hook" alone**: `state.apply` arms three closure flags
  (`contentLoadInDispatch`, `aiReplacementInDispatch`, `sessionSwapInDispatch`) that the view's `update`
  consumes. The flags are per plugin instance and shared by every session; `apply` also arms them for scratch
  and background transactions, which the next active-view update would consume. `contentLoadInDispatch`
  (`preventUpdate`) is dead: nothing calls `setContent` any more. The guard list has no `BUILD_META` and no
  source-mode check.
- **`onCommentAdded` is only one of four ways a thread appears**: the callback (in `Editor.tsx:225-238`, fired
  mid-command before the mark's transaction dispatches), `ensureInStore` in the executors (synthesised from a
  live mark, never persisted), `mergeThreads` (share pull, artifact import) and the seed. The new-thread share
  push lives in `Editor.tsx:237`.
- **The share push for a resolve** is inside the comments code only for auto-resolve (`extension.ts:553`); the
  explicit resolves push from `CommentPopover.tsx:257/270`, `CommentReviewPanel.tsx:129`,
  `executors/document.ts:623` and `sharePush.ts:180`. `pushResolveToShare` is a toggle (it sends the thread's
  current `resolved`), so `handleReopen` already pushes an unresolve, contrary to the comment at
  `extension.ts:505-506`.
- **Re-anchoring also runs** in `mergeThreads` (no `RELOAD`), in the `restoreComments` command (re-open) and in
  the auto-resolve "re-anchored" branch (an undo brings a mark back and clears `anchorLost`). A disk reload
  re-anchors through the open seed, not `RELOAD`; `rebuildForSchema` does not re-anchor.
- **Two writes and a wasted push on every popover delete**: `CommentPopover.handleRemove` and the
  `__prose_share.deleteThread` seam call `unsetComment` before dropping the thread, so auto-resolve resolves,
  saves and pushes a resolve first; the other removal paths write the store first. The result depends on call
  order.
- **Undo after an auto-resolve or an explicit resolve** brings the mark back on a thread that stays
  `resolved: true`; `applyCommentMarks` skips resolved threads, so the mark vanishes at the next load.
- **A pull tombstone never unsets the mark**: `applyRevisions` drops the record and `mergeThreads` only adds
  marks, so `mergeCommentsForPersistence` rebuilds a bare thread from the live mark at the next leave (likely
  resurrection; from reading, not run). `artifactImport` merges against IndexedDB (`loadComments`) even when the
  document is open, overwriting the session's newer set.
- **Queued share ops carry no `documentId`** (`PendingOp` = ids only): after a switch they look the thread up
  in the active document and drop it without re-queueing; a lost resolve is permanent because a pull never
  re-takes resolve state. `backfillShareThreads` checks the two stores' ids once, then awaits twice and writes
  `cleared` shareIds in memory only.
- `list_comments`, `get_metadata.commentCount` and `useChat.getCommentCount` count live marks, so anchor-lost
  open threads are invisible to the model while the status bar and chips count them; `processComment` is a
  silent no-op for them. The comment executors never request `forWrite`, so they run in source mode.
- Dead: `useCommentStore.deleteComments`, `shareStore.openThreadCount`, `CommentOptions.onCommentRemoved /
  onCommentResolved / onCommentReplied`, `CommentMark`. `countOpenThreads` lives in `store.ts`.
- The `web.share-viewer` tripwire (`e2e/web.share-viewer.spec.ts:286-293`) needs two `.replace(/ /g, '')` in
  `extensions/comments/extension.ts`; today there are three (`:404`, `:405` in `applyCommentMarks`, `:790` in
  `charRangeToPositions`). The matchers stay in that file; the new plugin goes beside it.
- Specs reading the store shape: `getCommentStore()` in comment-auto-resolve, comment-threading, share-sync,
  source-mode-authority and document-sessions; `getCommentDocId()` in share-sync and document-sessions;
  `getCommentStoreNeedsRestore()` (a constant `false`) polled by comment-auto-resolve and source-mode-authority.
  `session.test.ts:262/418` assert `useCommentStore.getState().documentId`.
- `share-sync.spec` simulates a pull with a loopback stub gateway plus a real OTP sign-in (needs the Linux
  keyring flags and `safeStorage.setUsePlainTextEncryption`). Case 6 only needs the renderer's merge, so it stubs
  the `share:pullComments` IPC handler from `app.evaluate` and keeps `share-sync.json` real (the entry lookup is
  a local read); a background-session read seam is needed because none exists.

## The design, made concrete for PR 3

**Plugin state** (`extensions/comments/plugin.ts`, new; one per `EditorState`):

```ts
interface CommentThreadsPluginState {
  threads: readonly CommentData[]       // reference-stable: replaced only when a thread object changed
  marks: ReadonlyMap<string, MarkSpan>  // id → { from, to, markedText, comment, createdAt, occurrenceIndex }, one doc walk per docChanged
  decorations: DecorationSet            // `comment-mark--pending` for open threads without replies
  revision: number                      // bumped when `threads` is replaced
  urgentRevision: number                // the revision of the last change that must reach IndexedDB at once (everything but a seed)
  pushes: readonly SharePush[]          // the share pushes this transition produced; empty otherwise
  pushRevision: number                  // bumped when `pushes` is non-empty; the session layer performs them once
}
type SharePush =
  | { kind: 'thread'; threadId: string }
  | { kind: 'reply'; threadId: string; replyId: string }
  | { kind: 'resolve'; threadId: string }
  | { kind: 'remove'; thread: CommentData }
```

The old plugin (`extension.ts:277-353`), its three closure flags, the store subscription with its
`queueMicrotask` nudge, `autoResolveDeletedComments`, the `restoreComments` command and `onCommentAdded` are
deleted. `onCommentBlocked` stays.

**One meta object** on `commentThreadsPluginKey`:
`{ load?: CommentData[]; merge?: CommentData[]; add?: CommentData[]; update?: { id, patch }[]; remove?: string[]; quiet?: boolean }`.
`load` and `merge` replace the set (a seed, a share pull or artifact import, an HMR rebuild); `quiet` marks a
share write-back (`shareId`, `publishRev`, a pulled edit) so no push is recorded.

**`apply(tr, prev, oldState, newState)`**, in order:

1. Metas: `load` / `merge` replace the set; `add` appends (an id already present is superseded); `update` patches
   by id (same object when nothing changed); `remove` drops ids.
2. Marks: when `docChanged`, or a meta ran, re-walk the document once (`scanMarks`). Threads are reconciled
   against the marks:
   - **Edit mode** (`docChanged`, no `RELOAD` / `ACTIVATED` / `BUILD` meta, no `load` / `merge`): an open thread
     whose mark was in `prev.marks` and is gone → `resolved: true` (#928), or `anchorLost: true` when the
     transaction carries `AI_REPLACEMENT_META` (#1099). A thread whose mark is back (an undo) → `resolved: false,
     anchorLost: false` (decision 1). A mark with no thread (pasted commented text) → a thread adopted from the
     mark's attributes (decision 2), which is what `mergeCommentsForPersistence` did at the next leave.
   - **Reconcile mode** (everything else: the seed, `RELOAD`, a merge, a re-open): an open thread with a mark →
     `anchorLost: false`; without → `anchorLost: true`. Nothing resolves.
   A transaction that removes a thread and unsets its mark (the `removeThread` command, one transaction) never
   auto-resolves it: the metas run first, so the thread is gone before the diff.
3. Pushes, by diff of `prev.threads` → `threads` unless `quiet`, `load` or `merge`: a new thread without
   `shareId` → `thread`; `resolved` flipped → `resolve`; a reply without `shareId` appeared → `reply`; a thread
   removed → `remove` with the thread snapshot (`shareId` is what the removal needs). Nothing in `apply` touches
   the network; `sharePush` keeps its queueing, rate limit and "needs a `shareId` first" rules.
4. Decorations rebuilt when threads or marks changed, else mapped. `revision++` iff `threads !== prev.threads`;
   `urgentRevision = revision` for everything but `load`.

`IDENTITY_META` needs nothing: threads carry no `documentId`.

**Pure functions**, `extensions/comments/threads.ts` (no DOM, no store): `scanMarks(doc)`, `reconcileThreads(threads,
prevMarks, marks, mode, aiReplacement)`, `adoptOrphans`, `applyThreadMetas`, `diffPushes(prev, next)`,
`buildPendingDecorations(doc, threads, marks)`, `countOpenThreads` (moved from `store.ts`). `applyCommentMarks`,
`reconcileAnchorLost` (now unused by the session; kept for the panel? deleted if no caller), `commentMarkIds`,
`findFullyCoveredCommentIds`, `getComments`, `mergeCommentsForPersistence`, `findOccurrence`,
`charRangeToPositions` stay in `extension.ts` (tripwire).

**Write API**, `extensions/comments/transactions.ts`: `commentThreadsPluginKey`, `EMPTY_THREADS`,
`addThreadsTo(tr, threads)`, `updateThreadIn(tr, id, patch, { quiet })`, `removeThreadFrom(tr, id)`,
`mergeThreadsInto(tr, merged)`, `loadThreadsInto(tr, threads)`, `threadsOf(state)`, `threadPluginState(state)`
(with the dev HMR key fallback PR 2 used), `selectThreads`, `selectOpenThreadCount`. TipTap commands on the
`Comment` mark: `setComment` adds its own `add` meta in the same transaction as the mark (replacing
`onCommentAdded`); `resolveThread(id)` = update `resolved: true` + unset the marks; `reopenThread(id)` = update
`resolved: false` + `applyCommentMarks(tr, [thread])` (today's `restoreComments`, re-anchoring by text);
`replyToThread(id, reply)`; `removeThread(id, { push = true })` = remove + unset the marks (`push: false` for the
`__prose_share.deleteThread` seam, which deliberately skips the removal push); `updateThread(id, patch)`.

**Session layer** (`document/session.ts`): the store import, the subscription, `records.comments` and every
store write go. Seed: `loadThreadsInto(seed, comments)` + `applyCommentMarks(seed, comments)` (the plugin
reconciles `anchorLost` in the same apply); `commentsPersisted = revision`. `afterTransaction` gains the comment
policy: an urgent revision → `persistCommentsNow` at once (one synchronous `mergeCommentsForPersistence({ state },
threadsOf(state))` → `persistRecords('comments', documentId, …)`, the promise in `session.commentWrite`); no
timer, because a plain edit moves nothing the stored shape depends on. `persistSession` (leave, close, disk
reload) keeps writing the projection unconditionally, as today, so stored positions and `markedText` are fresh.
Pushes: `pushRevision !== session.pushesPerformed` → `session.pushesPerformed = pushRevision` and the registered
performer runs `state.pushes` with the session's `documentId` and path (`registerSharePushPerformer` in
`session.ts`, registered by `sharePush.ts`; `session.test.ts` registers a spy). `mergeThreads(documentId,
merged)`: a session → one `addToHistory: false` transaction through `applyToSession` carrying `merge`, the new
open threads' marks via `applyCommentMarks`, and `removeMark` for every live mark whose thread the merge dropped
(a tombstone, decision 5); no session → `saveComments`. `readThreads(documentId)`: the session's threads or
`loadComments`. `replaceSessionDocument` keepHistory:true re-applies marks from `threadsOf(state)`; the
inactive-branch and HMR (`rebuildForSchema` carries threads via `load`) match PR 2. `setSessionIdentity` awaits
`commentWrite` alongside the others. `Session` gains `commentsPersisted`, `commentWrite`, `pushesPerformed`.

**Share paths by `documentId`** (`lib/sharePush.ts`): every entry point takes the document:
`pushNewThreadToShare(documentId, threadId)`, `pushReplyToShare(documentId, threadId, replyId)`,
`pushResolveToShare(documentId, threadId)`, `pushRemoveToShare(documentId, thread)`,
`backfillShareThreads(documentId)`, `hasUnsyncedRows(documentId)`; `PendingOp` carries `documentId`; thread reads
are `readThreads(documentId)` (session or IndexedDB) at send time; write-backs (`shareId`, cleared shareIds) are
`updateThreadIn(…, { quiet: true })` through `applyToSession` on the owning session, or an IndexedDB
read-modify-write when it is closed; the share entry comes from the document's path (`activeEntry(path)` with the
path from the session identity or the tab). `shareSync.syncShareComments(entry, documentId)`: the merge base is
`readThreads(documentId)`; the active-document bail goes; the toast and the unseen badge fire only when the
document is active (a background merge is silent; the tab shows the threads when activated, decision 3); the pull
loop still pulls the active document on its interval (a background pull is reachable through the seam and the
popover). `artifactImport` merges against `readThreads`. `shareArtifact` and `Toolbar` export read
`threadsOf(state)` of the session owning `doc.documentId`; the two-store guards go. `shareStore.openThreadCount`
deleted.

**Consumers**: `CommentPopover`, `CommentReviewPanel`, `AIEditsHistoryPanel`, `ShareStatusPopover`, `StatusBar`,
`ChatPanel` read `useActiveSession(selectThreads)` / `selectOpenThreadCount` and write through
`editor.commands.resolveThread / reopenThread / replyToThread / removeThread`. Executors: `list_comments` merges
`threadsOf(handle.state)` with the live marks and includes anchor-lost open threads flagged `anchorLost: true`
without a position (decision 4); `get_metadata.commentCount` = open threads; `add_comment` unchanged
(`setComment` adds the thread); `resolve_comment` / `reply_to_comment` → `handle.commands`; `ensureInStore`
deleted (orphans are adopted in `apply`); the four comment tools request `forWrite` where they write.
`useChat.processComment` reads replies from the threads. `main.tsx` seams: `getCommentStore()` → a copy of the
active session's threads; `getCommentDocId()` → the active identity; `getSessionThreads(tabId)` (new, for case
6) → `{ threads, markIds }` of that session's state; `__prose_share.sync(documentId?)` → the tab owning the id
(default the active document); `deleteThread(id)` → `removeThread(id, { push: false })`;
`getCommentStoreNeedsRestore` stays `false` (PR 8). `store.ts` deleted; `types.ts` loses `CommentMark` and the
three unwired callbacks.

## Work order (worktree `prose-1146` reused on the new branch; suite green after each commit)

0. This plan as `docs/issues/1147/plan.md`.
1. **Pure core**: `threads.ts`, `transactions.ts`, `threads.test.ts`. No behaviour change.
2. **The move**: `plugin.ts`, `extension.ts` (commands; old plugin, auto-resolve, `restoreComments` deleted;
   matchers kept), `store.ts` deleted, `session.ts`, `sharePush.ts`, `shareSync.ts`, `artifactImport.ts`,
   `shareArtifact.ts`, `shareStore.ts`, the six React readers, `Editor.tsx` (`onCommentAdded` gone),
   `extensions.ts`, `executors/document.ts`, `useChat.ts`, `Toolbar.tsx`, `main.tsx`; `plugin.test.ts`,
   `session.test.ts` (seed, persist-at-once, background merge, identity, pushes); e2e case 6 (falsified against
   `e47c4b7`'s `src`), the store tripwire, `__prose_share.sync(documentId)`.
3. **Docs**: this file's execution log; `docs/architecture/editor-state.md` §5.1 shipped paragraph, status line,
   §7 rows; QA §3 in the operator's QA doc.

## Tests

**vitest**: `threads.test.ts` (scan, reconcile in both modes, adoption, metas, push diff, decorations);
`plugin.test.ts` (`setComment` adds the thread in one transaction; deleting the text resolves and records a
resolve push; an AI replacement sets `anchorLost` and records nothing; undo reopens; `RELOAD` reconciles without
resolving; `merge` replaces, marks new threads and unmarks tombstones; `removeThread` never auto-resolves;
`reopenThread` re-anchors; `quiet` updates record no push; reference stability; revision classes);
`session.test.ts` (seed loads threads with `anchorLost` from the marks and writes nothing; a resolve writes at
once under the state's own id; `mergeThreads` into an inactive session lands in that state and IndexedDB and
leaves the active one alone; pushes reach the performer with the owning `documentId`; identity write).

**e2e**: `electron.document-sessions.spec.ts` case 6: open A then B (A background with a session), seed
`share-sync.json` for A, stub `share:pullComments` with one row for A's text, `__prose_share.sync(a.documentId)`;
assert B's live set and IndexedDB untouched, A's IndexedDB holds the row with `shareId` and `anchorLost: false`,
`getSessionThreads(a.tabId)` shows the thread and its mark; click A: the mark is painted on its text,
`sessionTabIds()` and `projectionStats().opens` unchanged (no reload). Fails on `e47c4b7` with "Document changed
while syncing". Tripwire: no renderer file references `useCommentStore` or imports `comments/store`. Must stay
green: `comment-auto-resolve`, `comment-threading`, `comment-occurrence`, `share-sync`, `source-mode-authority`,
`web.share-viewer` + the other web specs, `ai-edit-lifecycle`, `activity-panel`, `tab-switch-flush`.

## Decisions folded in (say so to change any)

1. **A mark that comes back reopens its thread.** Undo of an auto-resolve or of an explicit resolve makes the
   thread open and anchored again (today it stays resolved and the mark vanishes at the next load); redo resolves
   it again. The share receives the matching toggle.
2. **Orphan marks become threads at once.** Pasted commented text, or any mark without a thread, is adopted in
   `apply` from the mark's attributes instead of at the next leave, so the panels and the share see it.
3. **A background pull merges silently.** No toast, no unseen badge; the threads are there when the tab is
   activated. The interval loop keeps pulling only the active document.
4. **`list_comments` includes anchor-lost open threads** (flagged, no position) and `get_metadata.commentCount`
   counts open threads, matching the status bar and the chips.
5. **A pull tombstone unsets the mark**, so a reviewer-deleted thread cannot be rebuilt from its live mark.
6. **Comment persistence has no debounce**: thread changes write at once; leave, close and disk reload write the
   projection with fresh positions as today.

## Execution log

- **2026-11-03, step 0:** inventory (three passes), plan written; branch `issue-1147-comment-plugin-state` from
  `e47c4b7` in the reused `prose-1146` worktree. Baselines on the head: `typecheck:renderer` 69, vitest 45/45.
