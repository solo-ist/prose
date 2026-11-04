# #862 — Frontmatter round-trip rewrites bare YAML dates as full ISO timestamps

Issue: https://github.com/solo-ist/prose/issues/862 (epic #1094, Wave 3 remainder). Branch `issue-862-yaml-dates`
from `release/v1.9.0` = `26eca3e`; renderer-only; one PR, merge commit, green CI and claude review. Second item of
the post-editor-state tranche (2026-11-04), independent of #1107.

## Mechanism, confirmed on `26eca3e`

js-yaml's `DEFAULT_SCHEMA` implements YAML 1.1 timestamps: `date: 2026-09-04` loads as a JS `Date`, and `dump`
writes it back as `2026-09-04T00:00:00.000Z`. Probed: the default schema also turns a quoted `'2026-01-01'` into a
`Date`; `CORE_SCHEMA` extended with every other default type (`merge`, `binary`, `omap`, `pairs`, `set`) but not
`timestamp` loads both as strings and dumps `2026-09-04` bare (js-yaml quotes a scalar only when the dump schema
would read it as another type). The `Date` value is also what made the frontmatter panel lock the row (non-string)
and what #1105 defect 3 chased (a new `Date` instance on every parse); PR 7 moved the panel to value comparison, so
only the lock and the rewrite are left.

Three call sites: `lib/markdown.ts` (`parseMarkdown` / `serializeMarkdown`, the save path, HTML export),
`lib/tools/executors/editor.ts` (the `edit` tool's frontmatter payload, parsed twice), and
`lib/tools/executors/document.ts` (`read_document`'s synthetic frontmatter node). The main process uses its own
YAML for reMarkable sync and is untouched (gated).

## Change

- `lib/markdown.ts`: `FRONTMATTER_YAML_SCHEMA` (core + merge/binary/omap/pairs/set, no timestamp) and two helpers,
  `loadFrontmatterYaml(text)` and `dumpFrontmatterYaml(value, options?)`, used by `parseMarkdown` and
  `serializeMarkdown`.
- `executors/editor.ts`, `executors/document.ts`: the helpers in place of the direct `js-yaml` calls, so a date the
  model writes is a string too and `read_document` shows it as written.

Known, accepted: a date that was quoted (`'2026-01-01'`) is written bare on the next save, once; a document whose
frontmatter uses `!!timestamp` explicitly no longer resolves it (none do).

## Tests

`lib/markdown.test.ts` (+4): bare date and timestamp round-trip byte for byte; a date string dumps bare; the
model-payload loader uses the same schema; the other YAML scalars and lists still parse. Falsified against the
unmodified `markdown.ts` first.

## Execution log

- 2026-11-04: inventory and probe (above); tests written first.
