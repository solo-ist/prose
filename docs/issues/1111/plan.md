# #1111 — Add a copy button to code blocks

Issue: https://github.com/solo-ist/prose/issues/1111 (epic #1094, Wave 5; operator request). Branch
`issue-1111-code-copy` from `release/v1.9.0` (after #1191, so `extensions/code-block-markdown` is there);
renderer-only; one PR, merge commit, green CI and claude review. Tranche 3 (2026-11-04).

## Where it goes

Code blocks are `CodeBlockMarkdown` (`extensions/code-block-markdown/index.ts`, the #1109 extension over
`CodeBlockLowlight`). It has no node view today: TipTap renders `<pre><code class="language-x">` and lowlight
paints the tokens through decorations, which a node view with a `contentDOM` keeps. The in-repo precedent for a
node with its own chrome is `extensions/image/nodeView.ts`; the precedent for chrome that must not steal the
selection is `SelectionPopover`'s `onMouseDown` + `preventDefault`.

## Change

- `addNodeView` on `CodeBlockMarkdown`: a wrapper `div.code-block` holding the `<pre><code>` (the `code` element
  is the `contentDOM`, with the language class and the `data-indented` / `data-node-id` attributes mirrored and
  kept current in `update`) and a `button.code-copy` outside the content. The button is `contenteditable=false`,
  takes `mousedown` with `preventDefault` so the caret and a drag selection in the block are untouched, and is
  excluded from ProseMirror's event handling (`stopEvent`) and mutation observer (`ignoreMutation` for anything
  outside the `code` element, so its label can change). Click copies the block's plain text, `node.textContent`
  (never the fence or the language), through `getApi().copyToClipboard`, and shows "Copied" for a moment.
  Keyboard-reachable: a real `<button>` with an `aria-label`, focusable from the block.
- Styles in `index.css`: the button sits in the block's top-right corner, visible on hover and on focus; hidden
  for a read-only editor with `.ProseMirror[contenteditable="false"] .code-copy { display: none }`, which follows
  the editable state with no listener (a preview or reMarkable tab flips it without emitting an update).

## Tests

`e2e/electron.code-copy.spec.ts` (new): a document with a fenced `ts` block and a plain one; hovering a block shows
one copy button; clicking it puts exactly the block's text on the system clipboard (read in the main process),
without the fence or the language, and the editor's selection is unchanged; the button is gone while the editor is
read-only and back after. Falsified on a build of the release head's renderer. Existing code-block behaviour is
pinned by the `code-block-markdown` unit tests (the serializer does not depend on the view) and the editor specs.

## Execution log

- 2026-11-04: inventory (above).
- 2026-11-04, built: plan · the change (node view in `code-block-markdown/index.ts`, styles in `index.css`). Unit
  148/148, `typecheck:renderer` 66, `typecheck:e2e` 6, build clean; `electron.code-copy.spec.ts` 1/1 on the built
  app, failing on the branch base at the first assertion (no button). **PR #1195**; `qa/dev` = release + #1134 +
  #1135 + #1111; QA block §11 in the untracked `docs/qa/v1.9.0-tranche-b.md`.
