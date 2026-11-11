/**
 * The Chat Completions adapter (#1241): one way for main to talk to OpenAI and
 * to OpenAI-compatible gateways (Inference Coop's LiteLLM, #956).
 *
 * Prose's chat loop speaks Anthropic's message shape (content blocks with
 * `tool_use`, one `role: 'tool'` message per tool result) and listens for the
 * `llm:stream:*` events the Anthropic path sends. This module translates both
 * ways so `useChat` and the tool loop never learn which API answered:
 *
 * - out: `toChatMessages` / `toChatTools` / `buildChatBody`
 * - back: `ChatStreamAccumulator` turns the SSE stream into text, cumulative
 *   reasoning, tool-call starts, and the finished tool calls
 *
 * No SDK: `fetch` and a small SSE reader. The key arrives from `llmKeys.ts`
 * and goes only into the Authorization header.
 */
import type { LLMContentBlock, LLMMessage, LLMToolDefinition } from '../renderer/types'
import { classifyLlmError } from '../shared/llm/errors'

// ---------------------------------------------------------------------------
// Wire types (the subset Prose sends and reads)
// ---------------------------------------------------------------------------

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatBody {
  model: string
  messages: ChatMessage[]
  stream: true
  tools?: ChatTool[]
  max_completion_tokens?: number
  reasoning_effort?: string
}

/** A finished tool call, in the shape the renderer's tool loop takes. */
export interface ToolCallResult {
  id: string
  name: string
  args: unknown
}

// ---------------------------------------------------------------------------
// Out
// ---------------------------------------------------------------------------

function textOf(content: string | LLMContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is Extract<LLMContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
}

/**
 * Prose's messages as Chat Completions messages. Thinking blocks are
 * Anthropic's and are dropped; tool results become `tool` messages, which must
 * directly follow the assistant message whose `tool_calls` they answer.
 */
export function toChatMessages(system: string, messages: LLMMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'tool') {
      // The tool loop always sets it; without one the model can't match the
      // result to its call, so make a regression visible.
      if (!m.tool_call_id) console.error('[chatCompletions] A tool result has no tool_call_id')
      out.push({ role: 'tool', tool_call_id: m.tool_call_id ?? '', content: textOf(m.content) })
      continue
    }
    if (m.role === 'assistant') {
      const toolCalls: ChatToolCall[] = []
      if (typeof m.content !== 'string') {
        for (const b of m.content) {
          if (b.type === 'tool_use') {
            toolCalls.push({
              id: b.id,
              type: 'function',
              function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
            })
          }
        }
      }
      const text = textOf(m.content)
      out.push(
        toolCalls.length > 0
          ? { role: 'assistant', content: text || null, tool_calls: toolCalls }
          : { role: 'assistant', content: text }
      )
      continue
    }
    // user: tool_result blocks (Anthropic's shape) first, as tool messages, then the text
    if (typeof m.content !== 'string') {
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content })
      }
      const text = textOf(m.content)
      if (text) out.push({ role: 'user', content: text })
      continue
    }
    out.push({ role: 'user', content: m.content })
  }
  return out
}

export function toChatTools(tools: LLMToolDefinition[]): ChatTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

export function buildChatBody(opts: {
  model: string
  system: string
  messages: LLMMessage[]
  tools?: LLMToolDefinition[]
  maxTokens?: number
  reasoningEffort?: string
}): ChatBody {
  return {
    model: opts.model,
    messages: toChatMessages(opts.system, opts.messages),
    stream: true,
    ...(opts.tools && opts.tools.length > 0 ? { tools: toChatTools(opts.tools) } : {}),
    ...(opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}),
    ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
  }
}

// ---------------------------------------------------------------------------
// Back
// ---------------------------------------------------------------------------

/**
 * A provider error, with the provider's `code` and `type` when its body had
 * them (OpenAI: `insufficient_quota`, `rate_limit_exceeded`; LiteLLM:
 * `budget_exceeded`), so `classifyLlmError` (#1268) reads them rather than
 * guessing from the status.
 */
export class ChatCompletionsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly type?: string
  ) {
    super(message)
    this.name = 'ChatCompletionsError'
  }
}

type ErrorBody = { error?: { message?: string; type?: string; code?: string | number } | string; message?: string }

/** The provider's message, code and type from an error body. */
function errorParts(json: ErrorBody): { message?: string; code?: string; type?: string } {
  if (typeof json.error === 'string') return { message: json.error }
  const e = json.error
  return {
    message: e?.message || json.message,
    code: e?.code !== undefined && e?.code !== null ? String(e.code) : undefined,
    type: e?.type || undefined,
  }
}

export interface ChatStreamHandlers {
  onText?: (delta: string) => void
  /** Cumulative, like the Anthropic path's thinking snapshot. */
  onReasoning?: (snapshot: string) => void
  /** Once per call, when its id and name are known and before its arguments finish. */
  onToolCallStart?: (id: string, name: string) => void
}

interface PendingCall {
  id: string
  name: string
  args: string
  started: boolean
}

/**
 * Feed it the response body's text as it arrives; it parses the SSE lines
 * (a line may be split across reads) and reports through the handlers.
 * `finish()` returns the text and the tool calls in index order.
 */
export class ChatStreamAccumulator {
  private buffer = ''
  private content = ''
  private reasoning = ''
  private calls = new Map<number, PendingCall>()
  private done = false
  finishReason: string | null = null

  constructor(private readonly handlers: ChatStreamHandlers = {}) {}

  push(text: string): void {
    if (this.done) return
    this.buffer += text
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.line(line)
      if (this.done) return
    }
  }

  private line(line: string): void {
    if (!line.startsWith('data:')) return // comments, event: lines, blank separators
    const payload = line.slice(5).trim()
    if (!payload) return
    if (payload === '[DONE]') {
      this.done = true
      return
    }
    let chunk: {
      error?: { message?: string; code?: string | number; type?: string } | string
      choices?: Array<{
        delta?: {
          content?: string | null
          reasoning_content?: string | null
          reasoning?: string | null
          tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
        }
        finish_reason?: string | null
      }>
    }
    try {
      chunk = JSON.parse(payload)
    } catch {
      return // a keep-alive or a line this reader doesn't know; the stream goes on
    }
    if (chunk.error) {
      const parts = errorParts(chunk as ErrorBody)
      throw new ChatCompletionsError(parts.message || 'The provider returned an error', undefined, parts.code, parts.type)
    }
    const choice = chunk.choices?.[0]
    if (!choice) return // e.g. the usage chunk
    const delta = choice.delta ?? {}
    if (delta.content) {
      this.content += delta.content
      this.handlers.onText?.(delta.content)
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (reasoning) {
      this.reasoning += reasoning
      this.handlers.onReasoning?.(this.reasoning)
    }
    for (const tc of delta.tool_calls ?? []) {
      const index = tc.index ?? 0
      let call = this.calls.get(index)
      if (!call) {
        call = { id: '', name: '', args: '', started: false }
        this.calls.set(index, call)
      }
      if (tc.id && !call.id) call.id = tc.id
      // The name arrives once; some gateways repeat it in later chunks. The
      // first one wins, so a repeat (or a gateway bug sending another name for
      // the same index) can't corrupt the call.
      const name = tc.function?.name
      if (name && !call.name) call.name = name
      if (tc.function?.arguments) call.args += tc.function.arguments
      if (!call.started && call.id && call.name) {
        call.started = true
        this.handlers.onToolCallStart?.(call.id, call.name)
      }
    }
    if (choice.finish_reason) this.finishReason = choice.finish_reason
  }

  finish(): { content: string; toolCalls: ToolCallResult[] } {
    if (!this.done && this.buffer) this.line(this.buffer.replace(/\r$/, ''))
    this.buffer = ''
    this.done = true
    const toolCalls = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => c.name)
      .map(([index, c]) => {
        const id = c.id || `call_${index}_${Date.now().toString(36)}`
        if (!c.started) this.handlers.onToolCallStart?.(id, c.name)
        return { id, name: c.name, args: parseArguments(c.args) }
      })
    return { content: this.content, toolCalls }
  }
}

/**
 * A call's arguments. Empty is `{}`; malformed JSON (a truncated stream, a
 * model's mistake) is passed as `{ _unparsedArguments }`, so the tool's own
 * validation answers the model and it can retry, instead of the turn failing.
 */
export function parseArguments(raw: string): unknown {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { _unparsedArguments: raw }
  }
}

async function errorFromResponse(res: Response): Promise<ChatCompletionsError> {
  let detail = res.statusText
  let code: string | undefined
  let type: string | undefined
  try {
    const text = await res.text()
    try {
      const parts = errorParts(JSON.parse(text) as ErrorBody)
      detail = parts.message || text || detail
      code = parts.code
      type = parts.type
    } catch {
      detail = text || detail
    }
  } catch { /* body unreadable */ }
  return new ChatCompletionsError(`HTTP ${res.status}: ${detail}`, res.status, code, type)
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface ChatTarget {
  baseURL: string
  apiKey: string
}

/**
 * Models that refuse function tools unless reasoning is off, learned from the
 * provider's own refusal (keyed by base URL and model, for this launch). Newer
 * OpenAI models (gpt-5.5, gpt-6) take tools on Chat Completions only with
 * `reasoning_effort: "none"`, whatever effort is sent or defaulted; which
 * models do is not derivable from the id, so the provider's answer decides.
 */
const toolsNeedNoReasoning = new Set<string>()

/** For tests: forget what the refusals taught. */
export function resetToolsNeedNoReasoning(): void {
  toolsNeedNoReasoning.clear()
}

function refusesToolsWithReasoning(error: ChatCompletionsError): boolean {
  return error.status === 400 && /reasoning_effort/.test(error.message) && /\bnone\b/.test(error.message)
}

/** Stream one Chat Completions request; resolves when the stream ends. */
export async function streamChatCompletion(
  target: ChatTarget,
  body: ChatBody,
  handlers: ChatStreamHandlers = {},
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCallResult[]; finishReason: string | null }> {
  const hasTools = !!body.tools && body.tools.length > 0
  const key = `${target.baseURL}|${body.model}`
  const post = (sent: ChatBody) =>
    fetch(`${target.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify(sent),
      signal,
    })
  const withoutReasoning: ChatBody = { ...body, reasoning_effort: 'none' }
  let res = await post(hasTools && toolsNeedNoReasoning.has(key) ? withoutReasoning : body)
  if (!res.ok) {
    const error = await errorFromResponse(res)
    // Nothing has streamed yet, so the one retry is invisible to the caller.
    if (!hasTools || body.reasoning_effort === 'none' || toolsNeedNoReasoning.has(key) || !refusesToolsWithReasoning(error)) throw error
    toolsNeedNoReasoning.add(key)
    res = await post(withoutReasoning)
    if (!res.ok) throw await errorFromResponse(res)
  }
  if (!res.body) throw new ChatCompletionsError('The provider returned an empty response')

  const acc = new ChatStreamAccumulator(handlers)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    acc.push(decoder.decode(value, { stream: true }))
  }
  acc.push(decoder.decode())
  const { content, toolCalls } = acc.finish()
  return { content, toolCalls, finishReason: acc.finishReason }
}

/**
 * Whether the account behind a key has run out of credits (#1268). Listing
 * models works on an empty account, so the key test also sends the smallest
 * completion (a fixed "Hi", never the writer's text); only a quota answer
 * counts (resolves with that error). Anything else, success or failure,
 * resolves null: `/models` already proved the key.
 */
export async function probeChatQuota(target: ChatTarget, model: string): Promise<ChatCompletionsError | null> {
  try {
    const res = await fetch(`${target.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_completion_tokens: 16 }),
    })
    if (res.ok) {
      await res.body?.cancel()
      return null
    }
    const error = await errorFromResponse(res)
    return classifyLlmError(error).kind === 'quota' ? error : null
  } catch {
    return null
  }
}

/**
 * The provider's model ids (`GET /models`), filtered to chat models. Doubles as
 * the key test: it spends no tokens, and a bad key answers 401.
 */
export async function listChatModels(
  target: ChatTarget,
  filter?: { include?: RegExp; exclude?: RegExp }
): Promise<string[]> {
  const res = await fetch(`${target.baseURL.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${target.apiKey}` },
  })
  if (!res.ok) throw await errorFromResponse(res)
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> }
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => (!filter?.include || filter.include.test(id)) && !(filter?.exclude && filter.exclude.test(id)))
    .sort()
}
