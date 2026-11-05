# #1203 — Find bar after #1106: no scroll while the input has focus; a closed bar leaves highlights in other tabs

Issue: https://github.com/solo-ist/prose/issues/1203 (QA §3 of the 1.9.0 section-B pass, two notes on #1106). Branch
`issue-1203-find-bar` from `release/v1.9.0` = `d3e4b0e`; renderer-only; one PR, merge commit, green CI and claude
review.

## Mechanism, confirmed

1. **Scroll.** `FindBar.reveal()` dispatches `setSelection(match).scrollIntoView()` without focusing the editor,
   on purpose, so Enter and ⇧Enter keep working in the input. ProseMirror's `scrollToSelection` calls
   `scrollRectIntoView(view, rect, startDOM)` with `startDOM` = the DOM selection's focus node and walks *that
   node's* scrollable ancestors. With the focus in the find input, that node is in the bar, a sibling of the
   editor pane, so the pane never scrolls. It worked only when the DOM selection still sat inside the editor
   (right after a click or an edit there): the "tied to clicking around, or editing" the QA saw.
2. **Stale highlights.** The search plugin state is per tab since #1145 (one `EditorState` per session).
   `FindBar`'s clear-on-close effect runs once, against the active state. A tab searched before a switch keeps
   its term and results, and paints them when it comes back with the bar closed.

## Change

- **`components/editor/FindBar.tsx`**: `scrollMatchIntoView(view, pos)` scrolls the editor pane
  (`view.dom.closest('.overflow-auto')`, as the popovers find it) by hand from `view.coordsAtPos(pos)`: a match
  outside the pane's middle band is centred, one inside leaves the pane alone. `reveal()` dispatches the selection
  (no `scrollIntoView`, which did nothing from here) and calls it; the focus stays in the input. The clear effect
  gains the plugin term the bar already reads as a dependency, so a tab that arrives with a term while the bar is
  closed is cleared on arrival; the close itself clears as before.

## Tests

`e2e/electron.find-bar.spec.ts`, two cases added: Enter and ⇧Enter from the input reveal matches below the fold
(60 filler paragraphs between them) with the current match inside the pane, the pane scrolled, and the input still
focused; a document searched in tab A, a switch to tab B, the bar closed there, back to A: no `.search-match` left.
Falsified on a build of the merge-base's `src`.

## Execution log

- 2026-11-04: inventory (above).
- 2026-11-04, built: `0c69ccb` plan · `c1322c5` the change. `typecheck:renderer` 66 (= baseline), e2e tsc 6 (= baseline),
  build clean; `electron.find-bar` 6/6 on the fix. **Falsified** on a build of the merge-base's `src` (`d3e4b0e`): both
  new cases fail there (the current match never enters the pane; tab A comes back with 3 highlights), the four #1106
  cases pass on both builds; HEAD restored and rebuilt.
