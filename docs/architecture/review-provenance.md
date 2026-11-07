# Review provenance: who made every record

Status: design of record for the 1.9.1 epic ([#1230](https://github.com/solo-ist/prose/issues/1230)), written for P0 ([#1231](https://github.com/solo-ist/prose/issues/1231)) before P1 ([#1232](https://github.com/solo-ist/prose/issues/1232)) and P2 ([#1233](https://github.com/solo-ist/prose/issues/1233)) code against it. It extends `editor-state.md` (the per-tab sessions, the plugin-state records and the four rules) and does not change any of its rules. Decided with the operator 2026-11-07.

How to read it cold: section 1 is why. Section 2 is the `Actor` type. Section 3 says where each record carries it, section 4 how records written before 1.9.1 read. Section 5 is the suggestion lifecycle and the review log, section 6 who stamps what. Section 7 is what leaves the machine, section 8 the delivery and the tests.

## 1. Why

PR #854 asked how Prose works with any model and answered with MCP: external agents propose, Prose keeps the decision. 1.9.1 has three ways into a document: the writer, **Prose Agents** (the in-app chat on the writer's own Anthropic, OpenAI or Inference Coop key) and **MCP agents** (Claude Desktop, Claude Code, Codex, Open WebUI, LibreChat locally; ChatGPT and claude.ai through the relay). Each of them can comment, reply and suggest. Today a record knows only `'user'` or `'ai'`, and every MCP edit is labelled "Claude (MCP)". A review is only as good as its answer to "who said this?", so every record now carries an actor, and the life of a suggestion (feedback, revision, decision) is kept instead of vanishing when the mark goes.

The writer decides. No agent accepts or rejects over MCP (#607); agents learn the outcome by reading the review log (section 5.4).

## 2. The `Actor`

In `src/shared/review/actor.ts`, so the main process (MCP connections, the relay) and the renderer share it:

```ts
export type Actor = HumanActor | ProseAgentActor | McpAgentActor | UnattributedActor

export interface HumanActor {
  kind: 'human'
  /** This desktop's writer. Their name and email are read from Settings at display time, never stored here. */
  self: boolean
  /** A share reviewer's display name (self === false). */
  name?: string
  /** Reserved for ATProto (AT-1). Nothing sets it in 1.9.1. */
  did?: string
}

export interface ProseAgentActor {
  kind: 'prose-agent'
  provider: 'anthropic' | 'openai' | 'inference-coop'
  model: string
}

export interface McpAgentActor {
  kind: 'mcp-agent'
  /** The connection the writer created (M2), or 'launch' for the bundled stdio bridge, or 'legacy'. */
  connectionId: string
  /** The connection's label when the record was made; kept if the connection is later deleted. */
  connectionLabel: string
  /** Self-reported by the client (`clientInfo.name` / `.version`, a model name). Untrusted; shown beside the label, never instead of it. */
  client?: string
  clientVersion?: string
  model?: string
  /** How the call arrived; filled in by main from M2 (#1236) on, optional until then. */
  via?: 'stdio' | 'http' | 'relay'
}

/** AI text whose origin is unknown: rows from before 1.9.1, and text the writer marks as AI-written (the selection toggle, "Imported"). */
export interface UnattributedActor {
  kind: 'unattributed'
  label: string
}
```

Decisions in the type:

- **The writer is `self`, not a name.** Records say `{ kind: 'human', self: true }`; the name shown is today's Settings → General name ("You" when empty). Renaming yourself relabels your history, and an email can't leak through a record because records never hold one (section 7).
- **The connection is the identity.** For MCP the label the writer gave the connection is what Prose trusts; what a client reports about itself is recorded beside it. A client that calls itself "Claude" on a connection labelled "Codex laptop" shows as "Codex laptop · Claude".
- **Self-reported strings are data.** `client`, `clientVersion`, `model` and a share `name` are trimmed, stripped of control characters and capped (100 characters) where they enter (main for MCP, `shareSync.ts` for share rows), and rendered only as React text.
- **Provenance stays separate.** `conversationId` / `messageId` (where an edit came from) stay in today's provenance fields; the actor says who.

`actorLabel(actor, settings)` in the same module is the one display function (popovers, Activity, tool results).

## 3. Where records carry it

| Record | Lives in | Field | Notes |
|---|---|---|---|
| Comment thread | comments plugin state (`CommentData`) | `actor?: Actor` | `author` and `authorName` stay written for the share wire format (section 7); `actor` is the source when present |
| Comment reply | `CommentReply` | `actor?: Actor` | same |
| AI suggestion | the `aiSuggestion` mark | `actor` attribute (JSON), `AISuggestionData.actor` | `provenanceModel` and friends stay; the mark's HTML gains `data-ai-actor` for the clipboard round trip |
| AI annotation | annotations plugin state | `AIProvenance.actor?: Actor` | the proposer of the accepted text, so authorship highlighting says which agent wrote it |
| Review log entry | review-log plugin state (new, section 5) | `actor`, `decidedBy` | every entry has one |

All new fields are optional and JSON-compatible: no store changes shape, and only the review log adds a store (section 5.5).

## 4. Reading records written before 1.9.1

One pure function per record kind in `actor.ts` (`actorOfComment`, `actorOfProvenance`), applied wherever a record is read for display or a tool result. *(Shipped in P1: rows are derived on read and never rewritten, so there is no migration to get wrong; `author` and `authorName` stay written beside `actor` for the share wire format.)*

| Old shape | Actor |
|---|---|
| comment / reply `author: 'user'` or missing, no `authorName` | `{ kind: 'human', self: true }` |
| comment / reply with `authorName` | `{ kind: 'human', self: false, name: authorName }` |
| comment / reply `author: 'ai'` | `{ kind: 'unattributed', label: 'AI' }` (in-app chat and MCP both wrote `'ai'`; it can't be told apart) |
| suggestion / annotation `provenanceModel: 'Claude (MCP)'` | `{ kind: 'mcp-agent', connectionId: 'legacy', connectionLabel: 'MCP client', via: 'stdio' }` |
| suggestion / annotation `provenanceModel: 'Imported'` | `{ kind: 'unattributed', label: 'Imported' }` |
| annotation `provenanceModel: 'External AI'` (pasted AI text) | `{ kind: 'unattributed', label: 'External AI' }` |
| suggestion / annotation with any other `provenanceModel` | `{ kind: 'prose-agent', provider: 'anthropic', model: provenanceModel }` (before 1.9.1 the in-app chat was Anthropic-only) |
| suggestion / annotation with no model | `{ kind: 'unattributed', label: 'AI' }` |

A vitest per row of this table, against fixtures copied from a 1.9.0 profile.

## 5. The suggestion lifecycle and the review log

### 5.1 What stays as it is

A pending suggestion is still an `aiSuggestion` mark in the document, restored by `originalText` at load and persisted by `session.ts` from the marks (`editor-state.md` §5.3). Accept and reject keep their commands and the `RESOLVED` meta; an accepted suggestion still becomes an AI annotation. What is new is that a suggestion leaves a history when its mark goes, and that the conversation around it is kept.

### 5.2 The review-log plugin

A new extension, `extensions/review-log/`, with its own plugin state per `EditorState`, built like the comments and annotations plugins (pure transitions in `log.ts`, key and metas in `transactions.ts`, `apply` in `plugin.ts`):

```ts
interface ReviewLogState {
  /** Every suggestion this document has seen, pending or decided, by id. */
  suggestions: Record<string, SuggestionHistory>
  /** Append-only; `seq` is per document and only grows. */
  events: ReviewEvent[]
  nextSeq: number
  revision: number
}

interface SuggestionHistory {
  id: string
  type: 'edit' | 'insertion' | 'deletion'          // 'deletion' arrives with P3
  originalText: string
  suggestedText: string
  explanation: string
  actor: Actor
  createdAt: number
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  decidedAt?: number
  decidedBy?: Actor
  supersedes?: string                              // the id this one revised
  supersededBy?: string
  feedback: FeedbackEntry[]
}

interface FeedbackEntry { id: string; actor: Actor; text: string; createdAt: number }

interface ReviewEvent {
  seq: number
  at: number
  kind: 'suggestion:proposed' | 'suggestion:revised' | 'suggestion:accepted' | 'suggestion:rejected'
      | 'suggestion:reopened' | 'suggestion:feedback' | 'comment:added' | 'comment:replied' | 'comment:resolved' | 'comment:reopened'
  actor: Actor
  suggestionId?: string
  threadId?: string
}
```

Rule 3 holds by construction: a producer adds the log meta to the transaction that creates the record (the suggestion mark, the accept, the reply), so a record and its event enter the state together. `apply` never infers events from diffs, with one exception: a suggestion mark that disappears without an accept, reject or revise meta (the writer deleted the text it covered) is logged as `rejected` with `decidedBy` the writer, which is what it was.

Undo is history, not erasure. Undoing an accept or a reject puts the mark back: the history row returns to `pending` and the plugin logs `suggestion:reopened` with the writer as actor. Events are never removed.

### 5.3 Feedback, revise, supersede

- **Feedback** replaces the single `userReply` attribute with `feedback` on the history row: any actor can add an entry. At load a mark with a `userReply` and no history row gets one entry from it (the writer, `self`), and the attribute stays readable until P2 stops writing it.
- **Revise** is one transaction: remove the old mark, add the new one (new id) over the same range, set `supersededBy` / `supersedes`, log `suggestion:revised`. Only a pending suggestion can be revised, by any actor; the old one shows as superseded in history and links forward.
- **Accept / reject** record `decidedBy`: the writer from the UI, a Prose Agent when the in-app agent calls `accept_diff` / `reject_diff` (mode-gated as today). MCP has no decide tool.

### 5.4 How agents follow the review

`list_review_events({ since?: number, document? })` returns events with `seq > since`, oldest first, plus the current `nextSeq`; `get_review_status` returns the counts and the pending ids. An agent polls; no tool call waits for a human, because Codex and LibreChat time out at 60 seconds and a decision can take a day. Comment events are logged too, so an agent sees the writer's replies to its comments.

### 5.5 Persistence

- **Store:** `review_log` in IndexedDB, keyed by `documentId`, value `{ suggestions, events, nextSeq }`. `DB_VERSION` 9 → 10, with the fresh-install and upgrade cases tested separately.
- **Writer:** `saveReviewLog` / `deleteReviewLog` in `lib/persistence.ts`, imported only by `document/session.ts` (rule 1). The tripwire in `e2e/electron.document-sessions.spec.ts` gains them.
- **When:** `afterTransaction` writes when the log's `revision` moves (at once: every log change is a decision or a message, so there is no debounced class), and `closeSession` writes the final state. `setSessionIdentity` copies the row to the new id with the other three kinds; deleting an untitled document deletes it.
- **Size:** events are capped at the last 5,000 per document and a decided history row older than a year keeps its text but drops its feedback beyond the last 20 entries. Both caps are applied in the pure transition, so the persisted value is always the state's.

## 6. Who stamps what

| Producer | Actor |
|---|---|
| Comment UI, reply UI, accept / reject / feedback in the UI, Suggesting mode (P3) | `{ kind: 'human', self: true }` |
| In-app chat tools | `{ kind: 'prose-agent', provider, model }` from the turn's settings, carried on `ToolProvenance` (`lib/tools/provenanceTypes.ts`) |
| MCP calls | built in main from the connection (M2) or the stdio bridge's `clientInfo`, passed with `mcp:tool:invoke`; the renderer takes main's actor and never accepts one from tool arguments |
| Share pulls and artifact imports | `{ kind: 'human', self: false, name }` |
| The selection popover's "mark as AI" | `{ kind: 'unattributed', label: 'Imported' }` |

Until M2 lands, MCP calls carry `{ connectionId: 'launch', connectionLabel: 'MCP client', client: clientInfo.name, via }`.

## 7. What leaves the machine

- **Share pushes keep today's wire format.** A thread or reply by the writer goes without `authorName`, as today (the gateway shows the publication's owner); one by a Prose Agent or an MCP agent goes as "Prose", as `author: 'ai'` does today. Connection labels, client names and models do not go to the gateway in 1.9.1. Showing agent attribution to share viewers is a later decision.
- **Email never leaves.** It lives in Settings only, is not part of any record, and is not sent with share pushes, MCP results or the relay.
- **MCP results carry actors** (`list_comments`, `list_suggestions`, `list_review_events`) with `actorLabel` and the kind; a human actor appears as "the writer" or a reviewer's name.
- **The relay** (M5) forwards calls and results in memory; nothing in this document's records is stored at the gateway.
- **ATProto:** `did` is reserved. When AT-1 links a DID to the writer's account, `self` records can be published under it without rewriting them.

## 8. Delivery and tests

| PR | What of this design |
|---|---|
| P1 (#1232) | `actor.ts`; the fields in section 3 except the review log; the read table in section 4; every producer in section 6; Settings name and email; popovers and Activity show the actor |
| P2 (#1233) | The review-log plugin, feedback, revise, the events, the store and its writer (section 5) |
| M4 (#890) | The MCP tools over it: `list_suggestions`, `reply_to_suggestion`, `revise_suggestion`, `get_review_status`, `list_review_events`, `reply_to_comment`, `reopen_comment`, `suggest_insert`, `suggest_delete` |
| P4 (#1234) | Activity over the log, filtered by actor and connection |
| P3 (#891) | Suggesting mode: the writer's edits become suggestions with the writer as actor; the `deletion` suggestion type; display controls |

Tests the design requires:

1. vitest for every row of section 4, every transition of section 5 (propose, feedback, revise, accept, reject, delete-the-text, undo of an accept) and the caps.
2. e2e: each record kind keeps its actor across a relaunch, from a 1.9.0 fixture profile; a revise chain survives a relaunch with the old suggestion superseded and linked.
3. The tripwire gains `saveReviewLog` / `deleteReviewLog`; `DB_VERSION` fresh and upgrade cases.
4. A test that no record, MCP result or share push body contains the writer's email.
