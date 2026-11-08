# #1241 — A2: OpenAI over one Chat Completions adapter

Part of the 1.9.1 epic [#1230](https://github.com/solo-ist/prose/issues/1230), track A. **Stacked on A1** (#1240,
PR [#1247](https://github.com/solo-ist/prose/pull/1247)): branch `issue-1241-openai` from `issue-1240-provider-layer`
= `c7f4e82`; the PR's base moves to `main` once #1247 merges. Security-gated (`src/main`): CI + claude review, then the
operator merges.

## Context

A1 gave Prose a provider list and kept every key in main. A2 adds the second provider, OpenAI, and the piece A3
(Inference Coop, a LiteLLM gateway) reuses: one adapter in main that speaks the Chat Completions API. The renderer's
chat loop (`useChat`) and its stream events stay exactly as they are; the adapter translates on the way out and back.

## Inventory (`c7f4e82`)

- **What the renderer sends** (`LLMStreamRequest`): `system`, `messages` in Anthropic's shape (a user string; an
  assistant message whose content blocks are `thinking`, `text`, `tool_use { id, name, input }`; one `role: 'tool'`
  message per result with `tool_call_id`), `tools` as `{ name, description, input_schema }`, `model`, `maxTokens?`,
  `thinking?`.
- **What it expects back** (`src/main/ipc.ts` `llm:stream`): `llm:stream:chunk { delta }`,
  `llm:stream:thinking:delta { thinking }` (cumulative), `llm:stream:tool-call:start { toolCallId, toolName }` before
  a call's input arrives, `llm:stream:tool-call { toolCall: { id, name, args } }` per call at the end,
  `llm:stream:complete { content, toolCalls?, thinkingBlocks? }`, or `llm:stream:error { error }`; an abort ends with
  `complete` and empty content.
- **A1's seam:** `transport !== 'anthropic'` → `never` guards in `llm:chat`, `llm:stream`, `emoji:generate`, and
  exhaustive switches in `settings:testApiKey` and `llm:fetchModels`. A second transport fails to compile at all five.
- **Renderer:** Settings → LLM already has a Provider select with one item; the model list falls back to
  `getModelsForProvider(provider)`; `fetchedModels` is not tagged by provider. The P1 `Actor` already allows
  `provider: 'openai'`.
- No OpenAI SDK is installed (`@ai-sdk/anthropic` and `@anthropic-ai/sdk` only).

## Design

**Provider entry** (`src/shared/llm/providers.ts`): `ProviderTransport = 'anthropic' | 'chat-completions'`;
`LLMProvider = 'anthropic' | 'openai'`. OpenAI: transport `chat-completions`, base URL `https://api.openai.com/v1`,
credential `llm-api-key-openai` (its own `credentialStore` entry through A1's `llmKeys.ts`; safeStorage only, never
in the renderer), a static seed (`gpt-5`, `gpt-5-mini`, `gpt-4.1`; the live list replaces it once a key is saved),
default `gpt-5`, small model `gpt-5-mini`, `thinking: false`, key format `sk-`. Two optional fields for
Chat Completions providers, which A3 sets for the co-op: `liveModels: { include?, exclude? }` (OpenAI's `/v1/models`
also lists embeddings, audio, image and Responses-only models) and `chatCompletions: { reasoningEffort? }`.

**Adapter** (`src/main/chatCompletions.ts`, new, no new dependency: `fetch` + a small SSE reader):
- *Out:* `system` → a `system` message; user text; an assistant message's `text` blocks → `content`, its `tool_use`
  blocks → `tool_calls` (`type: 'function'`, `arguments` = the JSON of `input`), `thinking` blocks dropped (Anthropic
  only); each `role: 'tool'` message → `{ role: 'tool', tool_call_id, content }` (a `tool_result` block inside a user
  message, which the renderer doesn't send today, becomes the same). Tools → `{ type: 'function', function: { name,
  description, parameters } }`. Body: `model`, `messages`, `stream: true`, `tools` when any, `max_completion_tokens`
  when the request sets `maxTokens`, `reasoning_effort` when the provider sets one.
- *Back:* `delta.content` → text; `delta.reasoning_content` (some LiteLLM upstreams) → cumulative reasoning;
  `delta.tool_calls[]` accumulated by `index` (id and name arrive first, `arguments` in pieces, calls may
  interleave), a start callback once a call's id and name are known; at `[DONE]` or the end of the body, the calls in
  index order with their arguments parsed (empty → `{}`; malformed → `{ _unparsedArguments }`, so the tool's own
  validation answers the model rather than the turn dying). An `error` object in the stream or a non-2xx response
  throws with the server's message and status.
- `listModels(baseURL, key, filter)` for the key test and the model list.

**`ipc.ts`:** `llm:stream` and `llm:chat` take a `chat-completions` branch ahead of the Anthropic code (A1's `never`
guards then narrow to Anthropic, so a third transport still fails to compile); `settings:testApiKey` and
`llm:fetchModels` gain the `chat-completions` case (`GET /models`, no tokens spent). **Anthropic-only, and saying
so:** `emoji:generate` (Claude Haiku) always uses the Anthropic key whatever the chat provider, and the Settings switch
is enabled only when an Anthropic key is saved; reMarkable OCR already reads the Anthropic key.

**Renderer (minimal; the picker and per-provider model lists are A4, #1242):** the Provider select lists the
providers; changing provider clears the fetched model list (it belongs to the previous provider) and the dialog
refetches for the new one.

## Tests

- vitest `src/main/chatCompletions.test.ts`: messages and tools out; text across chunks with SSE lines split
  mid-line; one tool call split across chunks; two interleaved calls; a stream that ends with tool calls
  (`finish_reason: tool_calls`, then `[DONE]`); no `[DONE]`; reasoning; a mid-stream error; malformed arguments;
  a non-2xx response; the model filter.
- `providers.test.ts`, `llmKeys.test.ts`: the OpenAI entry and its separate key.
- e2e `e2e/electron.openai-provider.spec.ts` (port 9244), with `fetch` stubbed in main for `api.openai.com` (CI never
  calls OpenAI): Settings selects OpenAI, a typed key tests valid and saves, and the model list shows only chat
  models; a chat turn streams text with the right request (URL, bearer, system message, function tools); a
  `suggest_edit` tool loop whose call arrives split across chunks leaves a suggestion in the document and sends the
  tool result back as a `tool` message. Falsified on a build of A1's head.
- Live smoke (later, the operator's budget-capped key through the keychain prompt): the QA block's live checks.
- Baselines (A1 head, after a build): `typecheck:renderer` 66, `tsc -p tsconfig.node.json` 19, `typecheck:e2e` 6.
