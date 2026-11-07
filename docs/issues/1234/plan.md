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
