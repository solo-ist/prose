# #1106 — Find-bar highlights do not follow edited text

Issue: https://github.com/solo-ist/prose/issues/1106 (epic #1094, Wave 3 remainder; waited for PR 1 of the
editor-state series). Branch `issue-1106-find-bar` from `release/v1.9.0` = `26eca3e`; renderer-only; one PR,
merge commit, green CI and claude review. Third item of the post-editor-state tranche (2026-11-04).

## Mechanism, confirmed on `26eca3e`

- `extensions/search-highlight/index.ts` maps its decoration set on `docChanged` (`:115-117`) and then throws the
  mapped set away: the rebuild branch runs on every doc change (`:125`) from the stale `results` the FindBar
  handed it, so highlights stay at pre-edit offsets. The `.map()` is dead code.
- `FindBar.tsx` scans once per term (`:63-101`) into React state and never re-scans on an edit: the counter goes
  stale, next/prev navigate to stale ranges, and the plugin's bounds check (`:135-137`) silently drops matches the
  edit pushed out of range, which reads as "matches elsewhere stop updating".
- The command writes `this.storage` outside the transaction (`:61-84`); nothing else reads that storage.
- The bar's scroll helper assumes an `.overflow-auto` ancestor (`:109-122`). `jumpToPosition` cannot replace it
  as the issue suggests: it focuses the editor, and the bar must keep the focus in its input for Enter / ⇧Enter
  to keep navigating. A selection set through a transaction with `scrollIntoView()` scrolls without focusing.
- No Electron spec covers the find bar (`search-match` appears only in the shared-view spec, the web viewer).

## Change

The plugin owns the search: term, matches and the current index are plugin state, computed from the document
inside `apply` (design `docs/architecture/editor-state.md` §6: positions live in plugin state, nothing polls).

- **Plugin state** `{ term, results, currentIndex, decorationSet }`. Metas: `{ term }` (re-scan, index to 0),
  `{ currentIndex }`, `{ clear: true }`. On `docChanged` with a term, re-scan the new document and keep the current
  match by position: map the old current match's `from` through the transaction and pick the nearest new match.
  Decorations are rebuilt only when term, results or index changed. The scan runs per textblock over the block's
  concatenated text (a match across two text nodes with different marks, `bo**ld**`, is found; the old scan was
  per text node), case-insensitive, capped at 500 decorations as before.
- **Commands** `setSearchTerm(term)`, `setSearchIndex(index)`, `clearSearchHighlight()`; `setSearchHighlight` and
  the extension storage go (no other caller).
- **`FindBar`** reads `{ results, currentIndex }` through `useEditorState` with a selector on the plugin state;
  its own state is the input text. The debounced effect dispatches `setSearchTerm`; next/prev dispatch
  `setSearchIndex` and reveal the match with one transaction: `setSelection` + `scrollIntoView()`, no focus change,
  no DOM assumptions. `search:show` and `find:focus` unchanged.

## Tests

- `extensions/search-highlight/index.test.ts` (vitest, the app's extension list): a term finds every occurrence;
  typing above a match shifts it and the decorations; deleting a match drops the count and keeps the index on the
  nearest match; typing a new occurrence adds it; a match across a mark boundary is found; clear empties the set.
- `e2e/electron.find-bar.spec.ts` (new, port 9229): open the bar with ⌘F, search a word with three occurrences,
  edit above the first: every `.search-match` still covers the word and the counter stays `1/3`; delete one
  occurrence: `1/2`; type a new one: back to three. Falsified on a build of `26eca3e`'s renderer.

## Execution log

- 2026-11-04: inventory (above).
- 2026-11-04, built: `a0c473f` plan · `185fdf8` the change · a follow-up commit gives the spec's counter locator a
  structural fallback so it also runs on the pre-#1106 bar. Unit 111/111 (13 files; 8 new), `typecheck:renderer`
  66 (= baseline), `typecheck:e2e` 6 (= baseline), build clean, `electron.find-bar.spec.ts` 4/4 on the built app.
  Falsification on a build of `26eca3e`'s renderer: 3 of 4 fail at the behaviour they pin (stale highlight text after
  typing above; the counter still `1/3` after a delete; reopening with the same term painted nothing on the old bar,
  which scanned only when the term string changed); the navigation case passes on both and is a guard. **PR #1185**
  open onto `release/v1.9.0`; `qa/dev` = `8b87414`; QA block §3 in the untracked `docs/qa/v1.9.0-tranche-b.md`.
  `useEditorState` returns `null` for a nullable editor, hence the `NO_SEARCH` default in the bar.
