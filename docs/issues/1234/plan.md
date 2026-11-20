# #1234 — P4: Activity over the review log

Part of epic #1230. Stacked on P2 (#1252), then retargeted to `main`. Renderer only.

## Change

- **Suggestion rows.** Each comes from the review log (`selectReviewLog`, a reference-stable selector) and shows:
  - the status (Pending, Accepted, Rejected, Superseded);
  - who proposed it, and who decided it and when;
  - the original and suggested text;
  - the explanation;
  - the feedback thread, expandable;
  - what it revised or was replaced by.

  Rows sort by their latest moment: the decision, else the last feedback, else the proposal.
- **Clicking a pending suggestion** opens Quick Review on that suggestion (from #854).
- **Filters.** Two new rows, "Pending" and "Decided" suggestions. A new "People and agents" section offers Everyone, or one label: you, a reviewer, a Prose Agent model, or an MCP connection. An item passes when that actor made or touched it:
  - for a comment: who wrote the comment or any reply;
  - for a suggestion: who proposed it, decided it or gave feedback on it.

  The tab badge counts what the filters show, as it does today.
- **Not in this PR.** A raw event timeline: the rows already reflect every event, and agents get the events through M4.

## Tests

`e2e/electron.activity-review.spec.ts` (port 9236):
- a suggestion proposed by a Prose Agent, given feedback by the writer, revised by an MCP agent and accepted by the writer shows as one Superseded row and one Accepted row, with the right names and feedback;
- the actor filter narrows to the MCP connection's items, and the badge follows;
- clicking a pending row opens Quick Review on it;
- the spec is falsified on the merge-base.

## Execution log

- **2026-11-07.** `a748bd6` plan; then the change and spec; then the Activity spec's badge counts, which grow by the accepted suggestions by design. P2 merged as `0c22d7e` meanwhile, so the PR targets `main`.
- **Checks:**
  - `typecheck:renderer` is 66 and `typecheck:e2e` is 6, both the same as the base.
  - `electron.activity-review.spec.ts` passes on the branch. **On `0c22d7e`, P2 without this PR, it fails: Activity has no suggestion rows.**
  - Activity, provenance, review log, comment threading and review exit, suggestions and the suggestion popover: 22 passed after the badge update.
