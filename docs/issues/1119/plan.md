# #1119 — `edit` lands inline markdown literally after its first streamed chunk

Issue: https://github.com/solo-ist/prose/issues/1119 (epic #1094, Wave 4; found while fixing #1099 and #1100).
Branch `issue-1119-streamed-markdown` from `release/v1.9.0` = `26eca3e`; renderer-only; one PR, merge commit, green
CI and claude review. Fourth item of the post-editor-state tranche (2026-11-04), after #1107.

## Mechanism, confirmed on `26eca3e`

`applyInsertion` (`lib/tools/executors/editor.ts`) streams a payload in word groups when the document is shown and
`prefers-reduced-motion` is off. Chunk 0 goes through `insertContent`, which tiptap-markdown overrides to parse
markdown inline; every later chunk goes in through raw `tr.insertText`. So `**bold**` past the first word group is
inserted as characters (the serializer then writes `\*\*bold\*\*`), and `Line one.\n\nLine two.` becomes one
paragraph holding literal newlines. With reduced motion on, the whole payload is parsed in one transaction and the
same payload comes out right: the bug depends on an accessibility setting. `edit` and `insert` with
`position: 'cursor'` share the path; `insert` with `before_node` / `after_node` already parses through
`parseMarkdownToSlice` (#571) and a whole-table `edit` routes around streaming (#1100).

The annotation written afterwards uses the raw payload as `newText` for the word diff, so even a correctly parsed
inline payload would annotate offsets of the markdown source, not of the rendered text (the rule
`parseInlineSuggestion` already states for suggestion acceptance).

## Change

- `applyInsertion` parses the payload once (`parseMarkdownToSlice`) and streams only what streaming can represent:
  a payload whose parse is one paragraph of plain text equal to the payload streams word by word as today; anything
  else (inline marks, several blocks, a list, a heading, a leading or trailing space the parser would trim) is
  inserted in one parsed transaction, the path reduced motion already takes. It returns the end position and the
  **visible text** of what it inserted (`sliceVisibleText` of the parsed slice, the payload itself when plain).
- `executeEdit` and `executeInsert` (`cursor`) pass that visible text as `newText` to `buildWordDiffAnnotations`, so
  word-diff offsets index the rendered document and a multi-block payload takes the builder's full-range branch
  (`newText` contains `\n`). `ai-provenance`'s `to − from === AI_TEXT.length` for a two-paragraph payload holds: the
  two characters of `\n\n` become the two positions of the paragraph boundary.

## Tests

- `e2e/electron.edit-markdown.spec.ts` (new, port 9229): the three rows of the issue through the real `edit` tool on
  the shown document, with motion on and with `page.emulateMedia({ reducedMotion: 'reduce' })`: the saved markdown
  contains `**bold**` (not `\*\*bold\*\*`) in a paragraph and in a table cell, and a two-paragraph payload comes back
  as two paragraphs; the annotation over the bold payload covers the rendered text. Falsified on a build of
  `26eca3e`'s renderer (motion on). A plain payload still streams (the word-group transactions are observable as
  more than one `transaction` event).
- Existing specs that pin the path: `ai-provenance` (streamed length), `ai-edit-lifecycle`, `restructure`,
  `comment-auto-resolve` (AI replacement over a comment), `tables` (`edit` on a cell and a whole table).

## Execution log

- 2026-11-04: inventory (above).
- 2026-11-04, built: `9e06669` plan · `9b7c354` the change. Unit 103/103, `typecheck:renderer` 66 (= baseline),
  `typecheck:e2e` 6 (= baseline), build clean; `electron.edit-markdown.spec.ts` 7/7 on the built app, the five
  neighbouring AI-edit and table specs 42 passed. Falsification on a build of `26eca3e`'s renderer: 4/7 fail (the
  three motion-on rows with literal markup; with motion off the annotation overshoots the rendered sentence by the
  four asterisks); the two reduced-motion content rows and the streaming case pass on both. **PR #1186** open onto
  `release/v1.9.0`; `qa/dev` = `cae8c22`; QA block §4 in the untracked `docs/qa/v1.9.0-tranche-b.md`. Found on
  the way: `read_document` lists a table before its cells and the table has no id, so a spec helper looking a cell
  up by text must take the deepest id-bearing match.
