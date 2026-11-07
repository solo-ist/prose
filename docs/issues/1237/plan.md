# #1237 — M3: MCP targeting and manners

Part of epic #1230 (track M). Branch `issue-1237-mcp-targeting` from `main` = `54aa64b`. Renderer and shared only; not security-gated.

## Problem

Every MCP call acts on whichever tab the writer has in front of them. An agent can't comment on the document it read a minute ago once the writer has switched tabs, and `suggest_edit` / `add_comment` call `.focus().setTextSelection(…)`, which moves the writer's caret and takes focus from wherever they are typing (the chat input, the find bar).

## Change

1. **A `document` argument on every MCP document tool** (`read_document`, `get_outline`, `suggest_edit`, `list_comments`, `add_comment`, `resolve_comment`): a `documentId` or a path, as `list_tabs` reports them. It is added to the MCP-facing schema only (`getToolsForMCP` in `src/shared/tools/registry.ts`), so the in-app chat, which is already bound to its conversation's document (#1148), is unchanged. Omitted → the active tab, as today.
2. **Resolved to an open tab only** (`lib/tools/mcpTarget.ts`): the target must match an open tab's `documentId` or `path`; it becomes a `ToolBinding` with that tab and **no path**, so `resolveToolHandle` never reopens from disk. A background reopen reads through `window.api.readFile`, without the tool path policy `open_file` enforces (home and workspace roots, no hidden folders), so an MCP-supplied path must not reach it. A closed document fails with `DOCUMENT_NOT_OPEN`, naming `open_file`. A target that stops matching mid-call (renamed, closed) fails with the existing `DOCUMENT_CLOSED`.
3. **No caret or focus stealing**: `executeTool` takes `{ preserveView }`, set by the MCP handler and carried on the `ToolContext`. With it, `suggest_edit` and `add_comment` apply their mark in one chain that selects the range, applies the mark and restores the writer's selection, with no `.focus()`. Tab-changing tools (`open_file`, `select_tab`, `create_and_open_file`) still change the tab; that is their job.
4. The bridge timeout moves to M2 (#1236), which touches main anyway, so this PR stays renderer-only.

## Tests

`e2e/electron.mcp-targeting.spec.ts` (port 9233). Calls arrive the way the bridge delivers them, `mcp:tool:invoke` from the main process, with results captured from `mcp:tool:result`.
- Background targeting: with B active, `add_comment` and `suggest_edit` targeting A (by documentId, then by path) land in A. B stays active, B's selection is unchanged, and B has no new records.
- `read_document` on a background target returns that document's text.
- A closed document's path returns `DOCUMENT_NOT_OPEN`, and no tab opens.
- Manners: with the writer's selection in B and focus in the chat input, an untargeted `add_comment` on B leaves the selection and `document.activeElement` as they were.
- The MCP `tools/list` schema carries `document` on the six tools only.
- Falsified on a build of the merge-base.

Unit: `mcpTarget.test.ts` covers documentId match, path match, no match, and an empty or oversized target.
