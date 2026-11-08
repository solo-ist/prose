# #888 — the three standalone fixes from PR #854, checked against main

#888 lifted three fixes out of @shanelindsay's PR #854 (written against the pre-1.9.0 editor). Since then the
editor-state series (#1145–#1152) moved comments, suggestions and annotations into per-tab plugin state and rewrote
the save paths. This PR checks each defect against main (`4f4d899`), fixes what is still there and guards what isn't.

| #854 fix | The defect | On main |
|---|---|---|
| Comment-removal dedup | `unsetComment` called `onCommentRemoved(id)` once per **text node** carrying the mark, before dispatch, so a comment whose text has inline formatting (several text nodes) fired the store removal and the share push several times | **Gone.** `onCommentRemoved` no longer exists. Removing a thread is one `remove` meta in the threads plugin (`removeThread` → `removeThreadFrom` + `removeMarksOf`, `extensions/comments/extension.ts`), and the share push is derived once per thread from the plugin's transition. Guarded by a new vitest case. |
| `useEditor` stale closure | `saveContentAs` read `document.documentId` without listing it in its `useCallback` deps, so Save As could migrate records from a stale document id | **Gone.** No save callback reads render-time document state: each reads the active tab at call time (`activeSave()` → `useTabStore.getState()`, `hooks/useEditor.ts`), and Save As re-identifies through `markActiveTabSaved` → `markTabSaved` → `setTabIdentity`, which read the tab record by id (`tabs/actions.ts`). Citation, no test. |
| Reject-all callback dedup | `rejectAllAISuggestions` calls `onSuggestionRejected(id)` once per text node, before dispatch | **Still in the code** (`extensions/ai-suggestions/extension.ts`, the `rejectAllAISuggestions` command). Latent: nothing in the app sets `onSuggestionRejected` today, and the review log's decisions already go through a de-duplicated set. Fixed: one callback per suggestion, after the transaction is dispatched, as `rejectAISuggestion` does. |

## Tests

- `extensions/ai-suggestions/callbacks.test.ts` (new): with the callbacks configured on a headless editor, a suggestion
  whose text spans several text nodes fires `onSuggestionRejected` once from reject-all, after dispatch (the marks are
  gone when it fires); single reject and accept-all fire once per suggestion (guards). Reject-all fails on the
  merge-base (two calls for one suggestion, the first before dispatch).
- `extensions/comments/plugin.test.ts` (+1): a thread over formatted text (three text nodes) yields exactly one
  `remove` share push when removed and one `resolve` push when resolved.

Renderer-only: ungated. Nothing for the operator to check by hand.
