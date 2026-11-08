# #1266 — revise_suggestion works on a rejected suggestion

Found by the 1.9.1 acceptance run (#1230), step 8: "The agent revises the rejected one, and the superseded version stays in history." Today `revise_suggestion` only finds a suggestion by its live mark, so a rejected one (no mark) returns SUGGESTION_NOT_FOUND. Branch `issue-1266-revise-rejected` off `release/v1.9.1`. Renderer and shared code only.

## Decision (operator, option a)

- **Pending S**: unchanged. The revision replaces S's mark in one transaction; S becomes `superseded`, linked both ways.
- **Rejected S**: a new **pending** suggestion on the node S was on. The log links them: the new row has `supersedes` = S (`revises` in `list_suggestions`), S gains `supersededBy` = the new id, and a `suggestion:revised` event carries `previousId` = S. **S stays `rejected`**: the writer's decision is never overwritten.
- **Accepted S**: refused (`SUGGESTION_ACCEPTED`). Its text is in the document now; the agent proposes again with `suggest_edit`.
- **Superseded S, or a rejected S that already has a revision**: refused (`SUGGESTION_SUPERSEDED`), naming the newer suggestion to revise instead. One rejected suggestion gets one successor, so the history stays a chain.

## Finding the node of a rejected suggestion

A rejected suggestion has no mark, and the log row stores no node today.

- `SuggestionHistory` gains an additive `nodeId?: string`, filled when the log first sees the mark: `scanSuggestionMarks` reads the host textblock's `nodeId`. It is JSON inside the existing `review_log` store, so **no `DB_VERSION` bump**. Rows from before this change have none.
- `revise_suggestion` gains an optional `nodeId` argument.
- Resolution order for a rejected S:
  1. the explicit `nodeId` argument (must exist, else NODE_NOT_FOUND);
  2. the row's stored `nodeId`, when that node still exists (node ids are regenerated when a document is reopened, so this is the same-session path);
  3. a unique exact match of the row's `originalText` among node texts (innermost matching node, so a list item and its paragraph count once; skipped for an empty original);
  4. otherwise an error: AMBIGUOUS_MATCH (the existing ambiguity code, from `document` targeting) when several nodes match, NODE_NOT_FOUND when none does. Both tell the agent to pass `nodeId` from `read_document` (`get_outline` lists headings only and carries no node ids).
- The resolved node must exist in the current document; `suggest_edit`'s own checks (read-only, plain text, table cells, the destructive-edit guard) still apply.

## Change

- `extensions/review-log/log.ts`: `SuggestionMarkInfo.nodeId`, `SuggestionHistory.nodeId`; `nextLog` gives a non-pending row the forward link when a revision names it and its mark was not live, keeping status, `decidedAt` and `decidedBy`.
- `lib/tools/executors/editor.ts`: `executeSuggestEdit` takes `opts.follows` (a decided suggestion this one revises), linked with `reviseSuggestionIn` in the same transaction as the mark, after any pending suggestion it replaces on that node.
- `lib/tools/executors/review.ts`: `executeReviseSuggestion` branches on the live mark, then on the log row's status, and resolves the node as above.
- `shared/tools/schemas/review.ts`, `shared/tools/mcpMetadata.ts`, `shared/mcp/instructions.ts`: the `nodeId` argument; the description and the server instructions say a rejected suggestion can be revised and stays rejected, and an accepted one cannot.
- `components/editor/AIEditsHistoryPanel.tsx`: a rejected row with a revision reads "Rejected by …", then "Then revised by …" with a "View revision" link while the revision is pending. It never says "Superseded".
- CLAUDE.md (MCP section) and `docs/qa/v1.9.1.md`.

## Tests

- **e2e** `electron.mcp-review.spec.ts`: the writer rejects S → the agent revises S → a new pending suggestion on the same paragraph; S stays `rejected` with `supersededBy`; `list_review_events` shows `suggestion:revised` with `previousId` = S; `list_suggestions include:"all"` shows both. Falsified on the merge-base (`origin/release/v1.9.1`, SUGGESTION_NOT_FOUND). Also: revising an accepted suggestion is refused with SUGGESTION_ACCEPTED; a second revision of S is refused with SUGGESTION_SUPERSEDED.
- **vitest** `review-log/log.test.ts`: the row records its host `nodeId`; a revision of a rejected suggestion links both ways and keeps `rejected`.
- **vitest** `lib/tools/executors/review.test.ts` (new, headless editor): node resolution (stored id, text fallback, explicit `nodeId`, AMBIGUOUS_MATCH on duplicate text, NODE_NOT_FOUND when the text is gone) and the accepted refusal.
- Activity: `electron.activity-review.spec.ts` gains the rejected-then-revised row.
- Baselines: `typecheck:renderer` 66, `tsc -p tsconfig.node.json` 18, `typecheck:e2e` 6, none may grow; `test:unit` green. Specs run locally: this one, `mcp-review`, `review-log`, `activity-review`, `mcp-protocol`, `mcp-connections`.

## Execution log

- **2026-11-08.** `b920b58` plan; `ff35459` the change, the unit tests and the e2e cases. `release/v1.9.1` moved meanwhile (#1264, `6907393`); merged in as `dfe521c`, the only conflict `docs/qa/v1.9.1.md` (both blocks kept, #1266's last).
- **Checks** (after a build: without one, the generated `src/main/env.ts` is missing and both base and branch show 3 more renderer and 7 more node errors):
  - `typecheck:renderer` 66, `tsc -p tsconfig.node.json` 18, `typecheck:e2e` 6: the same as `6907393`.
  - `test:unit`: 39 files, 340 tests, green (`review-log/log.test.ts` +2, `executors/review.test.ts` 9).
  - e2e, `--retries 0`: `mcp-review` (4), `activity-review` (2), `review-log`, `mcp-protocol`, `mcp-connections`: 14 passed. `activity-panel` and `document-sessions` (the tripwires): 28 passed.
  - **Falsified:** the base's `src` (`6907393`) built with the branch's specs: both #1266 cases fail with `No pending suggestion "…". Call list_suggestions for the pending ones. (SUGGESTION_NOT_FOUND)`, the error the acceptance run hit.
- **Choices against the brief:** the ambiguity code is the existing `AMBIGUOUS_MATCH` (from `document` targeting) rather than a new `AMBIGUOUS`; the errors point at `read_document`, because `get_outline` lists headings without node ids.
