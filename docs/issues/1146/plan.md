# PR 2 (#1146): AI annotation records in plugin state, `RELOAD` re-anchoring — plan

Planned 2026-11-02 against `release/v1.9.0` = `5b67ba9`; the section below is the approved plan verbatim, with an execution log at the end.


Design of record: `docs/architecture/editor-state.md` §5.2 (lines 286–294), §4.11, §12 cases 1 (the `anchorText`
clause), 2 and 4; decisions 1 and 10. Issue: https://github.com/solo-ist/prose/issues/1146 (subsumes #1138; refs
#674). This section becomes `docs/issues/1146/plan.md` in the PR. Branch `issue-1146-annotation-plugin-state` from
`release/v1.9.0` = `5b67ba9` (PR 1 merged); renderer-only; one PR, merge commit, green CI + claude review, one QA
pass on the dev server first. Estimate: two days.

### Context

PR 1 gave every open tab its own `EditorState`, but the AI annotation records still live in one global zustand
store (`extensions/ai-annotations/store.ts`) that mirrors the active session: `activateSession` writes it, a
subscriber copies it back into `session.records.annotations`, the plugin's `apply` reaches into it to move
positions, and every producer (executors, the suggestion accept paths, the paste dialog, the selection toggle)
calls `addAnnotation` on it. That mirror is the last place a (document id, records) pair can be assembled from two
sources, the reason the accept paths still defer annotation creation to a microtask (`isLoadingDocument`), and
why nothing re-anchors records at load: a relaunch, a disk reload or a conversion re-parses the file and applies
the stored positions unchanged, which is the open half of #1138 (the tab-switch half is closed structurally by
PR 1). PR 2 moves the records into the annotations plugin's state, so a record can only ever enter a state through
that state's own transaction, re-anchors by text on load and on every whole-document replace, and makes the
React surfaces and test seams read the active session.

### What the inventory found (2026-11-02, three read-only passes + one design pass over `5b67ba9`)

Corrections to the design and the issue text, folded into this plan:

- PR 1 shipped `RELOAD_META` as a bare `true`; the text index the design says it carries is a local in
  `replaceSessionDocument`, which re-anchors annotations *after* the replace transaction (store write, then a
  second `rebuildDecorations` dispatch) rather than inside it. The plugin returns `DecorationSet.empty` on the
  reload transaction. PR 2 does it inside `apply`, from `oldState.doc`, so the meta stays bare.
- `keepHistory: false` (disk reload, reMarkable, convert) re-opens the session and never re-anchors; `openSession`
  loads positions as stored. `useActiveSession`, `projectSession` and `anchorText` do not exist anywhere;
  `resolveDocumentHandle` is sync and lives in `handle.ts`.
- `reanchor.ts` sits in `extensions/ai-annotations/` (not `document/`) and is pure; only `session.ts` imports it.
  #1141's `anchors.ts` is gone; its `nearestMatch` lacked today's empty-text guard. **`textIndex` and
  `doc.textBetween(from, to, '\n')` disagree on separators** (an empty paragraph between two text paragraphs,
  hard breaks, images): #1141 compared one against the other. PR 2 uses one convention, implemented once.
- **Zero-width `'deletion'` records (`executeDeleteNode`, `from === to`) detach on the first `docChanged` after
  creation today** (`updatePositions` returns null for `mappedFrom >= mappedTo`): the history panel shows an AI
  deletion as "superseded" the moment the user types anywhere. Not #674's intent; fixed below (decision 1).
- **Undoing a source-mode exit is a whole-document `ReplaceStep` with no meta** (prosemirror-history's inverse
  step), so mapping collapses every record; case 4's annotation half cannot pass on a `RELOAD`-only rule.
- `executeEdit`'s `priorAnnotations` snapshot (`executors/editor.ts:424`) does not exclude detached records, so
  a detached prior is restored as a live one; the accept path (`ai-suggestions/extension.ts:600`) does exclude
  them. The builder excludes them on both paths.
- The store's `isVisible`/`toggleVisibility`/`setVisibility` have no callers (hide/show is
  `editorStore.annotationsVisible` + the `.hide-annotations` class, `Editor.tsx:982`); `createdThisSession` is
  never read; `getAnnotationsAtPosition`/`getAnnotationsInRange` have no callers. All go.
- `loadAnnotations` (the reader) is also imported by `main.tsx` (the `loadAnnotationsFromDB` seam) and
  `tabs/actions.ts:631` (the lazy-tab identity migration); only the writers are tripwired. Unchanged.
- The reverted #1141 spec asserted only the painted text; it never read IndexedDB or the other tab's rows, which
  is how its contamination shipped. Reinstated with both assertions.
- `isAnnotationMappingPaused` is polled until false by `ai-edit-lifecycle` and `activity-panel`; returning a
  constant `false` keeps them green (PR 8 removes the seam). `electron.markdown-create` asserts the
  `annotation:load` pipeline-log event; the vocabulary (`annotation:create/detach/reanchor/save/load`) is kept.

### The design, made concrete for PR 2

**Plugin state** (`extensions/ai-annotations/plugin.ts`), one per `EditorState`:

```ts
interface AIAnnotationsPluginState {
  records: readonly AIAnnotation[]   // reference-stable: replaced only when a record object changed
  decorations: DecorationSet
  lastRefresh: number                // the 5-minute opacity refresh, as today
  revision: number                   // bumped when `records` is replaced
  urgentRevision: number             // the revision of the last add/remove/removeRange/detach/split/reanchor/restamp
}
```

`init` returns an empty set; it reads no store. The closure variables (`currentAnnotations`, `isVisible`,
`unsubscribe`), `view()`, the store subscription and the `rebuildDecorations` meta are deleted. The tooltip and
click handlers look the record up in `aiAnnotationsPluginKey.getState(view.state).records`.

**One meta object** on `aiAnnotationsPluginKey`, so helpers compose on a single `tr`:
`{ load?: AIAnnotation[]; add?: AIAnnotation[]; remove?: string[]; removeRange?: {from,to}[] }`.

**`apply(tr, prev, oldState, newState)`**, in this order (identity, priority 1000, is already applied on
`newState`, so `getIdentity(newState).documentId` is the state's own id throughout):

1. `docChanged` and (`RELOAD_META` **or** `isWholeDocumentReplace(tr, oldState.doc)`, a `ReplaceStep` from 0 to
   `oldState.doc.content.size`): `reanchorRecords(records, oldState.doc, newState.doc)`, today's
   `reanchorMapping` (diff map → nearest match → detach), computed from `oldState` so the meta stays bare and the
   undo/redo of a reload, which carries no meta, takes the same path (decision 2). Urgent.
2. Otherwise on `docChanged`: `mapRecords(records, tr)`, the pure fold of today's `updatePositions` and
   `updatePositionsWithSplitting` (insertions = `ReplaceStep`s with `from === to` and content; a record strictly
   containing one splits into remnants with new ids and sliced `content`; both remnants collapsing keeps one
   detached copy under the original id; otherwise `from` maps with bias 1, `to` with bias −1, collapse →
   `detached: true`, never deleted). **Zero-width records map `from = to = map(from, −1)` and never split or
   detach** (decision 1). Detach/split urgent; moves not.
3. Metas, in the order `load` (replaces the set; runs `loadRecords`, below), `removeRange` (today's remnant
   splitting), `remove`, `add` (positions are in `newState.doc`, i.e. after mapping, so a replace-and-annotate is
   one dispatch). All urgent.
4. `IDENTITY_META`: `restampRecords(records, documentId)`. Urgent.
5. `refreshAnchors(records, newState.doc)` when `docChanged` or any meta ran: `anchorText` recomputed for live
   in-bounds records with `from < to`; same object when unchanged. O(annotated characters), no index on typing.
6. Decorations rebuilt from `records` when the reference changed or `needsRefresh`; else mapped on `docChanged`;
   else kept. The reload transaction paints its re-anchored set in the same apply.
7. `revision++` iff `records !== prev.records`; `urgentRevision = revision` when any urgent change happened.

The plugin stops reading `BUILD_META` (the scratch state in `buildDocument` has an empty set, the seed and the HMR
rebuild carry `load`; there is nothing left to guard). `session.ts` keeps setting it; PR 8 removes it if unused.

**Pure functions**, new `extensions/ai-annotations/records.ts` (no DOM, no logging; returns what moved/detached so
the plugin logs `annotation:detach` / `annotation:reanchor`):

- `anchorTextAt(doc, from, to)`: the text between, with `'\n'` between textblocks by **`textIndex`'s rule** (a
  `nodesBetween` walk with the same separator logic), so `anchorTextAt(doc, a.from, a.to) ===
  index.text.slice(start, end)` for every snapshot. A vitest pins the equality on a fixture with an empty paragraph,
  a list and a hard break.
- `mapRecords(records, tr: Transform) → { records, detached, split }`.
- `reanchorRecords(records, before: PMNode, after: PMNode) → { records, moved, detached }` over `reanchor.ts`'s
  `textIndex` / `snapshotAnchors` / `reanchorMapping` (which stay where they are; `remapAnnotations` moves in
  from `session.ts`). Detached pass through; zero-width clamp into bounds; `null` → detach. Same algorithm the
  source-exit path runs today, so `source-mode-authority`'s four annotation tests keep their behaviour.
- `loadRecords(stored, doc, documentId) → { records, moved, detached, filled }`, the #1138 relaunch and
  disk-reload fix: detached → untouched; `from === to` and `type === 'deletion'` → clamp, keep (any other
  zero-width → detach); no `anchorText` (a pre-PR-2 row) → in bounds: fill it from the doc, else detach; with
  `anchorText` → equal to `anchorTextAt(doc, from, to)`: keep, else `nearestMatch(textIndex(doc), anchorText,
  from)`: move (`annotation:reanchor`), none: detach (`annotation:detach`, reason `load-miss`). Every record
  restamped to `documentId`.
- `removeRecordsInRange`, `restampRecords`, `stampAdded(inputs, doc, documentId)` (documentId, `anchorText`,
  bounds check), `isWholeDocumentReplace(tr, oldDoc)`.

**Types** (`types/annotations.ts`): `AIAnnotation.anchorText?: string` (additive, JSON-compatible; no
`DB_VERSION` bump). `AnnotationState` / `AnnotationActions` deleted.

**Write API**, new `extensions/ai-annotations/transactions.ts` (re-exported from `index.ts`; no DOM imports):

```ts
type AnnotationInput = Omit<AIAnnotation, 'id' | 'createdAt' | 'documentId' | 'anchorText' | 'detached'>
addAnnotationsTo(tr, inputs)            // mints id (generateId) + createdAt; logs annotation:create
removeAnnotationFrom(tr, id); removeAnnotationsInRangeFrom(tr, from, to); loadAnnotationsInto(tr, records)
annotationsOf(state): readonly AIAnnotation[]; annotationPluginState(state)
EMPTY_ANNOTATIONS; selectAnnotations(state | null)
```

`AnnotationInput` has no `documentId`: the plugin stamps the state's identity in `apply`, so the compiler removes
the plumbing PR 1's regression fix (`26b9a43`) had to add by hand, and the "foreign documentId refused" branch
has nothing left to refuse (an `add` reaches a state only through that state's own transaction: `handle.apply`,
`editor.commands`, `applyToSession`). Callers keep `provenance && provenance.documentId` as the "has provenance"
gate only. TipTap commands on the `AIAnnotations` extension, each a one-liner over the helpers:
`addAIAnnotations(inputs)`, `removeAIAnnotation(id)`, `removeAIAnnotationsInRange(from, to)`.

`createWordDiffAnnotations` (`lib/diffUtils.ts`) → `buildWordDiffAnnotations(params): AnnotationInput[]`: the
same four branches (multi-paragraph full range; prior restore with new ids; coalesced added runs; fallback full
range) push inputs instead of calling the store; `documentId` and `prior.documentId` dropped; `priorAnnotations`
filtered `!detached` by the builder.

**Producer sites** (every `addAnnotation` call in the tree):

| Site | After |
|---|---|
| `executors/editor.ts:424` prior snapshot | `annotationsOf(handle.state).filter(!detached && overlaps)` before `applyInsertion` |
| `:437`, `:643` (after the streamed `applyInsertion`) | `handle.commands.addAIAnnotations(buildWordDiffAnnotations(…))`, a later meta-only transaction as today (`ai-provenance`'s `to − from === AI_TEXT.length` unaffected) |
| `:598` before/after_node slice insert | one `tr`: `insert` + `addAnnotationsTo` with `rangeTo = insertFrom + (tr.doc.content.size − sizeBefore)` |
| `:707` replaceTable | `addAnnotationsTo(tr, [{ type: 'replacement', from, to: from + parsed.nodeSize, … }])` before `handle.apply(tr)` |
| `:1187` deleteNode | `handle.chain().focus().deleteRange({from,to}).addAIAnnotations([{ type: 'deletion', from, to: from, … }]).run()`: mapping first, then the marker at the deletion point, one transaction |
| `executors/file.ts:322` create_and_open_file | `const h = resolveDocumentHandle(); if (h?.documentId === newDocumentId) h.commands.addAIAnnotations(…)` |
| `ai-suggestions/extension.ts:587-677` accept | before `dispatch(tr)`: prior snapshot from `annotationsOf(state)`, inputs from `buildWordDiffAnnotations` / the wrapper-conversion full-range input with the positions the microtask computes today (`tr.mapping.map(markFrom, −1)` / `map(markTo, 1)` / `conversion.insertedAt`), `addAnnotationsTo(tr, inputs)`; the `queueMicrotask`, the store read and the `docId` fallback chain go |
| `:872-921` acceptAll | same, looping `applied` before `dispatch` |
| `Editor.tsx:825` paste confirm | `activeEditor.commands.addAIAnnotations([…])`, staleness guard kept |
| `SelectionPopover.tsx:148/152` | `editor.chain().removeAIAnnotationsInRange(from, to).run()` / `editor.commands.addAIAnnotations([{ type: 'insertion', provenance: { model: 'Imported', … } }])` |

**Persistence** (`document/session.ts`, the only IndexedDB writer): one hook `afterTransaction(session, prev)`
called from `attachEditor`'s `onTransaction` (active session, after `session.state = view.state`) and from
`applyToSession`'s inactive branch. It compares the plugin state's `revision`; an unpersisted `urgentRevision` →
`persistAnnotationsNow(session)` (one synchronous read of `{documentId}` from `getIdentity(session.state)` and
`annotationsOf(session.state)` → `persistRecords('annotations', …)`, the promise kept in `session.annotationWrite`);
a plain move or `anchorText` refresh → a 500 ms timer on the session, flushed by `flushProjections` (leave, close,
save). `load` (seed, HMR rebuild) persists nothing: `openSessionNow` and `rebuildForSchema` set
`session.annotationsPersisted = revision` right after the seed. The invariant: an empty set reaches IndexedDB only
after an explicit remove/removeRange (urgent) or through `closeSession`'s unconditional final write, as today;
plugin state is never transiently stripped (the seed loads before a state is shown; a reload re-anchors in the
same apply), so leave/close keep writing the set as it is.

`Session.records` → `{ comments, suggestions }` (`SessionRecords` keeps the `annotations` key only as
`persistRecords`'s generic; it no longer writes `session.records` for that kind). Read sites become
`annotationsOf(session.state)`: `persistSession`, `replaceSessionDocument`, `setSessionIdentity`. Deleted from
`session.ts`: the `useAnnotationStore` import and subscription, the `setState` in `activateSession` and
`deleteRecords`, the `textIndex`/`snapshotAnchors`/`reanchorMapping` block and `remapAnnotations`, the second
`rebuildDecorations` dispatch. `Session` gains `annotationTimer`, `annotationsPersisted`, `annotationWrite`.

**`setSessionIdentity`**: the `IDENTITY_META` transaction first (the plugin restamps in the same transition,
`afterTransaction` starts the write under the new id from the same state); when the id changed, await
`session.annotationWrite` alongside the comment and suggestion writes. The `pendingSave` await, the rekey map and
the store writes go. An empty set bumps no revision, matching today's `rekeyed.length > 0` guard.

**Seeding, HMR, reloads**: `openSessionNow` adds `loadAnnotationsInto(seed, annotations)` to the existing seed
(identity + `BUILD_META` + `addToHistory: false` + marks); `rebuildForSchema` adds
`loadAnnotationsInto(tr, annotationsOf(session.state))` to its identity transaction (dev only: `annotationsOf`
falls back to the `aiAnnotations$…` plugin found on the state when a re-evaluated `plugin.ts` minted a new key).
`replaceSessionDocument` `keepHistory: true` keeps its one transaction (`replaceWith` + `RELOAD_META` + marks)
and loses the annotation block after it. **`keepHistory: false` stays a re-open** (decision 3): `persistSession`
writes current positions and fresh `anchorText` before `openSession` loads them and `loadRecords` re-anchors,
which is §4.11's "annotations whose text survived stay attached"; a `RELOAD` replace would keep undo history
across a disk reload and the convert path needs a fresh build for `plain` anyway.

**Read path**: `document/useActiveSession.ts` exports `useActiveSession(selector, isEqual = Object.is)` on
`useSyncExternalStore`, over `subscribeActiveSession(listener)` in `session.ts` (notified from `onTransaction`
after `session.state` is set, from the end of `activateSession`, from `closeSession` when the active tab closes,
and from `attachEditor`). The snapshot caches `{ state, value }`: same `EditorState` → same value; new state with
an equal selection → the old value, so React bails out when nothing selected changed. `records` is
reference-stable in plugin state, so `useActiveSession(selectAnnotations)` re-renders a panel only when a record
moved. Not TipTap's `useEditorState`: it needs the instance in every panel, still shows the last closed tab's
records after the final close, cannot serve PR 3/4 selectors over non-view sessions, and the design names
`useActiveSession`. Consumers: `AIEditsHistoryPanel.tsx:111-112` (list; X → `editor.commands.removeAIAnnotation`),
`ChatPanel.tsx:106` (badge), `SelectionPopover.tsx:53` (coverage; its `documentId` read goes). Non-React readers:
`main.tsx` seams (`getAnnotations` → a copy of the active session's records, `getAnnotationDocId` →
`getIdentity(active.state).documentId`, `isAnnotationMappingPaused` → `false`), `executors/document.ts:199`
(`annotationsOf(handle.state).length`), `executors/tabs.ts:119` (log fields from `getActiveSession()`).

`store.ts` is deleted (the design's "except selectors" are `selectAnnotations` / `EMPTY_ANNOTATIONS` in
`transactions.ts`; the unused range selectors go).

### Work order (worktree `prose-1146`, four commits, suite green after each)

0. Worktree: `git -C prose worktree remove ../prose-1145` (branch merged), then
   `git -C prose worktree add ../prose-1146 -b issue-1146-annotation-plugin-state origin/release/v1.9.0`; move
   `prose-1145`'s `node_modules` over first (`mv`; the lockfile is identical at `5b67ba9`), verify with
   `npx vitest --version` and `npx electron --version`. Commit `docs/issues/1146/plan.md` (this section) first,
   as PR 1 did.
1. **Pure core.** `types/annotations.ts` (`anchorText?`), `records.ts`, `reanchor.ts` (`remapAnnotations` moves
   in), `records.test.ts`. No behaviour change.
2. **The move.** `plugin.ts`, `transactions.ts`, `extension.ts` (commands + module augmentation), `index.ts`,
   `store.ts` deleted, `session.ts` (seed `load`, `afterTransaction`, persist, HMR, identity, the reload block
   removed), `useActiveSession.ts`, `diffUtils.ts`, the ten producer sites, the three React readers, the seams,
   `executors/document.ts` / `tabs.ts`, `plugin.test.ts`, `session.test.ts` (the §G test becomes "a transaction on
   B never touches A's state; `persistRecords` is called with the state's own id and records, immediately on add,
   debounced on typing"), the reinstated `electron.annotation-reanchor.spec.ts` and sessions case 2 + the case 1
   `anchorText` clause (falsified by running the two spec files against `5b67ba9`'s `src/` in the worktree:
   `git checkout 5b67ba9 -- src`, run, `git checkout HEAD -- src`).
3. **Undo of a reload.** `isWholeDocumentReplace` in `apply`; sessions case 4's annotation half (falsified the
   same way). Tripwire: no renderer file references `useAnnotationStore` or imports `ai-annotations/store`.
4. **Docs.** `docs/issues/1146/plan.md` execution log; `docs/architecture/editor-state.md` §3.4/§4.9 trued to the
   bare `RELOAD` meta, §5.2 to this file layout, the status line. `CLAUDE.md` waits for PR 8.

### Files

| File | Change |
|---|---|
| `extensions/ai-annotations/records.ts`, `transactions.ts`, `records.test.ts`, `plugin.test.ts`; `document/useActiveSession.ts` | New |
| `extensions/ai-annotations/plugin.ts` | Owns the records; `apply` as above; tooltip from plugin state; `view()`/subscription/closure deleted |
| `extensions/ai-annotations/extension.ts`, `index.ts` | Three commands; barrel re-exports the helpers and selectors |
| `extensions/ai-annotations/store.ts` | Deleted |
| `extensions/ai-annotations/reanchor.ts` | `remapAnnotations` moves in; unchanged otherwise |
| `types/annotations.ts` | `anchorText?`; `AnnotationState`/`AnnotationActions` deleted |
| `document/session.ts` | `afterTransaction` + persist policy; `Session.records` loses `annotations`; seed/HMR `load`; reload block and store coupling removed; `subscribeActiveSession` |
| `lib/diffUtils.ts` | `buildWordDiffAnnotations` returns inputs |
| `lib/tools/executors/editor.ts`, `file.ts`, `document.ts`, `tabs.ts` | Producer sites and reads as in the tables |
| `extensions/ai-suggestions/extension.ts` | Accept paths annotate in their own transaction; microtasks gone |
| `components/editor/Editor.tsx`, `SelectionPopover.tsx`, `AIEditsHistoryPanel.tsx`, `components/chat/ChatPanel.tsx` | Commands + `useActiveSession` |
| `main.tsx` | Seams re-pointed |
| `document/session.test.ts` | §G test rewritten; identity, reload and HMR cases added |
| `e2e/electron.document-sessions.spec.ts`, `e2e/electron.annotation-reanchor.spec.ts` | Cases 2, 4, the case 1 clause, the tripwire; the #1141 spec reinstated |
| `docs/issues/1146/plan.md`, `docs/architecture/editor-state.md` | Record; truing |

### Tests

**vitest** (`npm run test:unit`; headless `new Editor({ extensions: createEditorExtensions() })` as in
`session.test.ts`):
- `records.test.ts`: `mapRecords` move / split (new ids, sliced content) / both remnants collapse → one detached
  copy under the original id / collapse → detach / zero-width deletion moves and never detaches;
  `reanchorRecords` trailing space above, doubled space, text gone → detach, text typed inside → grows;
  `loadRecords` match keeps, mismatch → nearest match, no match → detach, legacy row filled, legacy
  out-of-bounds → detach, zero-width clamp; `removeRecordsInRange` remnants; `anchorTextAt ≡ textIndex` slice.
- `plugin.test.ts`: replace + `add` in one transaction (old record detached, new one on the replacement);
  `remove`; `removeRange`; `IDENTITY_META` restamp; `records` reference stable across a transaction that moves
  nothing; urgent vs plain revision classification; a whole-document replace with no meta re-anchors.
- `session.test.ts`: the three `useAnnotationStore` tests on `editor.commands.addAIAnnotations`; persist pairing
  (own id + own records; immediate on add, debounced on typing; nothing at load); identity write under the new
  id; `replaceSessionDocument({ keepHistory: false })` re-anchors (text shortened above the highlight → moved);
  `rebuildForSchema` carries the records.

**e2e** (`e2e/electron.document-sessions.spec.ts`, port 9230, plus the reinstated spec on port 9231; 9222 default,
9225–9227 and 9229 ×3 are taken):
- Case 2: annotate in A, six backspaces above the highlight leaving a trailing space, switch to B, type, switch
  back: A's painted text is on its words and B's rows are untouched; **then relaunch** and assert both again.
  The plain switch passes at `5b67ba9` (PR 1 keeps states); the relaunch fails there (rows applied as stored
  onto a re-parsed document). Disk reload/convert is pinned by the vitest (no e2e seam without the dialog).
- Case 4, annotation half: annotate, enter source, type elsewhere, exit, one ⌘Z: the text is restored and the
  annotation is live on its words. Fails at `5b67ba9` (the inverse replace collapses every range).
- Case 1's `anchorText` clause: every live row's `anchorText` equals its text in its own document when that tab
  is active, and A's rows never contain B's words (and vice versa).
- `electron.annotation-reanchor.spec.ts` from `05b24e8`: the three cases (trailing space + switch, doubled space
  + switch, trailing space + relaunch) with two added assertions each: the rows under the probe's id cover the
  highlighted text after `settle`, and `1138-other.md`'s rows stay empty.
- Tripwire in `session tripwires`: nothing references `useAnnotationStore` or imports `ai-annotations/store`.
- Must stay green: `ai-provenance`, `ai-edit-lifecycle` (relaunch compares IndexedDB rows and detached counts;
  load does not rewrite them), `activity-panel`, `source-mode-authority` (same reload algorithm),
  `suggestions`, `suggestions-persist`, `tab-switch-flush`, `markdown-create`, `comment-*`, `share-sync`.

### Verification and QA

1. After each commit: `npm run typecheck:renderer` (baseline 69, must not grow; the store types going should
   lower it), `npm run test:unit`, `npm run build`, the targeted specs above
   (`PROSE_DEBUG_PORT=9229 npx playwright test --global-timeout 0 <files>` from the worktree).
2. After commit 3: the full local suite from the worktree, then push, CI green, claude review; review
   follow-ups fixed in the branch.
3. QA on the dev server: `qa/dev` = `5b67ba9` + the branch (`--no-ff`), renderer hot-reloads; §2 of
   `docs/qa/v1.9.0-editor-state.md` (written when the PR is up): annotate via chat → edit above → switch and
   relaunch; source round trip with an edit, then ⌘Z; history panel X and jump, including a deletion marker;
   selection toggle add/remove; paste-as-AI; accept a suggestion made before a rename (the PR 1 regression,
   now by construction); trash and reopen.
4. Merge on the operator's word; `qa/dev` reset to the release head; worktree removed; `annotation:*` IndexedDB
   cleanup of the two contaminated dev-profile keys still only offered.

### Decisions folded in (say so at approval to change any)

1. **Zero-width deletion markers stop detaching on the next edit.** They map by position and stay "current" in
   the Activity panel with a working jump (caret at the deletion point); at load they keep their position when in
   bounds. Today's immediate "superseded" is an accident of `from >= to`.
2. **Any whole-document replace re-anchors by text, not only `RELOAD`.** Covers undo/redo of a source exit (case
   4, decision 10) and makes select-all + paste keep records whose text survives instead of detaching all.
3. **Disk reload stays a re-open**, re-anchored at load by exact text then nearest match: an external edit
   inside a highlight detaches it where the source-exit path would grow it. Acceptable for an external change.

### Open points

- The `BUILD_META` setter stays in `session.ts` for PR 3's comment plugin; PR 8 sweeps it if nothing reads it.
- `getAnnotations` returns a copy so a spec cannot mutate plugin state; `getAnnotationDocId` returns `null` with no
  active session (today the store's initial value).
- The dev-only HMR key fallback has no spec; a dev remount with annotations open is the manual check.

### Execution log

- **2026-11-02, step 0 done (plan approved by the operator):** worktree `/Users/solo-one/Code/Projects/prose-1146` on branch `issue-1146-annotation-plugin-state` from `release/v1.9.0` = `5b67ba9`, PR 1's `node_modules` carried over (Electron 45.2.1, vitest 5.0.5). **Next: commit 1 (pure core).**
