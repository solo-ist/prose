# #1232 — P1: an Actor on every record

Part of epic #1230. Design of record: `docs/architecture/review-provenance.md` (P0, #1231), §2–§4 and §6–§7. Branch `issue-1232-actor` from `main` = `54aa64b`. Renderer and shared only: the new `user` settings field needs no main-process default (`settings:save` spreads the object, `settings:load` merges defaults), so the PR is not security-gated.

## What changes

1. **`src/shared/review/actor.ts`** (new): the `Actor` union from the design; `cleanActorText` (trim, strip control characters, cap at 100); `actorOfThread`, `actorOfReply`, `actorOfProvenance(model, actor?)` (annotations and suggestions); `actorLabel(actor, { selfName })`; `isAgentActor`. `UnattributedActor.label` is only ever a code constant (P0 review note).
2. **Types**: `CommentData.actor?`, `CommentReply.actor?`, `AIProvenance.actor?`, `AISuggestionData.actor?`, `ToolProvenance.actor?`; `Settings.user?: { name?: string; email?: string }`.
3. **Producers stamp the actor** (design §6):
   - the comment and reply UI (`CommentPopover`, `CommentReviewPanel`): the writer;
   - `useChat`'s turn provenance: a Prose Agent (`settings.llm.provider`, the model);
   - the MCP invoke handler in `App.tsx`: an MCP agent with `connectionId: 'launch'`, `connectionLabel: 'MCP client'` until M2 (#1236) builds it in main from the connection;
   - `add_comment` / `reply_to_comment` and `suggest_edit` take it from the call's provenance; every executor that records an annotation copies it through one helper (`annotationProvenance`);
   - the suggestion mark gains an `actor` attribute (`data-ai-actor`), carried through restore, `getAISuggestions` and the accept paths into the annotation;
   - paste-as-AI and the selection popover's "mark as AI" stay unattributed (`External AI`, `Imported`).
4. **Old rows are read, never rewritten** (refines design §4): `actorOf…` derives the actor from `author` / `authorName` / `provenance.model` whenever a record has none. Nothing is written back at load or later, so there is no migration to get wrong; the design's table is the derivation, with one added row (`External AI` → unattributed). `author` and `authorName` stay written beside `actor` for the share wire format and the viewer.
5. **Display**: the comment popover, Comment Review and Activity name the thread's and each reply's actor; the annotation tooltip and Activity name the annotation's actor instead of a bare model id; the suggestion popover gains a "by" line. Self shows the Settings name, "You" when it is empty.
6. **Settings → General**: "Your name" and "Email (optional)". The email is read by nothing in 1.9.1 except the test that proves it never leaves (§7 of the design).
7. **`list_comments`**: each comment and reply gains `by` (the label; the writer is "the writer") and `byKind`. Additive: `replies` keep their fields.

## Not in this PR

The review log (P2), connections and a main-built MCP actor (M2), the `via` transport (filled by M2; optional until then, a design refinement noted in the doc), share wire-format changes (none in 1.9.1).

## Tests

- `src/shared/review/actor.test.ts`: every row of the derivation table, `cleanActorText`, `actorLabel` for each kind with and without a self name.
- `e2e/electron.provenance.spec.ts` (port 9232): 1.9.0-shaped rows seeded into IndexedDB (a writer comment, an `'ai'` comment, a share reviewer's comment and reply, annotations from `claude-sonnet-5-5`, `Claude (MCP)` and `Imported`) read with the right labels in Activity; a comment and reply made in the UI, a Prose Agent `add_comment`, and an MCP `add_comment` (sent as `mcp:tool:invoke` from the main process) carry their actors across a relaunch; with a name and an email set, the name shows and the email appears in no IndexedDB row and no `list_comments` result. Falsified on a build of the merge-base.
- `npm run typecheck:renderer` at its baseline, `npm run test:unit`, `npm run build`; the comment, suggestion, annotation and Activity specs stay green.
