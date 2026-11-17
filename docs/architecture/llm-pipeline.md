# LLM Pipeline Architecture

How AI chat, tool execution, and inline suggestions work end-to-end.

**Key files:** `src/renderer/hooks/useChat.ts`, `src/shared/tools/registry.ts`, `src/renderer/lib/tools/index.ts`, `src/renderer/extensions/ai-suggestions/`

---

## Tool Modes

Three modes gate which tools the LLM can use. Mode is stored as `toolMode` in `chatStore`.

| Mode | Available Tools | Max Tokens | Use Case |
|------|----------------|------------|----------|
| `suggestions` | `requiresMode: null` only (read + `suggest_edit`) | 3072 | Safe editing — AI proposes, user accepts/rejects |
| `plan` | All except `requiresMode: 'full'` (`edit`, `insert` excluded) | 4096 | AI plans changes, no direct document mutation |
| `full` | All tools | 4096 | Full autonomy — AI can edit directly |

Each `ToolConfig` declares `requiresMode: ToolMode | null`:
- `null` — available in all modes
- `'full'` — only in full mode (currently: `edit`, `insert`)

Filtering logic in `getToolsForMode()` (`src/shared/tools/registry.ts`):
- `full` → returns all tools
- `plan` → excludes tools where `requiresMode === 'full'`
- `suggestions` → only tools where `requiresMode === null`

Default mode is `'suggestions'` (`src/renderer/lib/tools/modes.ts`), though `chatStore` initializes to `'full'` for backwards compatibility.

---

## Stream Lifecycle

### Overview

```
sendMessage() → api.llmChatStream({streamId}) → IPC events → tool execution → recursive restart
```

### Constants

```ts
const MAX_TOOL_ROUNDTRIPS = 5     // circuit breaker for tool loops
const MAX_HISTORY_MESSAGES = 20   // context window pruning
```

### Module-Level Refs

Two refs live outside the React hook so globally-registered IPC event handlers can access them:

- **`pendingToolCallsRef`** — accumulates `{id, name, args}` from streaming `tool-call` events, tagged with `streamId`
- **`toolLoopContextRef`** — tracks `{apiMessages, assistantMsgId, roundtripCount, lastErrorSignature, modeJustSwitched}` across recursive stream restarts, tagged with `streamId`. `modeJustSwitched` is set at turn start and preserved across continuations so the "you just switched modes" notice stays on the system prompt for every LLM call within a turn that began with a mode switch.

Both are reset by `clearStreamRefs()` on abort, error, completion, or circuit-breaker stop.

### Flow

1. **Guard checks** — empty content, `isLoading`, AI consent, config validation.
2. **Conversation setup** — auto-creates conversation if `activeConversationId` is null.
3. **Message prep** — prepends `messageContext` (quoted selection) if present. Adds user message to store.
4. **History pruning** — keeps the first non-hidden user message pinned, then the last `MAX_HISTORY_MESSAGES`. Result: `[pinnedFirst?, ...last20]`.
5. **Stream init** — creates `assistantMsgId` and `streamId` (both via `createMessageId()`). Adds empty assistant message placeholder. Calls `startStreaming(assistantMsgId, streamId)` which sets `chatStore.currentStreamId`.
6. **IPC call** — `api.llmChatStream(request)` sends request to main process. Resolves when streaming begins, not when it ends.

### IPC Events

All handlers validate `streamId === chatStore.currentStreamId` before processing.

| Channel | Direction | Payload |
|---------|-----------|---------|
| `llm:stream` (invoke) | renderer → main | `LLMStreamRequest` (provider, model, messages, tools, streamId) |
| `llm:stream:chunk` | main → renderer | `{streamId, delta}` — appended to streaming message |
| `llm:stream:tool-call:start` | main → renderer | `{streamId, toolCallId, toolName}` — fired on `content_block_start` for `tool_use`. Renderer appends `<tool-drafting>` marker for the "Drafting…" chip. |
| `llm:stream:tool-call` | main → renderer | `{streamId, id, name, args}` — accumulated in `pendingToolCallsRef` |
| `llm:stream:complete` | main → renderer | `{streamId, content, toolCalls}` — triggers tool execution or completion |
| `llm:stream:error` | main → renderer | `{streamId, error}` — appends actionable error guidance |
| `llm:stream:abort` (invoke) | renderer → main | `streamId` — aborts active stream |

### Tool Execution Loop (in `onLLMStreamComplete`)

When the stream completes with tool calls:

1. **Circuit breaker** — if `roundtripCount >= MAX_TOOL_ROUNDTRIPS`, append error and stop.
2. **Build assistant content** — `toolRoundAssistantMessage` (`lib/toolLoopMessages.ts`): the response's own thinking blocks first and unmodified, then its text, then its `tool_use` blocks. The thinking must come from the same response as the tool calls: Anthropic binds each block to the system prompt, the tool set and every message before it, and replays a block one round late only to reject the request (#1289).
3. **Sort editor-mutating tools** — `edit`, `insert`, `suggest_edit`, `delete_node` are sorted by document position descending (bottom-first) via `resolveToolPosition()`, so an earlier tool call can't shift positions out from under a later one. `move_cursor` is intentionally **not** in this set — it changes the selection, not document content, so it has no effect on subsequent positions. Non-editor tools sort before editor tools.
4. **Execute each tool** — `executeTool(name, args, toolMode, provenance)` from `src/renderer/lib/tools/index.ts`. `edit` and `insert` are async: unless the user prefers reduced motion, content is inserted in word-level chunks across ~24 animation frames so the user perceives the edit arriving rather than appearing. Tool results resolve once all chunks have landed.
5. **Duplicate failure detection** — tracks `"${toolName}:${errorMessage}"` signature. If identical to the previous roundtrip's error, stops the loop.
6. **Build tool results** — each result is summarized (strips `markdown` from `read_document`) and appended as a `role: 'tool'` message.
7. **Recursive restart** — generates new `streamId`, calls `startStreaming()` with the same `assistantMsgId`, updates both refs, calls `api.llmChatStream()` again.

### Main Process Streaming (src/main/ipc.ts)

One path per transport (`ProviderInfo.transport`; every switch on it is exhaustive):

- **Anthropic with tools** — uses `@anthropic-ai/sdk` directly (not Vercel AI SDK) to avoid tool format translation. Converts `role: 'tool'` messages to Anthropic's `tool_result` format. Emits `chunk`, `tool-call:start` (on each `content_block_start` for `tool_use`, before any `input_json_delta`), `tool-call`, and `complete` events. With adaptive thinking it sends `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` under the `thinking-binding-controls-2026-08-01` beta (`src/main/thinkingBinding.ts`): each continuation's system prompt describes the document as it is now, so after an edit tool the turn's earlier thinking no longer matches, and the API drops those blocks instead of failing the turn. Drops are logged from the response's `input_transformations` (#1289).
- **Anthropic without tools** — uses Vercel AI SDK `streamText()` via `@ai-sdk/anthropic`. No tool support. Emits `chunk` and `complete` only.
- **OpenAI** (`transport: 'responses'`, #1301) — `src/main/responses.ts`, with or without tools: `fetch` to `POST /responses` and a small SSE reader, no SDK. It emits the same events as the Anthropic path: `chunk` from `response.output_text.delta`, `thinking:delta` (a cumulative snapshot) from `response.reasoning_summary_text.delta`, `tool-call:start` when a `function_call` item is announced, then `tool-call` and `complete`.
  - **Out:** the system prompt is `instructions`; tools are flat function tools with `strict: false` (Prose's tools have optional arguments); an assistant tool round is its text plus one `function_call` per tool use; a tool result is a `function_call_output` answering the call's `call_id`. `store: false` on every request.
  - **Thinking toggle:** on sends `reasoning: { effort: 'medium', summary: 'auto' }` with 16,000 tokens of room in `max_output_tokens`; off sends the lowest effort the model accepts (first guess: `minimal` for the first gpt-5 generation, `none` after) with 8,000 when that effort still reasons. A model that doesn't reason (the gpt-4 line, the `-chat` aliases) gets no `reasoning` and no toggle.
  - **Learning from refusals** (`ReasoningLessons`, in memory for the launch): models differ in which efforts they take and the id doesn't say. A 400 that names `reasoning.effort` and lists the supported values moves that model to the best listed value for the toggle's state; one that calls the parameter unsupported drops `reasoning` for that model; one about `reasoning.summary` (an unverified organization) drops the summary for that base URL. Each lesson is one resend, before anything has streamed, three sends at most.
  - **Reasoning across a tool loop** (`ReplayMemory`): the API wants a reasoning model's reasoning items back with its tool calls. The renderer's messages can't carry them, so main keeps each tool round's output items (reasoning, text, calls, in order) by call id and model, and `toResponsesInput` sends that round back verbatim in place of the rebuilt one. After a relaunch, or for a round another model answered, the round is rebuilt without reasoning items, which the API accepts. If the API refuses kept items, the memory is cleared and the request resent rebuilt.
- **Chat Completions** (`transport: 'chat-completions'`, #1241) — `src/main/chatCompletions.ts`, for OpenAI-compatible gateways. No provider uses it today (Inference Coop, #956, will); it stays covered by its unit suite.

Active streams tracked in `Map<string, AbortController>` for abort support.

---

## Suggestion Pipeline

How `suggest_edit` creates inline suggestions that users can accept or reject.

### Tool Execution

1. `executeSuggestEdit(args, provenance)` checks editor availability and read-only state.
2. **`findNodeById(doc, nodeId)`** — walks `doc.descendants()` looking for a block node with matching `attrs.nodeId`. Returns `{node, pos}`.
3. **`findNodeByContent(doc, search)`** — fallback if node ID not found. Matches `node.textContent.trim()`.
4. On failure, `getNodesWithIds(doc)` builds an error listing all available nodes (type + first 40 chars) so the LLM can self-correct.
5. Sets text selection to the node's content range, then calls `editor.commands.setAISuggestion({...})`.

### The AI Suggestion Mark

`setAISuggestion` creates an `aiSuggestion` mark on the selected range with attributes:
- `id`, `type` (`'edit'` or `'insertion'`), `originalText`, `suggestedText`, `explanation`
- Provenance: `provenanceModel`, `provenanceConversationId`, `provenanceMessageId`, `documentId`

The mark renders as `<span class="ai-suggestion-mark" data-ai-suggestion-id="...">`.

### Accept / Reject

- **Accept** (`acceptAISuggestion(id)`) — collects all nodes bearing the mark (a suggestion may span multiple text nodes if formatting splits the range), removes the mark, replaces the text range with `suggestedText`, then creates word-level diff annotations via `createWordDiffAnnotations()` for provenance tracking. The suggestion's `explanation` is copied onto the annotation so the post-accept tooltip can show the model's reason.
- **Reject** (`rejectAISuggestion(id)`) — removes the mark only. No text change.

### Node ID System

The `NodeIds` extension (`src/renderer/extensions/node-ids/`) assigns 8-char random IDs to block nodes (`paragraph`, `heading`, `codeBlock`, `blockquote`, `listItem`, `taskItem`). A ProseMirror plugin runs on `appendTransaction` to assign IDs to any nodes missing them. Paragraphs inside list items are skipped — the list item itself is the addressable unit.

### Persistence

Suggestions are persisted to IndexedDB by the session layer from the live marks (`document/session.ts`, the suggestion projection: debounced, immediate on an accept or reject). At load the session's seed transaction re-applies them with `applySuggestionMarks` by text-content search (not stored positions, which would be stale); a tab switch swaps states and re-applies nothing.

---

## Tool Dispatch

`executeTool()` in `src/renderer/lib/tools/index.ts`:

1. `getTool(name)` — confirms tool exists in registry
2. `checkToolAccess(name, mode)` — enforces mode restrictions
3. `tool.schema.safeParse(args)` — Zod input validation
4. `switch` dispatch to typed executor function
5. Returns `ToolResult<T>` — either `toolSuccess(data)` or `toolError(message, code)`

### Error Codes

| Code | Trigger |
|------|---------|
| `UNKNOWN_TOOL` | Tool name not in registry |
| `MODE_RESTRICTED` | Tool not available in current mode |
| `INVALID_ARGS` | Zod validation failure |
| `EDITOR_NOT_AVAILABLE` | Editor not mounted (source mode active) |
| `EDITOR_READ_ONLY` | reMarkable OCR tab or preview tab |
| `NODE_NOT_FOUND` | Node ID not found and content fallback failed |
| `NOT_IMPLEMENTED` | No executor case for the tool |
| `EXECUTION_ERROR` | Uncaught exception in executor |
