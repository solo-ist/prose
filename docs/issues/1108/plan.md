# #1108 — No GFM pipe-table input rule: a table cannot be created by typing markdown

Issue: https://github.com/solo-ist/prose/issues/1108 (epic #1094, Wave 4b). Branch `issue-1108-table-input-rule`
from `release/v1.9.0`; renderer-only; one PR, merge commit, green CI and claude review. First item of tranche 2
(2026-11-04), after #1107 (the serializer must escape pipes before a typed pipe can be cell content).

## Mechanism, confirmed

There is no table input rule or paste rule anywhere: the only `addInputRules` in the renderer is the footnote
reference (`extensions/footnotes/index.ts:66-85`), `@tiptap/extension-table` ships none, and markdown becomes a
table only inside the parser (file open, paste). Two typed pipe rows stay two paragraphs, and never heal on reload
either: paragraphs serialize with a blank line between them, and markdown-it needs the delimiter row right under
the header. Tables are created from the Edit menu (`lib/tableCommands.ts` `insertTable`, header row on) or by
pasting markdown.

## Change

`extensions/table-input-rule/index.ts`, an extension with one `InputRule`, modelled on the footnote rule (an
anchored regex, a transaction-level handler):

- Fires when a delimiter row is completed in a paragraph: `/^\|(?:\s*:?-{3,}:?\s*\|)+$/` on the text before the
  caret. The paragraph before it must be a pipe row with the same number of cells (`| a | b |`, outer pipes
  required, `\|` is a literal pipe inside a cell); otherwise nothing happens and the text stays as typed.
- The two paragraphs are replaced by one table: the header row from the typed row's inline content split at the
  pipes (marks typed with ⌘B survive, cell edges trimmed), built from `tableNodeTypes(schema).header_cell` with
  exactly one paragraph per cell (the all-header-first-row invariant the pipe serializer needs), plus one empty
  body row with the caret in its first cell, so the next thing typed is the first body cell. Backspace right
  after undoes the conversion (TipTap's `undoInputRule`).
- Alignment colons in the delimiter row are accepted and dropped, on purpose: tiptap-markdown never writes
  alignment, so storing it would be lost on the next save.
- Not covered, by design: rows without outer pipes (`a | b`), and a delimiter row typed before its header.

## Tests

- `extensions/table-input-rule/index.test.ts` (vitest, the app's extension list; the rule is driven through the
  view's `handleTextInput` the way TipTap's own tests do): header + delimiter become a table with header cells and
  one body row and serialize as a pipe table; a cell count mismatch leaves the paragraphs; a delimiter with no
  previous row leaves it; alignment colons convert and are dropped; `\|` in a header cell is a pipe; a bold mark
  in the header survives.
- `e2e/electron.tables.spec.ts` (+2): type a header row, Enter, a delimiter row → a table with the right header
  and a pipe table on save; a lone pipe row followed by prose stays a paragraph.

## Execution log

- 2026-11-04: inventory (above).
