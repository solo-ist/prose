# #1166 — Explorer: paste after a cut always targets the source folder

Issue: https://github.com/solo-ist/prose/issues/1166 (epic #1094 QA tail; from the PR #1165 pass, Misc 6). Branch
`issue-1166-explorer-paste` from `release/v1.9.0`; renderer-only; one PR with #1167's sibling fix kept separate.
Tranche 3 (2026-11-04).

## Mechanism, confirmed

`useExplorerActions.pasteFile(targetDir?)` resolves the destination from `targetDir`, else (for a copy) from the
selected item, else the clipboard path's own folder; for a cut it goes straight to the clipboard path's own
folder. Both callers pass nothing: the ⌘V handler and the context-menu Paste. So a cut followed by a paste in
another folder computes `newPath === clipboardPath` and does nothing, and a copy duplicates beside the source
(or into the selected folder, which is the one case that worked). Pre-existing since 2026-03.

## Change

`pasteFile` resolves the destination the same way for both operations, in this order: the explicit `targetDir`;
the selected folder, or the selected file's folder, when the selection is inside the folder being shown; else the
folder the explorer is showing (`rootPath`). The ⌘V handler and the root context menu keep passing nothing and
therefore land in the shown folder; the folder-row context menu already passes the folder. A cut whose
destination equals the source stays a no-op (and clears the clipboard, as before).

## Tests

`e2e/electron.explorer-interactivity.spec.ts` (+2): cut a file with ⌘X, open a subfolder, ⌘V → the file is in the
subfolder and gone from the source; copy a file, open a subfolder, ⌘V → a copy appears in the subfolder and the
source stays. Falsified on a build of the release head's renderer.

## Execution log

- 2026-11-04: inventory (above).
