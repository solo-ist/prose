# Suggesting mode: tracked changes by anyone, decided by the writer

**Status.** Design of record for P3 ([#891](https://github.com/solo-ist/prose/issues/891)), the last item of the 1.9.1 epic ([#1230](https://github.com/solo-ist/prose/issues/1230)) and its cut line. Written 2026-11-07, before any code. It extends `review-provenance.md` and `editor-state.md`, keeps their four rules, and changes what a save writes. So editor-state rule 4 applies: design first.

## 1. Why, and what not

**Commenting stays human by default.** The operator's framing is that the point is provenance across every actor, and P1, P2 and P4 deliver that.

**What P3 adds:**
- **Tracked changes.** Insertions and deletions that live in the document as proposals until someone decides them. Two kinds of author make them:
  - *the writer*, in an opt-in **Suggesting** mode;
  - *agents*, through `suggest_insert` and `suggest_delete`, the two #854 tools M4 deferred.
- **Display controls**, from #854:
  - *All changes*: insertions underlined, deletions struck through;
  - *No deletions*: deleted text hidden;
  - *Final*: as if everything were accepted.

**Not in P3.** Replacing the node-level AI suggestions (`suggest_edit` and `revise_suggestion`, M4). They stay as they are, and tracked changes sit beside them.

## 2. The model

Two marks, each with the attributes `id`, `actor` (P1) and `createdAt`:

| Mark | Text is in the document? | Accept | Reject |
|---|---|---|---|
| `trackedInsert` | Yes, shown as an insertion | Remove the mark; the text stays | Delete the text |
| `trackedDelete` | Yes, shown struck through | Delete the text | Remove the mark; the text stays |

**One edit, one id.** Contiguous typing by one actor in one textblock shares an id. So does a replacement (a delete plus an insert at the same spot). Each id is one entry in the review log, with the type `insertion`, `deletion` or `edit`. P2 already reserved the `deletion` type.

**Decisions go through the existing commands.** `acceptTrackedChange(id, by?)`, `rejectTrackedChange(id, by?)` and the all-variants mirror the suggestion commands. They record the decider in the same transaction (P2's intent metas). MCP never gets them: the writer decides (#607). Undoing a decision reopens it, as for suggestions.

**Authorship highlighting.** Accepting an agent's insertion records an AI annotation with that agent's actor, as accepting a suggestion does. The writer's own accepted insertions record none.

## 3. Suggesting mode (the writer)

**The switch.** A toggle per tab in the editor toolbar and the status bar, off by default and kept on the tab record (like `mode`).

**What it does.** While it is on, the writer's edits are rewritten before they apply:
- **Typed or pasted text** is inserted with `trackedInsert` and the writer as actor.
- **A deletion** of untracked text doesn't delete. The range gets `trackedDelete` instead.
- **A deletion inside the writer's own pending insertion** deletes for real: you can fix your own typo.
- **A deletion across someone else's pending insertion** marks that insertion rejected by the writer.

**The rewriting** is a transaction filter in one plugin, a pure function from a transaction to its tracked form, tested step by step. Formatting changes (marks and node types) are applied directly in P3 and never tracked; tracked formatting is out of scope.

**Spike first.** `@handlewithcare/prosemirror-suggest-changes` (MIT, 0.1.8) implements this rewriting for ProseMirror. P3 starts with a one-day spike: wire it to Prose's schema and run the editor suite.
- If it passes, P3 adopts it behind Prose's own marks and commands.
- If it doesn't, P3 writes the filter itself, with the library as reference. A pre-1.0 dependency in the editor's core path needs that gate.

## 4. Agents: `suggest_insert` and `suggest_delete`

- **`suggest_insert`** `{ nodeId | search, text, position: 'before' | 'after' | 'start' | 'end' }` inserts `text` with `trackedInsert`, with the caller as actor. It never moves the writer's caret (M3).
- **`suggest_delete`** `{ nodeId, search }` marks the matching text (a phrase inside the node) with `trackedDelete`.

Both take the M3 `document` target. Both appear in `list_suggestions` with their type, and in `list_review_events`.

## 5. What a save writes (the decision this design exists for)

**The file holds the original text until a change is accepted.** Inserted text is left out, and deleted text stays in, unmarked. This is the same promise node-level suggestions keep today: a proposal never reaches the disk, a shared page or `git` until someone accepts it.

**How:**
- **Projection.** The session's markdown projection serializes a copy of the document with tracked insertions removed and deletion marks dropped. It's one pure function, `originalOf(doc)`, in `session.ts`.
- **Dirty and save.** Typing in Suggesting mode leaves the original unchanged, so the tab stays clean and autosave writes nothing. An accept changes the original, so the tab goes dirty and saves as usual.
- **Byte-exact saves.** The baseline rule (#1102) compares against `originalOf(doc)`, so an untouched file with pending changes still saves byte for byte.
- **Where the changes live.** In IndexedDB, as a fifth record kind, `tracked`, keyed by `documentId` and written only by `session.ts` (rule 1). Each record holds the id, kind, actor, created time, text, and an anchor: up to 32 characters of original text on each side, plus a position hint.
- **Load.** A seed transaction re-anchors records into the document built from the file (rule 3):
  - a deletion is re-marked by its text and context;
  - an insertion is re-inserted, marked, at its context;
  - a record whose context is gone (the file changed outside Prose) is *orphaned*: kept in the review log as superseded by the external edit, never silently re-inserted somewhere wrong.

  A whole-document replace (a source exit, a disk reload) re-anchors the same way.
- **Copy Markdown and export** use the original. A "Copy with changes" item uses the final text.

## 6. Display controls

Three classes on the editor container switch the CSS only; the document is never rewritten for display:
- **All changes**: insertions underlined in the actor's colour, deletions struck through;
- **No deletions**: deleted text hidden;
- **Final**: deletions hidden and insertions unstyled.

The control sits beside Suggesting mode, is per tab, and isn't persisted.

## 7. Risks

| Risk | Mitigation |
|---|---|
| The rewriting filter mangles an edit (IME, paste, undo, drag) | Spike first. Unit tests per step kind, and e2e for typing, IME composition, paste, ⌘Z and drag in Suggesting mode |
| A tracked insertion reaches the disk | `originalOf` is the only serializer the projection uses. A tripwire forbids serializing the raw document in the save path, and an e2e saves with pending changes and reads the file |
| Re-anchoring puts an insertion in the wrong place | Exact context match only, at load. Anything else is orphaned and reported |
| Interplay with comments, AI suggestions and annotations | Tracked marks are ordinary marks to the other plugins. The P2 log and the comment plugin's existing rules (a deleted range resolves its thread only when the text is really gone) cover them. The e2e covers a comment over a tracked deletion |

## 8. The operator's decisions

1. **The file holds the original until acceptance** (§5). The alternative is writing the proposed text and keeping the original in IndexedDB, which is simpler but breaks the promise that proposals never reach the disk. Recommended: the original.
2. **Adopt the library if the spike passes** (§3), or always hand-roll.
3. **Ship P3 in 1.9.1**, or let it follow, since it is the cut line. Everything else in 1.9.1 stands without it.

## 9. Delivery

The work is one PR after the spike:
1. The marks, commands and log integration.
2. `originalOf`, the `tracked` record kind, its writer and its re-anchoring.
3. The mode switch and the transaction filter.
4. The display controls.
5. `suggest_insert` and `suggest_delete`.
6. Specs: a unit test per rewrite rule; e2e for the save-reads-original check, typing, IME, paste, undo, a relaunch with re-anchoring, an orphaned change after an external edit, the display controls, and the agent tools over MCP.
