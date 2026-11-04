# #1107 — Table cells are never escaped for `|`, and markdown-it drops the overflow

Issue: https://github.com/solo-ist/prose/issues/1107 (epic #1094, Wave 4a). Branch
`issue-1107-table-pipe-escaping` from `release/v1.9.0` = `26eca3e`; renderer-only; one PR, merge commit, green CI
and claude review. First of the post-editor-state tranche (2026-11-04).

## Mechanism, confirmed on `26eca3e`

- `tiptap-markdown/src/extensions/nodes/table.js` renders each cell with `state.renderInline`; prosemirror-markdown's
  `esc` escapes `` ` * \ ~ [ ] _ `` and never `|`. A cell holding `a|b` is written as `| a|b |` and parses back as
  two cells; a cell ending in `|` writes `| text| |`, an extra empty cell.
- `markdown-it/lib/rules_block/table.mjs:202` emits `columnCount` (the header's width) cells per body row, so the
  extra cell is dropped on the next parse; a header/delimiter width mismatch (`:130`) degrades the whole table to a
  paragraph. Probed directly: markdown-it unescapes `\|` inside a cell in every inline span, code spans included,
  so escaping on the way out round-trips exactly.
- The same serializer writes each row at its own `childCount` while the delimiter row follows row 0, so a ragged
  table (`tableCommands.ts` `isUniformGrid === false`) loses every cell past the header's width.
- tiptap-markdown's `HTMLNode` and `childNodes` are not importable: the package `exports` only its entry point.

## Change

`src/renderer/extensions/table-markdown/index.ts`: `TableMarkdown = Table.extend({ addStorage })` overriding the
table's `serialize` only (tiptap-markdown spreads its default spec under ours, so `parse` stays with markdown-it).
Same output shape as the default (layout, `state.inTable`, the HTML fallback under the same `isPipeSerializable`
rule, reproduced locally with `getHTMLFromFragment` and a string-level `formatBlock`), plus:

1. every `|` in a cell's rendered markdown is escaped as `\|` (applied to the rendered slice of `state.out`, so
   code spans and link text are covered, not only plain text);
2. every row, header included, is padded with empty cells to the widest row, and the delimiter row has that width.

`components/editor/extensions.ts` uses `TableMarkdown.configure(...)` in place of `Table.configure(...)`.
No `fixTables` transaction at load (padding at serialization loses nothing and adds no load-time write, which the
editor-state rules discourage). A foreign file whose body row is wider than its header is still parsed per GFM
(extra cells ignored); that is markdown-it's rule on input Prose did not write, and out of scope here.

## Tests

- `extensions/table-markdown/index.test.ts` (vitest, the app's extension list): pipe in a cell round-trips as one
  cell and the output is idempotent; a cell ending in a pipe; a pipe inside a code span; a ragged table padded to
  its widest row with every cell back after a parse; a spanning table still an HTML block; pipes outside tables
  untouched; a hard break in a cell still `<br>`; `escapePipes`.
- `e2e/electron.tables.spec.ts`: a pipe typed into a cell stays one cell across a serializer round trip; a cell
  ending in a pipe keeps the column count. The existing 28 table tests stay green (`expectPipeTable`).

## Execution log

- 2026-11-04: inventory (above); extension, unit tests and plan written. Falsification: the unit tests run against
  the unmodified extension list first (the escape and padding cases must fail), then with `TableMarkdown` wired.
