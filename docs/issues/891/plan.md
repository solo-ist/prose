# #891 — P3: Suggesting mode (tracked changes)

Design of record: [`docs/architecture/suggesting-mode.md`](../../architecture/suggesting-mode.md)
(§8 decisions final, 2026-11-09). Extends `editor-state.md` and
`review-provenance.md`; the four editor-state rules hold, and the `tracked`
record kind is the fifth.

Branch `issue-891-suggesting-mode` off `origin/release/v1.9.1`. One PR into
`release/v1.9.1`, **not merged by the agent**: the operator QAs it in the dev
window first (§8.3).

## Resume here

Read the execution log at the bottom first; the last entry says what is done
and what is next. The spike result is in [`spike.md`](spike.md).

## Decisions taken inside the design

These fill gaps the design leaves open; none changes a §8 decision.

1. **Hand-roll the filter** (spike, `spike.md`): the library cannot carry the
   actor on its marks, joins ids across actors, writes zero-width spaces into
   the text, tracks formatting the design applies directly, and lets typing in
   a code block through untracked. It stays the reference for step rebasing.
2. **The filter is a rewrite before apply.** `trackTransaction(state, tr,
   ctx)` in `extensions/tracked-changes/filter.ts` is a pure function from a
   transaction to its tracked form (or a refusal). The tracked-changes module
   installs it around TipTap's dispatch when the session layer attaches the
   editor, so only the view's transactions (the writer's input) are rewritten.
   Rewriting before apply, not appending after, means no plugin ever sees a
   transient untracked deletion: comments would auto-resolve and push to the
   share, and the review log would record rejections.
3. **What is skipped:** undo and redo (`history$`), transactions with
   `addToHistory: false`, the session's own metas (seed, reload, identity,
   activation), suggestion and tracked-change decisions, and every write a
   tool makes through a `DocumentHandle` (the handle tags its transactions).
   An agent's direct `edit` stays direct, as it is today; agents propose with
   `suggest_insert` / `suggest_delete`.
4. **The mode lives in the state.** The tracked-changes plugin state carries
   `suggesting`, seeded from the tab record (`tab.suggesting`) at open and
   changed by `setSessionSuggesting` in `session.ts` (one history-free meta
   transaction plus the tab record). The filter reads it from the state it
   rewrites, so it stays pure and per tab.
5. **Structure is not tracked in P3.** In Suggesting mode an edit that would
   add or remove a block boundary (Enter, Backspace at a block start, a
   multi-paragraph paste or deletion, table rows) or type in a code block
   (code blocks allow no marks) is refused with a notice, never applied
   untracked: the file must hold the original (§8.1). Formatting (mark steps,
   node-type changes) applies directly (§3). Plain-text `.txt` documents can't
   use Suggesting mode (plain-text mode strips marks).
6. **Ids** (§2): an edit next to the same actor's pending change in the same
   textblock joins its id; a replacement's delete and insert share one id.
7. **A deletion across another actor's pending insertion rejects that whole
   change**, decided by the writer, in the same transaction (§3).
8. **Persistence is a projection of the marks**, like suggestions: the
   `tracked` set is computed from the state and written by `session.ts`, at
   once when a change appears, goes or is decided, otherwise after the
   projection delay. An empty set is always written when it is the truth: a
   stale set would re-insert changes at the next load.
9. **Context stays in its paragraph**: a record's up-to-32 characters each
   side stop at the line break bounding its paragraph (included), so an edit
   to the next paragraph doesn't orphan it; a change goes back whole or not
   at all.
10. **Agents read the original.** `read_document`'s markdown and node text are
   the original (what the file holds), as with node-level suggestions;
   `suggest_insert` / `suggest_delete` match `search` against a node's
   original text.
11. **The writer decides** in Quick Review (tracked changes listed beside AI
    suggestions, with the all-variants) and in Activity, which reads the log.

## Delivery (design §9)

1. Marks `trackedInsert` / `trackedDelete` (`id`, `actor`, `createdAt`), the
   commands `acceptTrackedChange` / `rejectTrackedChange` /
   `acceptAllTrackedChanges` / `rejectAllTrackedChanges` with the decider in
   the review log, AI annotation for an accepted agent insertion.
2. `originalOf(doc)` / `finalOf(doc)` in `session.ts`; the `tracked` store
   (`DB_VERSION` 10 → 11) and its writer; load-time re-anchoring and
   orphaning; re-anchoring across a whole-document replace.
3. The per-tab toggle (toolbar, status bar, tab record) and the filter.
4. The three display classes (per tab, not persisted).
5. `suggest_insert` / `suggest_delete` on MCP (`document` target,
   `preserveView`); never accept or reject (#607).
6. Copy Markdown, export and share use the original; "Copy with changes".
7. Specs: a unit test per rewrite rule; e2e for save-reads-original, typing,
   IME, paste, ⌘Z, drag, relaunch re-anchoring, an orphan after an external
   edit, the display controls, the two MCP tools, a comment over a tracked
   deletion; a tripwire against serializing the raw document in the save path.
8. Docs: QA block in `docs/qa/v1.9.1.md`, CLAUDE.md (fifth record kind, MCP
   tool list, Document Review), the design doc merged in.

## Baselines (after `npm run build`, on `origin/release/v1.9.1` 84dcc27)

`npm run typecheck:renderer` 66, `npx tsc --noEmit -p tsconfig.node.json` 18,
`npm run typecheck:e2e` 6, `npm run test:unit` green.

## Execution log

- 2026-11-09 — Branch cut from `origin/release/v1.9.1` (84dcc27) in the
  `prose-1231` worktree (the design worktree, clean and pushed; the sandbox
  allows writes only there). Baselines measured: 66 / 18 / 6, unit green.
  Spike started: library wired behind a throwaway extension, vitest harness
  run on Prose's schema (13 cases), editor e2e suites running on a build
  with the library wired in.
- 2026-11-09 — **Spike done: hand-roll** (`spike.md`). With the library
  wired in and off, the 13 editor suites pass (92/92); with it on, the
  harness shows ids joined across authors, no actor on the marks, zero-width
  spaces in the text, formatting tracked, a heading toggle throwing, and
  typing in a code block going in untracked. Spike code removed; the library
  is not a dependency. Next: the marks and commands.
- 2026-11-09 — **Build done** (commits f23725f, a4424f8, 0466161, a50f1f7 and
  the docs): marks, filter, decisions, records, `originalOf` / `finalOf`, the
  `tracked` store (DB 11), the toggle, display controls, Quick Review and
  Activity, the two MCP tools, Copy with changes, export and share on the
  original. Unit: 419 green (63 new across `extensions/tracked-changes/`,
  `document/tracked-session.test.ts`, `executors/tracked.test.ts`). e2e
  `electron.suggesting-mode` 10/10, `review-log` and the session tripwires
  green locally. Next: the editor suites, the falsification on the
  merge-base, the PR.
