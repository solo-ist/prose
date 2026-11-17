/**
 * The Responses adapter (#1301): how main talks to OpenAI.
 *
 * OpenAI's newer models take function tools together with reasoning only on
 * the Responses API (`POST /responses`); on Chat Completions some refuse the
 * pair outright. This module is the Responses twin of `chatCompletions.ts`:
 * Prose's chat loop speaks Anthropic's message shape and listens for the
 * `llm:stream:*` events, and this translates both ways so `useChat` and the
 * tool loop never learn which API answered.
 *
 * - out: `toResponsesInput` / `toResponsesTools` / `buildResponsesBody`
 * - back: `ResponsesStreamAccumulator` turns the SSE events into text, a
 *   cumulative reasoning summary, tool-call starts and the finished calls
 * - `streamResponse` sends one request and learns, from the provider's own
 *   refusals, which reasoning settings a model accepts
 *
 * Stateless: every request sets `store: false` and carries the whole
 * conversation. A reasoning model's reasoning items must go back with its tool
 * calls, so main keeps each tool round's output items for this launch
 * (`ReplayMemory`) and sends them back verbatim; the renderer never sees them.
 *
 * No SDK: `fetch` and a small SSE reader. The key arrives from `llmKeys.ts`
 * and goes only into the Authorization header.
 */
import type { LLMContentBlock, LLMMessage, LLMToolDefinition } from '../renderer/types'
import { classifyLlmError } from '../shared/llm/errors'
import {
  ChatCompletionsError,
  parseArguments,
  type ChatStreamHandlers,
  type ChatTarget,
  type ToolCallResult,
} from './chatCompletions'

// ---------------------------------------------------------------------------
// Wire types (the subset Prose sends and reads)
// ---------------------------------------------------------------------------

/** An output item exactly as the provider sent it (a reasoning item, a message, a function call). */
export type RawOutputItem = { type: string; [key: string]: unknown }

export type ResponsesInputItem =
  | { role: 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | RawOutputItem

export interface ResponsesTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: false
}

export interface ResponsesBody {
  model: string
  input: ResponsesInputItem[]
  stream: true
  store: false
  instructions?: string
  tools?: ResponsesTool[]
  max_output_tokens?: number
  reasoning?: { effort: string; summary?: 'auto' }
  include?: string[]
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

/** The output items of an earlier tool round, by any of its call ids; undefined when not kept. */
export type Recall = (callIds: string[]) => RawOutputItem[] | undefined

/**
 * Prose's messages as Responses input items. Thinking blocks are Anthropic's
 * and are dropped. An assistant turn that called tools goes back as the
 * provider sent it when `recall` still has it (its reasoning items included,
 * in their original order); otherwise it is rebuilt as its text and one
 * `function_call` per tool use. A tool result is a `function_call_output`.
 */
export function toResponsesInput(messages: LLMMessage[], recall?: Recall): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      // The tool loop always sets it; without one the model can't match the
      // result to its call, so make a regression visible.
      if (!m.tool_call_id) console.error('[responses] A tool result has no tool_call_id')
      out.push({ type: 'function_call_output', call_id: m.tool_call_id ?? '', output: textOf(m.content) })
      continue
    }
    if (m.role === 'assistant') {
      const uses = typeof m.content === 'string' ? [] : m.content.filter((b): b is Extract<LLMContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      const kept = uses.length > 0 ? recall?.(uses.map((u) => u.id)) : undefined
      if (kept) {
        out.push(...kept)
        continue
      }
      const text = textOf(m.content)
      if (text) out.push({ role: 'assistant', content: text })
      for (const u of uses) {
        out.push({ type: 'function_call', call_id: u.id, name: u.name, arguments: JSON.stringify(u.input ?? {}) })
      }
      continue
    }
    // user: tool_result blocks (Anthropic's shape) first, as outputs, then the text
    if (typeof m.content !== 'string') {
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ type: 'function_call_output', call_id: b.tool_use_id, output: b.content })
      }
      const text = textOf(m.content)
      if (text) out.push({ role: 'user', content: text })
      continue
    }
    out.push({ role: 'user', content: m.content })
  }
  return out
}

/**
 * `strict: false` on purpose: left out, the API tries to rewrite each schema
 * into strict mode (every property required), and Prose's tools have optional
 * arguments.
 */
export function toResponsesTools(tools: LLMToolDefinition[]): ResponsesTool[] {
  return tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema, strict: false }))
}

export function buildResponsesBody(opts: {
  model: string
  system: string
  messages: LLMMessage[]
  tools?: LLMToolDefinition[]
  maxTokens?: number
  /** The `reasoning.effort` to send; undefined sends no `reasoning` at all. */
  effort?: string
  /** Ask for the reasoning summary (the thought process the writer sees). */
  summary?: boolean
  recall?: Recall
}): ResponsesBody {
  return {
    model: opts.model,
    input: toResponsesInput(opts.messages, opts.recall),
    stream: true,
    store: false,
    ...(opts.system ? { instructions: opts.system } : {}),
    ...(opts.tools && opts.tools.length > 0 ? { tools: toResponsesTools(opts.tools) } : {}),
    ...(opts.maxTokens ? { max_output_tokens: opts.maxTokens } : {}),
    ...(opts.effort
      ? {
          reasoning: { effort: opts.effort, ...(opts.summary ? { summary: 'auto' as const } : {}) },
          // Stateless responses carry it by default; named for older deployments.
          include: ['reasoning.encrypted_content'],
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// Back
// ---------------------------------------------------------------------------

interface PendingCall {
  id: string
  name: string
  args: string
  started: boolean
}

type StreamEvent = {
  type?: string
  delta?: string
  output_index?: number
  summary_index?: number
  item?: RawOutputItem
  message?: string
  code?: string | null
  param?: string | null
  response?: {
    status?: string
    output?: RawOutputItem[]
    error?: { code?: string; message?: string } | null
    incomplete_details?: { reason?: string } | null
  }
}

/**
 * Feed it the response body's text as it arrives; it parses the SSE lines
 * (a line may be split across reads) and reports through the handlers.
 * `finish()` returns the text, the tool calls in output order and the output
 * items as the provider sent them.
 */
export class ResponsesStreamAccumulator {
  private buffer = ''
  private content = ''
  private reasoning = ''
  private calls = new Map<number, PendingCall>()
  private items = new Map<number, RawOutputItem>()
  private done = false
  /** `completed`, or why the response stopped short (`max_output_tokens`, …). */
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
    if (!line.startsWith('data:')) return // event: lines repeat the type the data carries
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let event: StreamEvent
    try {
      event = JSON.parse(payload)
    } catch {
      return // a keep-alive or a line this reader doesn't know; the stream goes on
    }
    const index = event.output_index ?? 0
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        if (event.delta) {
          this.content += event.delta
          this.handlers.onText?.(event.delta)
        }
        break
      case 'response.reasoning_summary_part.added':
        // A summary comes in parts; they read as paragraphs.
        if (this.reasoning) this.reasoning += '\n\n'
        break
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (event.delta) {
          this.reasoning += event.delta
          this.handlers.onReasoning?.(this.reasoning)
        }
        break
      case 'response.output_item.added':
        if (event.item?.type === 'function_call') this.call(index, event.item)
        break
      case 'response.function_call_arguments.delta': {
        const call = this.calls.get(index)
        if (call && event.delta) call.args += event.delta
        break
      }
      case 'response.output_item.done':
        if (!event.item) break
        this.items.set(index, event.item)
        if (event.item.type === 'function_call') {
          // The finished item's arguments are whole, whatever the deltas were.
          const call = this.call(index, event.item)
          if (typeof event.item.arguments === 'string') call.args = event.item.arguments
        }
        break
      case 'response.completed':
      case 'response.incomplete':
        this.finishReason = event.type === 'response.completed' ? 'completed' : event.response?.incomplete_details?.reason ?? 'incomplete'
        // A stream that skipped the per-item events still ends with the whole output.
        if (this.items.size === 0) this.adopt(event.response?.output ?? [])
        this.done = true
        break
      case 'response.failed': {
        const error = event.response?.error
        throw new ChatCompletionsError(error?.message || 'The provider returned an error', error?.code === 'server_error' ? 500 : undefined, error?.code ?? undefined)
      }
      case 'error':
        throw new ChatCompletionsError(event.message || 'The provider returned an error', undefined, event.code ?? undefined, undefined, event.param ?? undefined)
    }
  }

  private call(index: number, item: RawOutputItem): PendingCall {
    let call = this.calls.get(index)
    if (!call) {
      call = { id: '', name: '', args: '', started: false }
      this.calls.set(index, call)
    }
    // `call_id` is what the tool's output answers; the item's own `id` is not.
    if (!call.id && typeof item.call_id === 'string') call.id = item.call_id
    if (!call.name && typeof item.name === 'string') call.name = item.name
    if (!call.started && call.id && call.name) {
      call.started = true
      this.handlers.onToolCallStart?.(call.id, call.name)
    }
    return call
  }

  private adopt(output: RawOutputItem[]): void {
    output.forEach((item, index) => {
      this.items.set(index, item)
      if (item.type === 'function_call') {
        const call = this.call(index, item)
        if (typeof item.arguments === 'string') call.args = item.arguments
      }
      if (item.type === 'message' && !this.content && Array.isArray(item.content)) {
        for (const part of item.content as Array<{ type?: string; text?: string }>) {
          if (part.type === 'output_text' && part.text) {
            this.content += part.text
            this.handlers.onText?.(part.text)
          }
        }
      }
    })
  }

  finish(): { content: string; toolCalls: ToolCallResult[]; output: RawOutputItem[] } {
    if (!this.done && this.buffer) this.line(this.buffer.replace(/\r$/, ''))
    this.buffer = ''
    this.done = true
    const inOrder = <T>(map: Map<number, T>) => [...map.entries()].sort(([a], [b]) => a - b)
    const toolCalls = inOrder(this.calls)
      .filter(([, c]) => c.name)
      .map(([index, c]) => {
        const id = c.id || `call_${index}_${Date.now().toString(36)}`
        if (!c.started) this.handlers.onToolCallStart?.(id, c.name)
        return { id, name: c.name, args: parseArguments(c.args) }
      })
    return { content: this.content, toolCalls, output: inOrder(this.items).map(([, item]) => item) }
  }
}

type ErrorBody = { error?: { message?: string; type?: string; code?: string | number | null; param?: string | null } | string; message?: string }

async function errorFromResponse(res: Response): Promise<ChatCompletionsError> {
  let detail = res.statusText
  let code: string | undefined
  let type: string | undefined
  let param: string | undefined
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text) as ErrorBody
      if (typeof json.error === 'string') {
        detail = json.error
      } else {
        detail = json.error?.message || json.message || text || detail
        code = json.error?.code !== undefined && json.error?.code !== null ? String(json.error.code) : undefined
        type = json.error?.type || undefined
        param = json.error?.param || undefined
      }
    } catch {
      detail = text || detail
    }
  } catch { /* body unreadable */ }
  return new ChatCompletionsError(`HTTP ${res.status}: ${detail}`, res.status, code, type, param)
}

// ---------------------------------------------------------------------------
// What a tool round sent, kept to send back
// ---------------------------------------------------------------------------

const REPLAY_LIMIT = 200

/**
 * The output items of the tool rounds answered in this launch, by call id and
 * by the model that produced them. A reasoning model's reasoning items must
 * return with its tool calls; the renderer's messages don't carry them, so
 * main does. Nothing is written to disk: after a relaunch (or for a turn
 * another model answered) the round is rebuilt from the message instead,
 * which the API also accepts.
 */
export class ReplayMemory {
  private groups = new Map<string, { key: string; items: RawOutputItem[]; callIds: string[] }>()

  remember(key: string, output: RawOutputItem[]): void {
    const callIds = output.filter((i) => i.type === 'function_call' && typeof i.call_id === 'string').map((i) => i.call_id as string)
    // Worth keeping only when there is reasoning to give back with the calls.
    if (callIds.length === 0 || !output.some((i) => i.type === 'reasoning')) return
    const items = output.filter((i) => i.type === 'reasoning' || i.type === 'message' || i.type === 'function_call')
    for (const id of callIds) {
      this.groups.delete(id)
      this.groups.set(id, { key, items, callIds })
    }
    while (this.groups.size > REPLAY_LIMIT) this.groups.delete(this.groups.keys().next().value as string)
  }

  /** The kept round, only if it is this model's and has exactly these calls. */
  recall(key: string): Recall {
    return (callIds) => {
      const group = this.groups.get(callIds[0])
      if (!group || group.key !== key) return undefined
      if (group.callIds.length !== callIds.length || !callIds.every((id) => group.callIds.includes(id))) return undefined
      return group.items
    }
  }

  clear(): void {
    this.groups.clear()
  }
}

// ---------------------------------------------------------------------------
// Reasoning settings, learned from the provider
// ---------------------------------------------------------------------------

/** Thinking off wants the least reasoning a model accepts; thinking on wants a real effort. */
const EFFORTS_OFF = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const EFFORTS_ON = ['medium', 'low', 'high', 'minimal', 'xhigh', 'max', 'none']

/**
 * What the provider's refusals taught, for this launch. Which efforts a model
 * takes is not in its id ("none" is the lowest for one, refused by the next),
 * so the first guess comes from the provider's hints and the refusal, which
 * lists what the model does take, corrects it.
 */
export class ReasoningLessons {
  /** By `key|on` or `key|off`: the effort to send, or null to send no `reasoning`. */
  private efforts = new Map<string, string | null>()
  private noSummary = new Set<string>()
  readonly replay = new ReplayMemory()

  effort(key: string, thinking: boolean, guess: string | undefined): string | undefined {
    const learned = this.efforts.get(`${key}|${thinking ? 'on' : 'off'}`)
    return learned === undefined ? guess : learned ?? undefined
  }

  summary(baseURL: string): boolean {
    return !this.noSummary.has(baseURL)
  }

  reset(): void {
    this.efforts.clear()
    this.noSummary.clear()
    this.replay.clear()
  }

  /**
   * Take a lesson from a refused request. Returns what changed, or null when
   * the refusal is about something else (or teaches nothing new), in which
   * case the error is the caller's to throw.
   */
  learn(error: ChatCompletionsError, sent: { key: string; baseURL: string; thinking: boolean; body: ResponsesBody; replayed: boolean }): 'summary' | 'effort' | 'replay' | null {
    if (error.status !== 400) return null
    const message = error.message
    const param = error.param ?? ''
    const reasoning = sent.body.reasoning
    // Reasoning summaries can need a verified organization.
    if (reasoning?.summary && (param === 'reasoning.summary' || /reasoning[._]summary|reasoning summar/i.test(message))) {
      this.noSummary.add(sent.baseURL)
      return 'summary'
    }
    if (reasoning && (/^reasoning(\.effort)?$/.test(param) || /reasoning[._]effort|unsupported parameter: '?reasoning/i.test(message))) {
      const slot = `${sent.key}|${sent.thinking ? 'on' : 'off'}`
      const listed = /supported values are:?\s*(.*)$/is.exec(message)?.[1].match(/'([a-z]+)'/g)?.map((v) => v.slice(1, -1)) ?? []
      // No list: the model takes no reasoning setting at all.
      const next = listed.length > 0 ? (sent.thinking ? EFFORTS_ON : EFFORTS_OFF).find((e) => listed.includes(e)) ?? listed[0] : null
      if (next === reasoning.effort) return null
      this.efforts.set(slot, next)
      return 'effort'
    }
    // Kept items the API no longer takes back: rebuild the rounds from the messages.
    if (sent.replayed && /\brs_|encrypted_content|reasoning item|type 'reasoning'/i.test(message)) {
      this.replay.clear()
      return 'replay'
    }
    return null
  }
}

const lessons = new ReasoningLessons()

/** For tests: forget what the refusals taught and the kept tool rounds. */
export function resetResponsesLessons(): void {
  lessons.reset()
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface ResponsesRequest {
  model: string
  system: string
  messages: LLMMessage[]
  tools?: LLMToolDefinition[]
  maxTokens?: number
  /** The writer's thinking toggle: on asks for real reasoning and its summary; off for the least the model accepts. */
  thinking: boolean
  /** The provider's first guesses (`ProviderInfo.responses`). */
  reasons: boolean
  offEffort: string
}

/** Room in `max_output_tokens` for the reasoning, which counts against it. */
const HEADROOM_ON = 16000
const HEADROOM_OFF = 8000
/** Each refusal teaches one thing (the effort, the summary, the kept rounds), so three sends at most. */
const MAX_SENDS = 3

function bodyFor(target: ChatTarget, request: ResponsesRequest, replay: boolean): { body: ResponsesBody; replayed: boolean } {
  const key = `${target.baseURL}|${request.model}`
  const guess = request.reasons ? (request.thinking ? 'medium' : request.offEffort) : undefined
  const effort = lessons.effort(key, request.thinking, guess)
  const reasons = !!effort && effort !== 'none'
  let replayed = false
  const recall: Recall | undefined = replay
    ? (ids) => {
        const kept = lessons.replay.recall(key)(ids)
        if (kept) replayed = true
        return kept
      }
    : undefined
  const body = buildResponsesBody({
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    maxTokens: request.maxTokens ? request.maxTokens + (reasons ? (request.thinking ? HEADROOM_ON : HEADROOM_OFF) : 0) : undefined,
    effort,
    summary: reasons && request.thinking && lessons.summary(target.baseURL),
    recall,
  })
  return { body, replayed }
}

/**
 * Stream one Responses request; resolves when the stream ends. A request the
 * provider refuses over a reasoning setting is sent again with what the
 * refusal taught, before anything has streamed, so the caller never sees it.
 */
export async function streamResponse(
  target: ChatTarget,
  request: ResponsesRequest,
  handlers: ChatStreamHandlers = {},
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCallResult[]; finishReason: string | null }> {
  const key = `${target.baseURL}|${request.model}`
  let res: Response | undefined
  let replay = true
  for (let send = 1; ; send++) {
    const { body, replayed } = bodyFor(target, request, replay)
    res = await fetch(`${target.baseURL.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
    if (res.ok) break
    const error = await errorFromResponse(res)
    const lesson = send < MAX_SENDS ? lessons.learn(error, { key, baseURL: target.baseURL, thinking: request.thinking, body, replayed }) : null
    if (!lesson) throw error
    if (lesson === 'replay') replay = false
  }
  if (!res.body) throw new ChatCompletionsError('The provider returned an empty response')

  const acc = new ResponsesStreamAccumulator(handlers)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    acc.push(decoder.decode(value, { stream: true }))
  }
  acc.push(decoder.decode())
  const { content, toolCalls, output } = acc.finish()
  lessons.replay.remember(key, output)
  return { content, toolCalls, finishReason: acc.finishReason }
}

/**
 * Whether the account behind a key has run out of credits (#1268), asked the
 * Responses way: the smallest request (a fixed "Hi", never the writer's
 * text). Only a quota answer counts (resolves with that error); anything
 * else, success or failure, resolves null: `/models` already proved the key.
 */
export async function probeResponsesQuota(target: ChatTarget, model: string): Promise<ChatCompletionsError | null> {
  try {
    const res = await fetch(`${target.baseURL.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify({ model, input: 'Hi', max_output_tokens: 16, store: false }),
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
