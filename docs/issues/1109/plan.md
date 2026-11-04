# #1109 — Fenced code indented inside a list item comes back nested

Issue: https://github.com/solo-ist/prose/issues/1109 (epic #1094, Wave 4c). Branch `issue-1109-indented-code` from
`release/v1.9.0` = `ab0a721`; renderer-only; one PR, merge commit, green CI and claude review. Second item of
tranche 2 (2026-11-04).

## Mechanism, confirmed

- **Parse.** A fence indented four or more columns past a list item's content column is, per CommonMark, an
  *indented code block*: markdown-it's `code` rule wins over `fence`, and the ```` ```sh ```` lines become the
  block's content (no language class). At four spaces under `- ` it is still a fence, which is why the QA pass saw
  it only at deeper nesting.
- **Serialize.** tiptap-markdown's `codeBlock` spec writes a three-backtick fence around the content whatever
  the content holds, so an indented block whose content is a fence re-emits as a fence wrapping a fence. On the
  next parse the inner closing fence line opens an unterminated block: the empty blocks and the fence inflation
  (about two fence lines per affected block per trip; the QA checklist went from 20 to 39).
- What is lost is "this was an indented code block": the `codeBlock` node has no attribute for it.

## Change

- **`extensions/code-block-markdown/index.ts`** (new):
  - `IndentedCodeParse`, an extension whose only job is a markdown-it `parse.setup`: a `code_block` renderer rule
    that writes the default output with `data-indented="true"` on the `<pre>`. A separate extension so the
    `codeBlock` node keeps tiptap-markdown's own parse hooks (`langPrefix`, the trailing-newline `updateDOM`),
    which the spec merge would otherwise replace wholesale.
  - `CodeBlockMarkdown = CodeBlockLowlight.extend(...)`: an `indented` attribute (parsed from `data-indented`,
    rendered back to it), and a `serialize` only. An indented block writes its lines with four leading spaces
    (prosemirror-markdown's `write` adds the list indent per line, so a block inside a list item keeps its
    relative indent); a fenced block writes a fence of `max(3, longest backtick run + 1)` backticks, so content
    holding ```` ``` ```` no longer closes it early. A `~~~` fence in a source file is read fine and written back
    with backticks, as before.
- **`components/editor/extensions.ts`**: `CodeBlockMarkdown.configure({ lowlight })` in place of
  `CodeBlockLowlight.configure`, plus `IndentedCodeParse`.

## Tests

`extensions/code-block-markdown/index.test.ts` (vitest, the app's extension list, parser and serializer): a fence
indented inside a list item round-trips byte for byte with the `indented` attribute set and no language; a
top-level indented block likewise; a fenced block whose content holds a ``` run gets a four-backtick fence and
re-parses to the same content; an ordinary fenced block with a language is unchanged; the fence-line count of
the repo's QA checklist (`docs/qa/v1.9.0-checklist.md` at the release head, 20 fence lines) is unchanged across a
round trip, the issue's measurable signature. Falsified against the unmodified extension list first.

No Electron spec: the serializer and parser under test are the objects the save path uses, and the QA block
covers the typed path.

## Execution log

- 2026-11-04: inventory (above).
