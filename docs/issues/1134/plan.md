# #1134 — Table rails keep their size when a sidebar expands or collapses

Issue: https://github.com/solo-ist/prose/issues/1134 (epic #1094, table polish after #1087). Branch
`issue-1134-rails-resize` from `release/v1.9.0`; renderer-only; one PR, merge commit, green CI and claude review.
Tranche 3 (2026-11-04).

## Mechanism, confirmed

`TableControls.tsx` re-measures on window `scroll` (capture), window `resize` and editor transactions. A sidebar
toggle changes the editor pane's width (the `.overflow-auto` scroll container: 1198 → 919 px in a probe) without a
window resize or a transaction, and the editor element itself does not resize at all (it is centred at a fixed
maximum width, `max-w-3xl mx-auto`, so the toggle moves it by 140 px without changing its width), so nothing
scheduled a measure and the grips stayed at the old place.

## Change

A `ResizeObserver` on the scroll container (and the table), created in `setTable` when a table becomes the
tracked one and disconnected when it stops being tracked or the component unmounts, calling the existing
`scheduleMeasure` (coalesced into one animation frame, so an animated toggle re-measures per frame and lands on
the final place). It is created from the table element rather than in the mount effect: at mount time the editor's
DOM is not yet inside the scroll container, so `closest('.overflow-auto')` found nothing and a first attempt
silently observed the editor element, which never resizes.

## Tests

`e2e/electron.tables.spec.ts` (+1): with the rails up, toggle the explorer through the main-process menu action
(not the keyboard: a key in the editor counts as typing and hides the rails; not a toolbar click: moving the
pointer would re-measure on its own), then the append-row grip's centre must sit on the table's new centre.
Falsified on a build of the release head's renderer. The seven existing rail cases stay green.

## Execution log

- 2026-11-04: inventory, probe (above).
- 2026-11-04, built: plan · `193cbfc` the change (rebased onto `b497543` after #1187 merged; the spec rebuilt from
  the release version plus the one case). `typecheck:renderer` 66, `typecheck:e2e` 6, build clean, tables spec
  28/28 on the built app; falsified on the release head's renderer (139.6 px off after the toggle). Found on the
  way: at mount the editor's DOM is not inside the scroll container, so a `closest()` in the mount effect observed
  the wrong element; and falsifying against a base ahead of the branch's own base leaves that base's extra files
  staged after `git checkout HEAD -- src` (use `git merge-base`). **PR #1193**; `qa/dev` = `0067317`; QA §9.
