# PR 5 (#1149): AI suggestions without a store

Design of record: `docs/architecture/editor-state.md` §5.3. Issue: https://github.com/solo-ist/prose/issues/1149
(part of #1094 Wave 3b; subsumes the #1126 class; the #1129 fix stays). Branch `issue-1149-suggestions-store`,
stacked on PR 4 (#1174) and landing onto `release/v1.9.0` after it; renderer-only; one PR, merge commit, green CI +
claude review; QA folded into §4 of `docs/qa/v1.9.0-editor-state.md` (a suggestion made in a background turn, a
source round trip with a live suggestion) for the operator's one-pass review.

## Context and what the inventory found (2026-11-03)

The issue was written against the store the earlier PRs took apart. By `a83ccf2` (the PR 4 tip):

- Restore at load and on `RELOAD` is `applySuggestionMarks` in `openSessionNow` and `replaceSessionDocument`
  (PR 1); the `Editor.tsx` persist effect and the HMR snapshot are gone (PR 1); persistence is projected from the
  marks by `projectSuggestions` (debounced on a document change, at once on `AI_SUGGESTION_RESOLVED_META`, an
  empty set written only after a resolve, #1126), for the active tab (PR 1) and a background one (PR 4).
- The "store" left is `extensions/ai-suggestions/store.ts`: `{ documentId }` set by the session layer in
  `activateSession` and `setSessionIdentity`, plus `saveSuggestions` / `deleteSuggestions` wrappers with no
  callers. Nothing reads `documentId` but two assertions in `session.test.ts`.
- `Session.records.suggestions` is the set as loaded, kept current only because `persistRecords` writes it back
  after each projection; `replaceSessionDocument` re-applied that copy on a source-mode exit instead of the live
  marks.

## The change

Delete `store.ts` and its barrel export; drop `Session.records` / `SessionRecordSets` and the two store writes in
`session.ts`; `replaceSessionDocument` re-anchors the live marks (`getAISuggestions({ state })` of the state
being replaced) by their original text; the `session tripwires` gain "the suggestion store is gone". Hot reload
keeps live suggestions because the sessions live outside React (PR 1); checked by hand on the dev server.

## Tests

Unit: `session.test.ts` already pins restore by `originalText`, the byte-exact projection, the identity write and
(PR 4's `handle.test.ts`) a background suggestion's projection and resolve; the two store assertions go. e2e:
`suggestions`, `suggestions-persist`, `restructure`, `ai-edit-lifecycle`, `source-mode-authority` stay green; the
new tripwire.

## Execution log

- **2026-11-03:** branch from `a83ccf2`; store deleted, session records dropped, reload re-anchors the live marks,
  tripwire added. `typecheck:renderer` 69 (baseline), vitest 85/85, `typecheck:e2e` 8 (baseline).
