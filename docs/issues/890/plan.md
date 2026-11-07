# #890 — M4: MCP review tools (the #854 lifecycle, human decides)

Part of epic #1230 (track M). This rebuilds PR #854's MCP review lifecycle on the review log (P2, #1233) and the document targets (M3, #1237). The design is `docs/architecture/review-provenance.md` §5.4. Branch `issue-890-review-tools`, stacked on P2 (#1252), then retargeted to `main`. The tool registry lives in `src/shared/`, and the bridge reads its allowlist from there, so this PR is not security-gated.

## Tools (also available to the in-app chat, by mode)

| Tool | What | Mode |
|---|---|---|
| `list_suggestions` | Pending suggestions, with who proposed each, their feedback and what they revise. `include: "all"` adds decided and superseded history | chat |
| `reply_to_suggestion` | A feedback entry on a pending suggestion, logged with its actor | editor |
| `revise_suggestion` | A new suggestion on the same node that supersedes the old one. Goes through `suggest_edit`'s own validation (the destructive guard, block conversion, tables and plain text refused) | editor |
| `get_review_status` | Pending ids, counts by status, open threads, and the last event `seq` | chat |
| `list_review_events` | Events after a `since` cursor (oldest first, `limit` ≤ 500), each with `by` / `byKind`, plus `nextSeq`. This is how an agent learns the writer's decisions; no call waits for a human | chat |
| `reply_to_comment` | Exposed over MCP (it existed) | editor |
| `reopen_comment` | Reopen a resolved thread, logged with the caller as actor | editor |

All of them take M3's `document` target over MCP. Accept and reject stay human-only (#607): `accept_diff` / `reject_diff` stay off the MCP list. **The renderer now also checks the MCP allowlist itself**, so a call that bypasses the main-process bridge can't run an unlisted tool.

## Fix found on the way

A `suggest_edit` on a node that already has a pending suggestion replaced that suggestion's mark silently, so P2's log recorded it as rejected by the writer. Now the new suggestion **supersedes** any pending one on its node, in the same transaction, with the caller as actor. `revise_suggestion` is that same path, aimed at one suggestion id.

Feedback from an agent is logged but doesn't overwrite the mark's `userReply`, which is the writer's feedback to the in-app chat.

## Moved to P3 (#891)

`suggest_insert` and `suggest_delete` from #854. Suggestions are node-level marks today, so an insertion or a deletion needs the suggestion types and display P3 adds for Suggesting mode.

## Tests

e2e `electron.mcp-review.spec.ts` (port 9235), with calls delivered as the bridge delivers them:
1. An MCP agent suggests.
2. The writer gives feedback.
3. `list_suggestions` shows the feedback by "the writer".
4. `revise_suggestion` supersedes.
5. The writer accepts in Prose.
6. `list_review_events` since 0 returns proposed, feedback, revised and accepted, with `by` labels, and since the last `seq` returns nothing.
7. `get_review_status` agrees.
8. `reply_to_comment` and `reopen_comment` work.
9. `accept_diff` over MCP is refused by the renderer's allowlist.
10. A second `suggest_edit` on a node supersedes the first instead of rejecting it.

The spec is falsified on the merge-base. Unit tests cover the tool list and modes (registry).
