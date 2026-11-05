# #1204 — Relative image paths resolve against the previous tab's folder after a tab switch

Issue: https://github.com/solo-ist/prose/issues/1204 (QA §8 of the 1.9.0 section-B pass, on #1133). Branch
`issue-1204-image-dir` from `release/v1.9.0` = `d3e4b0e`; renderer-only; one PR, merge commit, green CI and claude
review.

## Mechanism, confirmed

- `resolveImageSrc` (`extensions/image/index.ts`) turns a relative `src` into `local-file://<folder>/<src>` with
  the folder from `getDocumentDir()`, which reads `editorStore.document.path`: the mirror of the active document.
- `activateSession` (`document/session.ts`) calls `view.updateState(session.state)` first (every session has its
  own plugins array, so ProseMirror rebuilds every node view) and writes the mirror after it. While the arriving
  tab's image node views are built, the mirror still names the **leaving** document, so the image resolves
  against the wrong folder. Nothing rebuilds the node view afterwards, so the image stays broken.
- Two documents in one folder hide it (same stale folder); switching from a document in another folder back to
  the one with the pasted screenshot shows it. Regression from #1145: before it, the `setContent` that rebuilt
  the node views ran after the mirror write.

## Change

- `extensions/image/index.ts`: `documentDirOf(state)` reads the folder from the state's own identity
  (`getIdentity(state).path`), which is already the arriving document's while its node views are built.
  `resolveImageSrc(src, docDir?)` takes the folder; the mirror stays only as the default for `renderHTML`, which
  has no editor state at hand (clipboard HTML, `getHTML()`). `saveImageFile` takes the folder from the pasting or
  dropping view's state too, so the paste path reads no mirror either.
- `extensions/image/nodeView.ts`: `syncAttrs` resolves with `documentDirOf(this.view.state)`.
- Not an ordering change in `activateSession`: the design rule is that a state carries its own identity, and the
  mirror is a projection.

## Tests

`e2e/electron.image-paths.spec.ts`, one case added: a document holding the encoded screenshot reference in the
docs folder; a second document in another folder under home; `open_file` the other, `open_file` the first again:
the `<img>` `src` holds the first document's folder and the image has loaded (`naturalWidth > 0`). Falsified on a
build of the merge-base's `src`.

## Execution log

- 2026-11-04: inventory (above).
