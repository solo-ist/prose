# #1168 — Suggestion popover stays at a fixed screen position while the document scrolls

Issue: https://github.com/solo-ist/prose/issues/1168 (epic #1094 QA tail; from the PR #1165 pass, Misc 2). Branch
`issue-1168-suggestion-popover-follows` from `release/v1.9.0`; renderer-only; one PR. Tranche 3 (2026-11-04).

## Mechanism, confirmed

`AISuggestionPopover.tsx` measures the clicked mark's `getBoundingClientRect()` once, on the click that opens it,
and renders at that point with `position: fixed`; a layout effect then clamps that point into the viewport once.
Nothing re-measures on scroll or resize, so the card stays on screen while the suggestion scrolls away.
`CommentPopover.tsx` has the effect this one lacks: on window `scroll` (capture, which catches the editor's inner
scroller) and `resize`, one animation frame re-reads the mark's rect, re-anchors the card, and closes it for good
once it would sit fully off the pane.

## Change

The same effect on the suggestion popover: while open, on `scroll` (capture) and `resize`, re-read the mark
(`.ai-suggestion-mark[data-ai-suggestion-id="…"]`) in one animation frame and set the popover's position from it,
which already re-runs the viewport clamp; close it when the mark is gone (accepted or rejected) or when the
mark's anchor point is outside the viewport, so the card rides off with its text rather than popping back in on
scroll-back.

## Tests

`e2e/electron.suggestion-popover.spec.ts` (new): a document long enough to scroll with a suggestion made through
`suggest_edit`; clicking the mark opens the popover; scrolling the editor's container by a known distance moves
the popover up by the same distance; scrolling the mark fully out of view closes it. Falsified on a build of the
branch base's renderer (the card's `top` does not change).

## Execution log

- 2026-11-04: inventory (above).
