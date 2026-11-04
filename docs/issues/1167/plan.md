# #1167 — Explorer: the `..` row is not a drop target

Issue: https://github.com/solo-ist/prose/issues/1167 (epic #1094 QA tail; from the PR #1165 pass, Misc 5). Branch
`issue-1167-dotdot-drop` from `release/v1.9.0`; renderer-only; one PR. Tranche 3 (2026-11-04).

## Mechanism, confirmed

The `..` button in `FileListPanel` navigates up on click and has no drag handling. It sits inside the list
container, whose `onDrop` calls `handleFileDrop(sourcePath, rootPath)` with the folder being listed, so a file
dropped on `..` is "moved" into the folder it is already in, which `handleFileDrop` treats as nothing to do. The
button is already hidden at a project's root, the upward ceiling for navigation.

## Change

The `..` button gets its own `onDragOver` (accept the explorer's `application/prose-file-path` payload, `move`
effect), `onDragEnter` / `onDragLeave` for a drop-over highlight in the folder rows' style, and `onDrop` that
stops the event (so the container's handler does not also run) and calls `handleFileDrop(sourcePath,
dirname(rootPath))`. The ceiling is unchanged: the button is not rendered at a project's root, so there is no
drop target there.

## Tests

`e2e/electron.explorer-interactivity.spec.ts` (+1): with a subfolder open, drag a file from it onto `..` (a
synthetic `drop` with the explorer's own data-transfer type on the `..` row) → the file is in the parent folder
and gone from the subfolder. Falsified on a build of the release head's renderer.

## Execution log

- 2026-11-04: inventory (above).
