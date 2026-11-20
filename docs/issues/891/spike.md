# #891 spike: `@handlewithcare/prosemirror-suggest-changes` 0.1.8 on Prose

Time-box: one working session, 2026-11-09. Question (design §3, decision §8.2):
can P3 adopt the library behind Prose's own marks and commands, or does it
hand-roll the filter with the library as reference?

**Decision: hand-roll.** The library's rewriting is sound for the case it
targets (one author, a schema built around its marks), but on Prose's schema it
breaks four rules the design depends on, and three of them are not
configurable without a fork. Its step-rebasing approach (replay each step of
the original transaction onto a fresh one, mapping later steps back through
the earlier ones and forward through the tracked ones) is what Prose's filter
copies.

## What was wired

A throwaway extension (not committed) gave Prose's TipTap schema the
library's three marks under the names it requires (`insertion`, `deletion`,
`modification`, from its exported `MarkSpec`s), its plugin (`suggestChanges()`)
and its `withSuggestChanges` decorator around TipTap's own
`dispatchTransaction` (installed with `view.setProps`, since TipTap binds its
dispatch at view creation and emits `create` on a timer). Two runs:

1. **The editor suites with the library wired in and off** (the default), on a
   build of `origin/release/v1.9.1` plus the extension, ports rewritten to
   9253: `document-sessions`, `source-mode-authority`, `comment-auto-resolve`,
   `comment-occurrence`, `comment-review-exit`, `comment-threading`,
   `suggestions`, `suggestions-persist`, `suggestion-popover`,
   `tab-switch-flush`, `node-ids`, `tables`, `review-log`. **92 of 92 passed**
   (3.6 min). Adding the marks, the plugin and the decorator costs nothing
   while the mode is off.
2. **A vitest harness with the mode on**, on a headless editor built from
   `createEditorExtensions()` plus the extension: 14 cases, each a real
   transaction through the decorated dispatch.

## What the harness showed (mode on)

| Case | Result | Verdict for Prose |
|---|---|---|
| S1 type in a paragraph | `insertion` mark with `{ id: 1 }` | Works; the mark has **only** `id` (see below) |
| S2 Backspace over a character | `deletion` mark | Works |
| S3 two edits side by side (standing in for two actors) | both join id 1 | **Breaks §2**: ids join by adjacency alone, so the writer's typing next to an agent's insertion would be absorbed into the agent's change |
| S4 Enter at the end of a paragraph | two zero-width spaces (U+200B) inserted into the text, marked as insertions | **Breaks §5** unless every reader strips them; they also enter `textContent` (comment anchoring by text, `read_document`, word counts, search) |
| S5 Backspace at the start of a paragraph | two zero-width spaces marked as deletions | Same; a deleted U+200B is "original text" to a projection that keeps deleted text |
| S6 bold over a word | tracked as a deletion of `Hello` plus an insertion of **Hello** | **Breaks §3**: formatting is applied directly in P3 |
| S7 paragraph → heading (`setNode`) | throws `Invalid content for node doc` | Needs node marks allowed on `doc` and every block container; with them it becomes a `modification` mark, which §3 also rules out |
| S8 type in a code block | the text goes in **untracked** (code blocks allow no marks; `addMark` skips silently) | **Breaks §8.1**: the typed text would reach the file |
| S9 type in a table cell | tracked | Works |
| S10 undo | reverts the tracked edit | Works |
| S11 two-paragraph paste | tracked across the new block boundary | Works for the doc; the boundary itself rides on node marks |
| S12 accept a deletion between two spaces | also deletes one of the spaces | Changes text outside the change |
| S13 delete across two paragraphs | tracked | Works |
| S14 delete inside your own insertion | deletes for real | Works (matches §3) |

Not configurable without a fork:

- **The actor.** The library creates every mark as `type.create({ id })`;
  there is no hook for `actor` or `createdAt`, so the mark cannot say who made
  it (P1's `Actor` on every record) and the review log could not attribute a
  change. An `appendTransaction` stamping attributes afterwards would see the
  joined ids of S3 too late.
- **The names.** `getSuggestionMarks` reads `schema.marks.insertion /
  deletion / modification` and throws without them; Prose's marks would have
  to be named after the library, not after the design (`trackedInsert`,
  `trackedDelete`).
- **What gets tracked.** Every step kind is rewritten (marks, node marks,
  attributes, `setNodeMarkup`); the design tracks text only.

Also seen: with Prose's `html: true` markdown setup, a raw serialization of
the document writes the library's marks as `<ins data-id="1">…</ins>` HTML
(S1, S4, S6). Prose's projection never serializes the raw document
(`originalOf`), but the library's marks have no markdown spec to fall back on.

## What Prose's filter takes from it

- Replay the original transaction step by step onto a fresh transaction from
  the same state, never apply the original: no plugin sees a transient
  untracked deletion.
- Rebase each later step: map its positions back through the earlier
  original steps' inverses, then forward through the tracked steps.
- Deleting inside an insertion deletes for real; inserting carries the
  insertion mark explicitly (the marks are not inclusive).
- Skip undo and redo (`history$`).

## What Prose does differently

- Marks `trackedInsert` / `trackedDelete` with `id`, `actor`, `createdAt`;
  ids join only with the **same actor's** adjacent change (§2).
- Mark steps and node-type changes pass through untouched (§3).
- No zero-width spaces: an edit that would add or remove a block boundary, or
  type into a node that allows no marks, is refused with a notice in P3
  (plan decision 5), so nothing untracked ever reaches the document.
- A deletion across another actor's insertion rejects that whole change,
  decided by the writer (§3).

The library stays out of `package.json`.
