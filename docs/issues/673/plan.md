# #673 — Block-type conversion + .txt/table guards

Part of the AI markdown-editing hardening plan (TestFlight v1.6.1 QA). See
issue #673 for symptoms; #671 (inline-markdown accept) and #672
(instrumentation/test seams) landed first.

## Root causes addressed

1. **Suggestions could never change a node's type.** The `aiSuggestion` mark
   spans the host node's inline content; accept replaced text within the node.
   `# Heading` on a paragraph either kept a literal `#` or had it stripped by
   `stripLeadingBlockMarkup`. Restructuring a flat document was impossible.
2. **`.txt` docs silently flatten markdown** (PlainTextMode) — AI formatting
   work was destroyed without feedback to the model or user.
3. **Table-internal suggestions corrupt GFM serialization** — the mark can't
   represent row/cell structure; replacements land literal pipe text. Tables
   carry no nodeId, so the reachable target is the *paragraph inside a cell* —
   the guard checks ancestors.

## Design

- `detectBlockConversion(content, hostType, hostLevel, isTopLevel)`
  (`executors/editor.ts`): returns the raw markdown when content opens with
  block markup differing from the host (heading level change, `>`, list
  markers, ``` fences), null otherwise. **Top-level paragraph/heading hosts
  only** — converting nested hosts (list items, quoted paragraphs, cells) is
  ambiguous and excluded.
- The raw markdown rides the mark as a new `blockConversionIntent` attr
  (persisted via `data-ai-block-intent`, round-trips through
  `getAISuggestions`/`restoreAISuggestions` so tab switches keep it). The
  popover shows the parsed *visible* text (`sliceVisibleText`).
- **Accept** (`applyBlockConversion`, both `acceptAISuggestion` and
  `acceptAllAISuggestions`): parse the intent via `parseMarkdownToSlice` and
  `tr.replace` the **whole host textblock** with a **closed** slice
  (`new Slice(content, 0, 0)`) — open ends would merge the parsed content back
  into the host node and lose the conversion. `setNodeMarkup` was rejected:
  blockquote/lists are wrapper nodes, not textblocks.
- **Annotations**: single-textblock conversions get word-diff annotations at
  `insertedAt + 1` (content offset inside the new node); wrapper/multi-node
  results get one full-range annotation (nested structure breaks linear
  offset math).
- **Guards**: `PLAIN_TEXT_DOCUMENT` (suggest_edit + edit) and
  `TABLE_NODE_NOT_SUPPORTED` (suggest_edit; edit keeps table access for
  whole-table replacement). Error messages teach the model the recovery path;
  tool schema descriptions updated to match.
- `pipelineLog` events: `suggest_edit:start/result`, `edit:start/result`,
  `accept:path` (which branch fired: blockConversion/multiBlock/inline/
  literal/delete).

## Known limitations (deliberate)

- Adjacent paragraphs converted to single-item lists yield separate lists
  (no cross-suggestion consolidation) — an LLM-prompting concern, not pipeline.
- The popover doesn't yet label the node-type change ("converts to heading") —
  cosmetic follow-up.
- Two block-conversion suggestions on the same node would conflict in the
  accept-all batch; in practice one node holds one suggestion mark at a time
  (same-type marks replace on overlap).

## Verification

- `e2e/electron.restructure.spec.ts` — the user's core scenario: flat .md →
  `#`/`##`/`>`/`-` suggestions → accept (single + batch) → real
  heading/blockquote/bulletList nodes, zero literal syntax, clean
  serialization; heading level change.
- `e2e/electron.suggestions.spec.ts` — `.txt` guard, table guard (cell
  paragraph), executor-driven paragraph→heading conversion; the existing
  literal-fallback test documents that direct `setAISuggestion` (no executor
  context) still refuses structural changes.
