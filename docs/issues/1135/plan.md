# #1135 — "Back to activity" after resolving every comment lands on the Chat tab, not Activity

Issue: https://github.com/solo-ist/prose/issues/1135 (epic #1094, quick win). Branch `issue-1135-back-to-activity`
from `release/v1.9.0` = `b497543`; renderer-only; one PR, merge commit, green CI and claude review. Tranche 3
(2026-11-04).

## Mechanism, confirmed

`ReviewContainer` passed `onExit={() => setReviewMode(null)}` to `CommentReviewPanel`, and the done state's
"Back to activity" button used that same `onExit`. The Chat / Activity choice is `sidebarMode`, local state in
`ChatPanel`, and nothing set it on exit, so the sidebar came back on whatever tab it was on before, usually Chat.
The same `onExit` serves the panel's close button and Escape, where returning to the previous tab is right.

## Change

- `ChatPanel` hands `ReviewContainer` an `onReturnToActivity` callback (`setSidebarMode('activity')`).
- `ReviewContainer` passes `CommentReviewPanel` an `onDone` that calls it and then clears the review mode; `onExit`
  is unchanged for the close button and Escape.
- `CommentReviewPanel`'s done state takes `onDone` for its "Back to activity" button and keeps `onExit` for ✕.
- `StatusBar` gains `data-testid="status-bar"` so a spec can address its open-thread count (the chat chip offers a
  button with the same text).

## Tests

`e2e/electron.comment-review-exit.spec.ts` (new): a comment through `add_comment`, the sidebar opened on Chat,
Comment Review from the status bar, the thread resolved through `resolve_comment` so the done state shows, then
"Back to activity" selects the Activity tab; a second round closed with ✕ stays on Chat. Falsified on a build of
the release head's renderer.

## Execution log

- 2026-11-04: inventory (above).
