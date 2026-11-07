# #1233 — P2: the review log (suggestion lifecycle and review events)

Part of epic #1230. Design of record: `docs/architecture/review-provenance.md` §5. Branch `issue-1233-review-log`, stacked on P1 (`issue-1232-actor`, #1250); retargeted to `main` once #1250 merges. Renderer only.

## The plugin

`extensions/review-log/`, one state per `EditorState`, at priority 10: it runs after the comment, suggestion and annotation plugins, so its `apply` reads their next state and the next document.

- **State**: `suggestions` (history by id), `events` (append-only, per-document `seq`), `nextSeq`, `revision`, plus the live suggestion marks by id (`marks`). The marks are rescanned only when the document changed and it could matter: suggestion marks existed before, a step could carry one in (`AddMarkStep` of the type, or a slice containing it), or the transaction says what it did.
- **Derived from the document, not from callers**: a suggestion mark id that appears is *proposed*; a decided one coming back (an undo) is *reopened*; one that disappears is *accepted* or *rejected* as its transaction says, *superseded* when a revision replaced it, and otherwise *rejected* by the writer (the text was deleted). A new thread is *comment:added*, a new reply *comment:replied*, a resolve toggle *comment:resolved* or *comment:reopened*. Share merges count (a reviewer's comment arrives as *comment:added* by that reviewer).
- **Intent metas** carry only what the document can't show: who decided (`decideSuggestionsIn`), which suggestion a revision replaced (`reviseSuggestionIn`), a feedback entry (`feedbackIn`), and who resolved or reopened a thread (`threadActorIn`). Producers add them to the transaction that does the work (editor-state rule 3).
- **Seed and remount**: the stored log loads with the seed (`loadReviewLogInto`), and no events are derived from a seed. Marks present at load without a history row (suggestions from before 1.9.1) are backfilled silently as pending.
- **Caps** in the pure transition: 5,000 events per document, 200 feedback entries per suggestion. This refines the design's "a year" rule into a size bound.

## Producers

- **Accept and reject**: `acceptAISuggestion(id, by?)`, `rejectAISuggestion(id, by?)`, `acceptAllAISuggestions(by?)` and `rejectAllAISuggestions(by?)`. The default actor is the writer. `accept_diff` / `reject_diff` pass the tool call's actor.
- **Feedback**: `setAISuggestionReply(id, reply, by?)` logs a feedback entry and keeps writing `userReply`, which the in-app chat still reads.
- **Revise**: `reviseAISuggestion(id, { suggestedText, explanation?, by })` is new. In one transaction it removes the old mark, marks the same range with a new id, and links the two. The MCP tool arrives in M4.
- **Resolve and reopen**: `resolveThread(id, by?)` and `reopenThread(id, by?)`. `resolve_comment` passes the tool call's actor.

## Persistence

- **Store**: `review_log`, keyed by `documentId` (`DB_VERSION` 9 → 10, with every store created if missing).
- **Writers**: `saveReviewLog` / `loadReviewLog` / `deleteReviewLog`, imported only by `session.ts`. The tripwire gains them.
- **When `session.ts` writes**: on every revision change (every log change is a decision or a message), on leave and close, under the new id on rename / Save As, and as part of discarding an untitled document.

## Tests

- **vitest** `review-log/log.test.ts` drives a headless editor built from `createEditorExtensions`. Each of the following updates the history and events:
  - propose
  - feedback
  - revise
  - accept by an agent
  - reject
  - delete the text
  - undo an accept
  - resolve and reopen
  - a reply
  - a merged reviewer thread

  Also: a seed derives no events and backfills old marks, and the caps hold.
- **e2e** `electron.review-log.spec.ts` (port 9234): a Prose Agent suggests, the writer gives feedback, the suggestion is revised, and the agent's `accept_diff` accepts it. After a relaunch the history and events read back intact from IndexedDB and from the state. Falsified on a build of the merge-base.

## Execution log

- **2026-11-07.** `34787a3` plan, then the change and spec, stacked on P1's branch (P1 merged as `f0863df` meanwhile, so the PR targets `main`).
- **Design refinements**, written back into `review-provenance.md`:
  - the log is derived from the marks and threads each transaction leaves, with intent metas only for what the document can't show;
  - undo reopens a decided suggestion;
  - the caps are 5,000 events and 200 feedback entries per suggestion, not the "year" rule.
- **Checks:**
  - `typecheck:renderer` is 66, the same as the base.
  - Unit tests: 199 (12 new in `log.test.ts`). The build is clean.
  - `electron.review-log.spec.ts` passes on the branch and fails on a build of the merge-base (`e1341a3`, where `reviseAISuggestion` doesn't exist).
  - The regression set passed 84 tests: sessions with the extended tripwire, suggestions, comments, source-mode authority, AI provenance and lifecycle, Activity, provenance, edit-markdown and tab-switch flush.
