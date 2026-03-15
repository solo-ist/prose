# LLM Pipeline Architecture

How AI requests flow through Prose, from user input to rendered response.

---

## Overview

All LLM calls run in the **main process** to avoid browser CORS restrictions. The renderer sends requests over IPC and receives streamed tokens back via IPC events.

```
Renderer (React)
  └─ useChat hook
       └─ getApi().llmStream(request)
            └─ IPC: llm:stream
                 └─ Main Process (ipc.ts)
                      └─ Vercel AI SDK → Anthropic API
                           └─ IPC events: llm:stream:chunk / llm:stream:end / llm:stream:error
                                └─ useChat hook updates chatStore
                                     └─ ChatPanel re-renders
```

---

## Tool Modes

The assistant operates in different modes depending on context:

| Mode | When Active | System Prompt Variant |
|------|-------------|----------------------|
| **Chat** | Default | Conversational assistant with document context |
| **Source Edit** | Source mode open | Aware of raw markdown, can emit edit blocks |
| **reMarkable OCR** | Notebook sync | OCR + transcription focused |

The active mode is determined in `useChat.ts` before constructing the request. The system prompt is assembled from static templates plus dynamic context (current document content, frontmatter, cursor position).

---

## Stream Lifecycle

### 1. Request Construction (`useChat.ts`)

```ts
const request: LLMStreamRequest = {
  streamId: crypto.randomUUID(),   // ties events back to this request
  messages: [...history, userMessage],
  system: buildSystemPrompt(editorState),
  model: settings.model,
  maxTokens: settings.maxTokens,
}
```

### 2. IPC Dispatch

```ts
getApi().llmStream(request)
// registers chunk/end/error listeners before sending
```

### 3. Main Process Handling (`src/main/ipc.ts`)

```ts
ipcMain.handle('llm:stream', async (event, request) => {
  const stream = streamText({
    model: anthropic(request.model),
    messages: request.messages,
    system: request.system,
  })
  for await (const chunk of stream) {
    event.sender.send(`llm:stream:chunk:${request.streamId}`, chunk)
  }
  event.sender.send(`llm:stream:end:${request.streamId}`)
})
```

### 4. Abort

```ts
// Renderer
getApi().llmStreamAbort(streamId)

// Main process
ipcMain.handle('llm:stream:abort', (_event, streamId) => {
  activeStreams.get(streamId)?.abort()
})
```

---

## Suggestion Pipeline

When the assistant proposes document edits, they go through a structured pipeline:

```
Assistant response
  └─ parseEditBlocks(content)          // extract old/new pairs
       └─ validateEditTargets(editor)  // verify old text exists in doc
            └─ AISuggestionPopover     // surface to user with Apply button
                 └─ applyEdit(editor)  // ProseMirror transaction
```

Edit blocks use a search/replace format:
```
<edit>
<old>text to find</old>
<new>replacement text</new>
</edit>
```

Multiple blocks can appear in one response. Each is applied independently.

---

## Provider

**Anthropic is the only supported provider.** The Vercel AI SDK's `@ai-sdk/anthropic` package handles model instantiation. The API key is stored via Electron's `safeStorage` in the credential store (`src/main/credentialStore.ts`) and loaded at request time — it is never stored in plain text.

Legacy code referencing OpenAI, OpenRouter, or Ollama exists but is not maintained. Do not add new functionality for other providers.

---

## Adding a New LLM Feature

1. Define the request shape in `src/renderer/types/index.ts`
2. Add the IPC handler in `src/main/ipc.ts`
3. Expose via preload (`src/preload/index.ts`) and `ElectronAPI` type
4. Call from `useChat.ts` or a new hook
5. Add a browser stub in `src/renderer/lib/browserApi.ts` (web mode does not support direct Anthropic calls due to CORS)
