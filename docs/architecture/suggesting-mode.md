# Suggesting mode: tracked changes by anyone, decided by the writer

**Status.** Design of record for P3 ([#891](https://github.com/solo-ist/prose/issues/891)), the last item of the 1.9.1 epic ([#1230](https://github.com/solo-ist/prose/issues/1230)) and its cut line (built now; joins 1.9.1 if its QA passes in time, §8). Written 2026-11-07, before any code. It extends `review-provenance.md` and `editor-state.md`, keeps their four rules, and changes what a save writes. So editor-state rule 4 applies: design first.

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

**The rewriting** is a transaction filter in one plugin, a pure function from a transaction to its tracked form, tested step by step. Formatting changes (marks and node types) are applied directly in P3 and never tracked; tracked formatting is out of scope. Structural edits (splitting or joining paragraphs, and edits inside code blocks) aren't tracked either: Suggesting mode refuses them with a message saying to turn Suggesting off for them. The Suggesting toggle's tooltip says so ("Formatting changes apply directly"), so a bolded paragraph that isn't tracked doesn't read as a bug.

**Spike first.** `@handlewithcare/prosemirror-suggest-changes` (MIT, 0.1.8) implements this rewriting for ProseMirror. P3 starts with a one-day spike: wire it to Prose's schema and run the editor suite.
- If it passes, P3 adopts it behind Prose's own marks and commands.
- If it doesn't, P3 writes the filter itself, with the library as reference. A pre-1.0 dependency in the editor's core path needs that gate.

## 4. Agents: `suggest_insert` and `suggest_delete`

- **`suggest_insert`** `{ nodeId | search, text, position: 'before' | 'after' | 'start' | 'end' }` inserts `text` with `trackedInsert`, with the caller as actor. It never moves the writer's caret (M3).
- **`suggest_delete`** `{ nodeId, search }` marks the matching text (a phrase inside the node) with `trackedDelete`. When `search` (for either tool) matches more than once in its scope, the tool refuses with `AMBIGUOUS_MATCH` and asks for a longer phrase; it never picks one silently.

Both take the M3 `document` target. Both appear in `list_suggestions` with their type, and in `list_review_events`.

## 5. What a save writes (the decision this design exists for)

**The file holds the original text until a change is accepted.** Inserted text is left out, and deleted text stays in, unmarked. This is the same promise node-level suggestions keep today: a proposal never reaches the disk, a shared page or `git` until someone accepts it.

**How:**
- **Projection.** The session's markdown projection serializes a copy of the document with tracked insertions removed and deletion marks dropped. It's one pure function, `originalOf(doc)`, in `session.ts`.
- **Dirty and save.** Typing in Suggesting mode leaves the original unchanged, so the tab stays clean and autosave writes nothing. An accept changes the original, so the tab goes dirty and saves as usual.
- **Byte-exact saves.** The baseline rule (#1102) compares against `originalOf(doc)`, so an untouched file with pending changes still saves byte for byte.
- **Where the changes live.** In IndexedDB, as a fifth record kind, `tracked`, keyed by `documentId` and written only by `session.ts` (rule 1). Each record holds the id, kind, actor, created time, text, and an anchor: up to 32 characters of original text on each side, plus a position hint. It is a new object store, so **`DB_VERSION` goes from 10 to 11** (`persistence.ts`); without the bump, existing installs never create the store and lose tracked changes on relaunch. A fresh install and an upgrade from 10 are both tested.
- **Pending changes are visible, not just stored.** The tab stays clean, so the dirty dot can't signal them. Instead the Suggesting control shows a count of the tab's pending tracked changes, the status bar says "N pending changes", and Activity lists them. The count includes agents' tracked changes, whether or not Suggesting mode is on.
- **Load.** A seed transaction re-anchors records into the document built from the file (rule 3):
  - a deletion is re-marked by its text and context;
  - an insertion is re-inserted, marked, at its context;
  - a record whose context is gone (the file changed outside Prose) is *orphaned*: kept in the review log as superseded by the external edit, never silently re-inserted somewhere wrong.
  - when the exact context matches in several places, the one nearest the record's position hint (its character offset in the original text) wins.

  A whole-document replace (a source exit, a disk reload) re-anchors the same way.
- **Copy Markdown and export** use the original. A "Copy with changes" item uses the final text. It sits next to Copy Markdown in the Edit menu and the editor's context menu, and appears only when the tab has pending tracked changes.

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
| Pending changes live only in IndexedDB (the file holds the original and autosave writes nothing while suggesting) | Each change is persisted in the transaction that makes it. A crash before acceptance leaves it in IndexedDB, and re-anchoring at relaunch is the recovery path: the same guarantee comments and AI suggestions already rely on |
| Source mode would edit text that tracked changes are anchored in | Source mode is unavailable while Suggesting is on or the tab has pending tracked changes; the toggle says why. Accepting or rejecting the changes, or turning Suggesting off, makes it available again |
| Interplay with comments, AI suggestions and annotations | Tracked marks are ordinary marks to the other plugins. The P2 log and the comment plugin's existing rules (a deleted range resolves its thread only when the text is really gone) cover them. The e2e covers a comment over a tracked deletion |

## 8. The operator's decisions (decided 2026-11-09)

1. **The file holds the original until acceptance** (§5): pending insertions are left out of the file and pending deletions stay in as plain text.
2. **Adopt the library if the spike passes** (§3); otherwise hand-roll the filter, with the library as reference.
3. **Build now, ship if ready.** P3 is built in parallel with the relay (M5a/M5b) as an opt-in mode, off by default. It is merged into `release/v1.9.1` only after the operator's QA passes in the dev window, and only if that happens by the time the relay is ready. Otherwise it ships in the next release with no rework. Everything else in 1.9.1 stands without it.

## 9. Delivery

The work is one PR after the spike:
1. The marks, commands and log integration.
2. `originalOf`, the `tracked` record kind (a new store: `DB_VERSION` 10 → 11), its writer and its re-anchoring.
3. The mode switch and the transaction filter.
4. The display controls.
5. `suggest_insert` and `suggest_delete`.
6. Specs: a unit test per rewrite rule; e2e for the save-reads-original check, typing, IME, paste, undo, a relaunch with re-anchoring, an orphaned change after an external edit, the display controls, and the agent tools over MCP.

## 10. As built (#891, the P3 PR)

Where the build fills in what the text above leaves open; the plan and its log are in `docs/issues/891/plan.md`, the spike in `docs/issues/891/spike.md`.

- **Hand-rolled** (§3, §8.2): the library can't carry the actor on its marks, joins ids across authors, writes zero-width spaces into the text, tracks formatting and lets typing in a code block through untracked. Its step-rebasing approach is what `trackTransaction` (`extensions/tracked-changes/filter.ts`) copies.
- **The filter rewrites before apply.** It sits in front of the view's dispatch (installed by `attachEditor`), so no plugin ever sees a transient untracked deletion (a comment would auto-resolve and push to a share, the log would record a rejection). Only the view's transactions are rewritten; undo and redo, decisions, the session's own transactions and every tool write through a `DocumentHandle` pass untouched.
- **Structure is not tracked in P3.** In Suggesting mode an edit that adds or removes a block boundary (Enter, Backspace at a paragraph's start, a multi-paragraph paste or deletion, table rows) or changes text in a code block is refused with a notice, never applied untracked (§8.1). Formatting and node-type changes apply directly (§3). A plain-text document can't suggest.
- **A deletion across another actor's pending insertion rejects that whole change** in the same transaction, decided by the writer.
- **Context stays in its paragraph:** a record's up-to-32 characters each side stop at the line break that bounds its paragraph (included), so an edit to the next paragraph doesn't orphan it. A change goes back whole or not at all.
- **Orphans** are `superseded` rows with `orphaned: true` and a `suggestion:orphaned` event (by the writer), logged even in the seed; the orphaning is idempotent until the next write drops the records. A plain-text document's stored changes are orphaned.
- **Agents read the original**: `read_document`'s markdown and node text, and `suggest_insert` / `suggest_delete` match `search` against it. `suggest_delete` refuses a phrase that overlaps a pending change.
- **The writer decides** in Quick Review and the side-by-side review (tracked changes beside AI suggestions), from the status bar's display menu (accept all, reject all) and through the commands; Activity reads the log.
- **Visible while the tab is clean**: the status bar's "N pending changes" and a badge on the toolbar pen (agents' changes included, mode on or off). "Copy with changes" sits under Copy Markdown in the Edit menu and in the editor's context menu (main shows them through `menu:setCopyWithChangesAvailable`, so this PR touches `src/main` and `src/preload`), and in the toolbar's ⋯ menu, only while changes are pending.
- **Crash recovery**: the tracked set is written in every transaction that changes it, with no debounce; an e2e kills the app right after typing and finds the change at the relaunch.
- **Source mode** is unavailable while Suggesting is on or changes are pending (`sourceBlockedBy`), as §7 says; the re-anchoring across a source exit stays as a second line of defence (a tab in source mode can't take a tracked change: tool writes are refused there).
