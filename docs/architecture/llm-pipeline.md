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
- **`toolLoopContextRef`** — tracks `{apiMessages, assistantMsgId, roundtripCount, lastErrorSignature}` across recursive stream restarts, tagged with `streamId`

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
| `llm:stream:tool-call` | main → renderer | `{streamId, id, name, args}` — accumulated in `pendingToolCallsRef` |
| `llm:stream:complete` | main → renderer | `{streamId, content, toolCalls}` — triggers tool execution or completion |
| `llm:stream:error` | main → renderer | `{streamId, error}` — appends actionable error guidance |
| `llm:stream:abort` (invoke) | renderer → main | `streamId` — aborts active stream |

### Tool Execution Loop (in `onLLMStreamComplete`)

When the stream completes with tool calls:

1. **Circuit breaker** — if `roundtripCount >= MAX_TOOL_ROUNDTRIPS`, append error and stop.
2. **Build assistant content** — text blocks + `tool_use` blocks for the API message history.
3. **Sort editor-mutating tools** — `edit`, `insert`, `suggest_edit` are sorted by document position descending (bottom-first) via `resolveToolPosition()`. Non-editor tools sort before editor tools.
4. **Execute each tool** — `executeTool(name, args, toolMode, provenance)` from `src/renderer/lib/tools/index.ts`.
5. **Duplicate failure detection** — tracks `"${toolName}:${errorMessage}"` signature. If identical to the previous roundtrip's error, stops the loop.
6. **Build tool results** — each result is summarized (strips `markdown` from `read_document`) and appended as a `role: 'tool'` message.
7. **Recursive restart** — generates new `streamId`, calls `startStreaming()` with the same `assistantMsgId`, updates both refs, calls `api.llmChatStream()` again.

### Main Process Streaming (src/main/ipc.ts)

Two code paths:

- **Anthropic with tools** — uses `@anthropic-ai/sdk` directly (not Vercel AI SDK) to avoid tool format translation. Converts `role: 'tool'` messages to Anthropic's `tool_result` format. Emits `chunk`, `tool-call`, and `complete` events.
- **Other providers** — uses Vercel AI SDK `streamText()`. No tool support. Emits `chunk` and `complete` only.

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

- **Accept** (`acceptAISuggestion(id)`) — collects all nodes bearing the mark (a suggestion may span multiple text nodes if formatting splits the range), removes the mark, replaces the text range with `suggestedText`, then creates word-level diff annotations via `createWordDiffAnnotations()` for provenance tracking.
- **Reject** (`rejectAISuggestion(id)`) — removes the mark only. No text change.

### Node ID System

The `NodeIds` extension (`src/renderer/extensions/node-ids/`) assigns 8-char random IDs to block nodes (`paragraph`, `heading`, `codeBlock`, `blockquote`, `listItem`, `taskItem`). A ProseMirror plugin runs on `appendTransaction` to assign IDs to any nodes missing them. Paragraphs inside list items are skipped — the list item itself is the addressable unit.

### Persistence

Suggestions are persisted to IndexedDB via `useSuggestionStore`. On tab switch, `restoreAISuggestions()` recovers marks by text-content search (not stored positions, which would be stale).

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
