# #885 — The dirty flag follows the document; close and reload decisions read a landed flag

Issue: https://github.com/solo-ist/prose/issues/885 (epic #1094; also under #874). Branch `issue-885-dirty-tracking`
from `release/v1.9.0` = `55c8454`; renderer-only; one PR, merge commit, green CI and claude review. The release
tail's last code item (2026-11-05): the operator chose to finish #885 in 1.9.0 rather than move its remainder.

## What is left of #885, confirmed

- Both halves of the issue as filed are gone since PR 6 (#1150): the CodeMirror state is recorded by reference on
  every transaction and flattened once per 500 ms pause (`projectSource`), and the ProseMirror state waits for the
  exit. The item the issue's 2026-11-01 comment left open is "incremental dirty tracking".
- Measured on the worktree (`@codemirror/state` `Text`): the per-pause work that remains in source mode is
  `doc.toString()` + `parseMarkdown` + one string compare, 0.04 ms at 100 KB and 0.3 ms at 1 MB. There is no typing
  latency left to win. What the design costs is correctness: the dirty flag trails the document by up to the
  projection delay, and three decisions read it raw:
  - `closeTab` (`tabs/actions.ts:537`) and the toolbar's `handleTabClose` (`Toolbar.tsx:167`): type, then ⌘W or
    click × inside the delay → no "Save changes?" prompt, the tab closes as clean, the file on disk lacks the edit.
    The same class as #1127 (fixed for the tab switch) on the close path.
  - `closeOtherTabs` / `closeAllTabs` and the toolbar's bulk-close confirm: an untitled tab typed into inside the
    delay is discarded without a prompt.
  - The focus-time disk check (`App.tsx:164`): a tab typed into inside the delay whose file changed on disk is
    reloaded from disk over the typing instead of raising the conflict toast.
  - Not affected: every save path flushes through `saveSnapshot`; the tab switch flushes in `leaveTab`; autosave
    arms from the dirty transition and its save flushes.

## Change

1. **Source mode: the dirty flag follows every transaction** (`document/session.ts`). `SourceSession.saved: Text |
   null` is the CodeMirror document equal to the saved file: the entry document when the tab is clean at entry; the
   document a save wrote (`recordSaved` in source mode: the live document when its text is the snapshot's, else
   `Text.of(snapshot.text)`); `null` while the tab is dirty at entry and unsaved since. On a document change
   `setSourceState` computes `dirty = saved ? !state.doc.eq(saved) : true` and writes `isDirty` to the tab record at
   once when it differs. The content projection stays on the delay; `projectSource` hands the same rule to
   `writeProjection` (the body/frontmatter compare only while `saved` is null), so the projection never flips the
   flag back. `Text.eq` compares chunks by identity before content, so after one edit it is O(changed region):
   0.000 ms at 1 MB against 0.3 ms for the flatten (bench in the PR body).
2. **Decisions land the projection first.** `session.ts` exports `landProjections(tabId)` and
   `landAllProjections()`. `closeTab` lands before its dirty check; `closeOtherTabs` / `closeAllTabs` land every
   tab first; the toolbar's single close uses `closeTab`'s return instead of a raw read, its bulk close and the
   disk check call the helper and read the fresh record.
3. Rich mode keeps the projection compare: the markdown is the truth there, and a mark-only transaction (a comment,
   a suggestion) must not dirty. Its decision points are covered by 2.

## Tests

- vitest, `document/session.test.ts`, new describe "dirty follows the document (#885)": source mode clean at
  entry → typing dirties at once with no timer, undo to the entry text cleans at once, the projection agrees;
  dirty at entry → dirty at once, a save cleans, typing dirties again; rich mode → typing then `landProjections`
  dirties without the delay.
- e2e, `e2e/electron.dirty-follows.spec.ts` (new): rich mode, type then click the tab's × at once → "Save
  changes?" (falsified on the base: the tab closes); source mode, type → the dirty marker before the projection
  delay, ⌘Z → clean at once.
- Must stay green: `source-mode-authority`, `document-sessions`, `tab-switch-flush`, `frontmatter-*`, `autosave*`.

## Docs

Design doc §4.9 (one sentence) and §11's "What waits" line; `CLAUDE.md` Editor paragraph; this log.

## Execution log

- 2026-11-05: inventory (above); plan committed.
- 2026-11-05, built: the change in one commit (`session.ts`: `SourceSession.saved`, the immediate flag in
  `setSourceState`, the rule handed to `writeProjection`, `recordSaved` in source mode, `landProjections` /
  `landAllProjections`; `tabs/actions.ts` close paths; `Toolbar.tsx` single and bulk close; `App.tsx` disk check).
  Unit 159/159 (19 files; 3 new), `typecheck:renderer` 66 (= baseline), e2e tsc 6 (= baseline), build clean.
  `electron.dirty-follows.spec.ts` 2/2 on the fix; **falsified on a build of the merge-base `55c8454`**: both
  fail there (the close lands on a clean flag and the tab goes without a prompt; the source flag is still false
  right after the keystroke). The close case had to pre-hover the × so the click lands inside the delay: with an
  ordinary `click()` Playwright's actionability wait took longer than the projection delay and the base passed.
  Bench (`@codemirror/state` `Text`): `eq` after one edit 0.000 ms at 1 MB, flatten + compare 0.3 ms.
