// @vitest-environment node
/** The Responses adapter (#1301): Prose's messages and tools out, the SSE events back, and what refusals teach. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ReasoningLessons,
  ReplayMemory,
  ResponsesStreamAccumulator,
  buildResponsesBody,
  probeResponsesQuota,
  resetResponsesLessons,
  streamResponse,
  toResponsesInput,
  toResponsesTools,
  type RawOutputItem,
  type ResponsesBody,
  type ResponsesRequest,
} from './responses'
import { ChatCompletionsError } from './chatCompletions'
import { classifyLlmError } from '../shared/llm/errors'
import { PROVIDERS } from '../shared/llm/providers'
import type { LLMMessage } from '../renderer/types'

/** One SSE event, as the API frames it. */
const sse = (event: Record<string, unknown>) => `event: ${event.type as string}\ndata: ${JSON.stringify(event)}\n\n`
const textDelta = (delta: string) => sse({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta })
const completed = (output: RawOutputItem[] = []) => sse({ type: 'response.completed', response: { status: 'completed', output } })

const REASONING: RawOutputItem = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Look first.' }], encrypted_content: 'gAAA…' }
const CALL: RawOutputItem = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_document', arguments: '{}', status: 'completed' }
const tools = [{ name: 'read_document', description: 'Read it', input_schema: { type: 'object' as const, properties: {} } }]

const target = { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' }
const request = (over: Partial<ResponsesRequest> = {}): ResponsesRequest => ({
  model: 'gpt-6-sol',
  system: 'Be brief.',
  messages: [{ role: 'user', content: 'hello' }],
  tools,
  maxTokens: 16000,
  thinking: true,
  reasons: true,
  offEffort: 'none',
  ...over,
})

/** A fetch that answers each request with `answer(body, n)`: SSE text, or an error to send as HTTP 400. */
function stubFetch(answer: (body: ResponsesBody, n: number) => string | { status: number; json: unknown }) {
  const sent: ResponsesBody[] = []
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as ResponsesBody
    sent.push(body)
    calls.push({ url, init })
    const a = answer(body, sent.length)
    if (typeof a !== 'string') return new Response(JSON.stringify(a.json), { status: a.status, headers: { 'content-type': 'application/json' } })
    return new Response(a, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
  return { sent, calls }
}
const refusal = (message: string, param?: string) => ({ status: 400, json: { error: { message, type: 'invalid_request_error', param: param ?? null, code: 'unsupported_value' } } })

beforeEach(() => resetResponsesLessons())
afterEach(() => vi.unstubAllGlobals())

describe('out: Prose messages and tools as a Responses request', () => {
  it('user and assistant text are messages; the system prompt is `instructions`, not an item', () => {
    const body = buildResponsesBody({ model: 'gpt-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] })
    expect(body).toEqual({
      model: 'gpt-5',
      input: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
      stream: true,
      store: false,
      instructions: 'sys',
    })
  })

  it('a tool round is rebuilt as text, one function_call per tool use, and a function_call_output per result', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Tighten it.' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'sig' },
          { type: 'text', text: 'Reading.' },
          { type: 'tool_use', id: 'call_1', name: 'read_document', input: {} },
          { type: 'tool_use', id: 'call_2', name: 'suggest_edit', input: { nodeId: 'n1' } },
        ],
      } as LLMMessage,
      { role: 'tool', tool_call_id: 'call_1', content: 'The text.' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: 'ok' }, { type: 'text', text: 'And now?' }] },
    ]
    expect(toResponsesInput(messages)).toEqual([
      { role: 'user', content: 'Tighten it.' },
      { role: 'assistant', content: 'Reading.' },
      { type: 'function_call', call_id: 'call_1', name: 'read_document', arguments: '{}' },
      { type: 'function_call', call_id: 'call_2', name: 'suggest_edit', arguments: '{"nodeId":"n1"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'The text.' },
      { type: 'function_call_output', call_id: 'call_2', output: 'ok' },
      { role: 'user', content: 'And now?' },
    ])
  })

  it('tools are flat function tools, never strict; reasoning, its summary and the limit appear only when set', () => {
    expect(toResponsesTools(tools)).toEqual([{ type: 'function', name: 'read_document', description: 'Read it', parameters: { type: 'object', properties: {} }, strict: false }])
    const plain = buildResponsesBody({ model: 'gpt-4.1', system: '', messages: [], tools: [] })
    expect(plain).toEqual({ model: 'gpt-4.1', input: [], stream: true, store: false })
    const full = buildResponsesBody({ model: 'm', system: '', messages: [], tools, maxTokens: 4000, effort: 'medium', summary: true })
    expect(full.tools).toHaveLength(1)
    expect(full.max_output_tokens).toBe(4000)
    expect(full.reasoning).toEqual({ effort: 'medium', summary: 'auto' })
    expect(full.include).toEqual(['reasoning.encrypted_content'])
    expect(buildResponsesBody({ model: 'm', system: '', messages: [], effort: 'none' }).reasoning).toEqual({ effort: 'none' })
  })
})

describe('back: the SSE events as text, a reasoning summary and tool calls', () => {
  it('text across events, with SSE lines split mid-line', () => {
    const texts: string[] = []
    const acc = new ResponsesStreamAccumulator({ onText: (t) => texts.push(t) })
    const stream = sse({ type: 'response.created', response: {} }) + textDelta('Hel') + textDelta('lo') + completed()
    for (let i = 0; i < stream.length; i += 7) acc.push(stream.slice(i, i + 7))
    expect(acc.finish()).toMatchObject({ content: 'Hello', toolCalls: [] })
    expect(texts).toEqual(['Hel', 'lo'])
    expect(acc.finishReason).toBe('completed')
  })

  it('a tool call: started once with its call_id and name, arguments from the deltas and the finished item', () => {
    const starts: Array<[string, string]> = []
    const acc = new ResponsesStreamAccumulator({ onToolCallStart: (id, name) => starts.push([id, name]) })
    acc.push(sse({ type: 'response.output_item.added', output_index: 0, item: REASONING }))
    acc.push(sse({ type: 'response.output_item.done', output_index: 0, item: REASONING }))
    acc.push(sse({ type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_9', call_id: 'call_9', name: 'suggest_edit', arguments: '' } }))
    acc.push(sse({ type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_9', delta: '{"nodeId":' }))
    acc.push(sse({ type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_9', delta: '"n1"}' }))
    const done = { type: 'function_call', id: 'fc_9', call_id: 'call_9', name: 'suggest_edit', arguments: '{"nodeId":"n1"}', status: 'completed' }
    acc.push(sse({ type: 'response.output_item.done', output_index: 1, item: done }))
    acc.push(completed())
    expect(starts).toEqual([['call_9', 'suggest_edit']])
    const result = acc.finish()
    expect(result.toolCalls).toEqual([{ id: 'call_9', name: 'suggest_edit', args: { nodeId: 'n1' } }])
    // The provider's items, as sent and in order, for the round's replay.
    expect(result.output).toEqual([REASONING, done])
  })

  it('a stream cut before the call finished still yields the call, its broken arguments left for the tool to answer', () => {
    const acc = new ResponsesStreamAccumulator()
    acc.push(sse({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call_x', name: 'suggest_edit', arguments: '' } }))
    acc.push(sse({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"nodeId":"n' }))
    expect(acc.finish().toolCalls).toEqual([{ id: 'call_x', name: 'suggest_edit', args: { _unparsedArguments: '{"nodeId":"n' } }])
  })

  it('the reasoning summary arrives as a growing snapshot, its parts as paragraphs', () => {
    const snapshots: string[] = []
    const acc = new ResponsesStreamAccumulator({ onReasoning: (s) => snapshots.push(s) })
    acc.push(sse({ type: 'response.reasoning_summary_part.added', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: '' } }))
    acc.push(sse({ type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'Read ' }))
    acc.push(sse({ type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'first.' }))
    acc.push(sse({ type: 'response.reasoning_summary_part.added', output_index: 0, summary_index: 1, part: { type: 'summary_text', text: '' } }))
    acc.push(sse({ type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 1, delta: 'Then edit.' }))
    expect(snapshots).toEqual(['Read ', 'Read first.', 'Read first.\n\nThen edit.'])
  })

  it('a response cut short by the limit ends with what it has and says why', () => {
    const acc = new ResponsesStreamAccumulator()
    acc.push(textDelta('Partial'))
    acc.push(sse({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } }))
    expect(acc.finish().content).toBe('Partial')
    expect(acc.finishReason).toBe('max_output_tokens')
  })

  it('a stream with only the final event still yields its text and calls', () => {
    const acc = new ResponsesStreamAccumulator()
    acc.push(completed([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Whole.' }] }, CALL]))
    expect(acc.finish()).toMatchObject({ content: 'Whole.', toolCalls: [{ id: 'call_1', name: 'read_document', args: {} }] })
  })

  it('an error event and a failed response throw with the provider’s code, which classifies', () => {
    const thrown = (stream: string) => {
      try {
        new ResponsesStreamAccumulator().push(stream)
      } catch (e) {
        return e
      }
    }
    const quota = thrown(sse({ type: 'error', code: 'insufficient_quota', message: 'You exceeded your current quota.', param: null }))
    expect(quota).toBeInstanceOf(ChatCompletionsError)
    expect(classifyLlmError(quota).kind).toBe('quota')
    const limited = thrown(sse({ type: 'response.failed', response: { status: 'failed', error: { code: 'rate_limit_exceeded', message: 'Slow down.' } } }))
    expect(classifyLlmError(limited).kind).toBe('rate_limit')
    const server = thrown(sse({ type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'Something went wrong.' } } }))
    expect(classifyLlmError(server).kind).toBe('transient')
  })
})

describe('the tool rounds main keeps, to give reasoning back with its calls', () => {
  it('a kept round goes back verbatim, in order, in place of the rebuilt one', () => {
    const memory = new ReplayMemory()
    const message: RawOutputItem = { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Reading.' }] }
    memory.remember('k', [REASONING, message, CALL])
    const assistant: LLMMessage = { role: 'assistant', content: [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 'call_1', name: 'read_document', input: {} }] }
    const input = toResponsesInput([assistant, { role: 'tool', tool_call_id: 'call_1', content: 'The text.' }], memory.recall('k'))
    expect(input).toEqual([REASONING, message, CALL, { type: 'function_call_output', call_id: 'call_1', output: 'The text.' }])
  })

  it('another model’s round, a round with other calls, or one with no reasoning is rebuilt instead', () => {
    const memory = new ReplayMemory()
    memory.remember('k', [REASONING, CALL])
    const assistant = (ids: string[]): LLMMessage => ({ role: 'assistant', content: ids.map((id) => ({ type: 'tool_use' as const, id, name: 'read_document', input: {} })) })
    const rebuilt = [{ type: 'function_call', call_id: 'call_1', name: 'read_document', arguments: '{}' }]
    expect(toResponsesInput([assistant(['call_1'])], memory.recall('other-model'))).toEqual(rebuilt)
    expect(toResponsesInput([assistant(['call_1', 'call_2'])], memory.recall('k'))).toHaveLength(2)
    expect(toResponsesInput([assistant(['call_1', 'call_2'])], memory.recall('k')).every((i) => (i as RawOutputItem).type === 'function_call' && !('id' in i))).toBe(true)
    // No reasoning item: nothing to give back, so nothing is kept.
    const plain = new ReplayMemory()
    plain.remember('k', [CALL])
    expect(toResponsesInput([assistant(['call_1'])], plain.recall('k'))).toEqual(rebuilt)
  })
})

describe('calls: one request, and what a refusal teaches', () => {
  it('posts to /responses with the bearer key; thinking on asks for medium reasoning, its summary and room for it', async () => {
    const { sent, calls } = stubFetch(() => textDelta('Hi') + completed())
    const result = await streamResponse(target, request())
    expect(result).toEqual({ content: 'Hi', toolCalls: [], finishReason: 'completed' })
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(sent[0]).toMatchObject({ model: 'gpt-6-sol', stream: true, store: false, instructions: 'Be brief.', reasoning: { effort: 'medium', summary: 'auto' }, max_output_tokens: 32000 })
    expect(sent[0].tools?.[0]).toMatchObject({ type: 'function', name: 'read_document' })
  })

  it('thinking off sends the provider’s lowest guess, no summary; a model that doesn’t reason gets no reasoning and the plain limit', async () => {
    const { sent } = stubFetch(() => completed())
    await streamResponse(target, request({ thinking: false }))
    expect(sent[0].reasoning).toEqual({ effort: 'none' })
    expect(sent[0].max_output_tokens).toBe(16000)
    await streamResponse(target, request({ model: 'gpt-5', thinking: false, offEffort: PROVIDERS.openai.responses!.offEffort('gpt-5') }))
    expect(sent[1].reasoning).toEqual({ effort: 'minimal' })
    expect(sent[1].max_output_tokens).toBe(24000)
    await streamResponse(target, request({ model: 'gpt-4.1', reasons: false }))
    expect(sent[2]).not.toHaveProperty('reasoning')
    expect(sent[2]).not.toHaveProperty('include')
    expect(sent[2].max_output_tokens).toBe(16000)
  })

  it('a model that refuses "none" is asked again with the lowest effort it lists, and that way from then on', async () => {
    const message = "Unsupported value: 'reasoning.effort' does not support 'none' with this model. Supported values are: 'low', 'medium', 'high', and 'xhigh'."
    const { sent } = stubFetch((body) => (body.reasoning?.effort === 'none' ? refusal(message, 'reasoning.effort') : textDelta('ok') + completed()))
    expect((await streamResponse(target, request({ thinking: false }))).content).toBe('ok')
    expect(sent.map((b) => b.reasoning?.effort)).toEqual(['none', 'low'])
    await streamResponse(target, request({ thinking: false }))
    expect(sent.map((b) => b.reasoning?.effort)).toEqual(['none', 'low', 'low'])
    // Thinking on was never refused: it keeps its own effort. Another model starts from its own guess.
    await streamResponse(target, request({ thinking: true }))
    expect(sent.at(-1)!.reasoning?.effort).toBe('medium')
    await streamResponse(target, request({ model: 'gpt-6-astra', thinking: false }))
    expect(sent.at(-2)!.reasoning?.effort).toBe('none')
    expect(sent.at(-1)!.reasoning?.effort).toBe('low')
  })

  it('a model that takes no reasoning setting is asked again without one', async () => {
    const { sent } = stubFetch((body) => (body.reasoning ? refusal("Unsupported parameter: 'reasoning.effort' is not supported with this model.", 'reasoning.effort') : textDelta('ok') + completed()))
    expect((await streamResponse(target, request({ model: 'gpt-5-chat-latest' }))).content).toBe('ok')
    expect(sent.map((b) => !!b.reasoning)).toEqual([true, false])
    expect(sent[1].max_output_tokens).toBe(16000)
    await streamResponse(target, request({ model: 'gpt-5-chat-latest' }))
    expect(sent).toHaveLength(3)
  })

  it('an organization that can’t have summaries gets reasoning without them', async () => {
    const { sent } = stubFetch((body) =>
      body.reasoning?.summary ? refusal('Your organization must be verified to generate reasoning summaries.', 'reasoning.summary') : textDelta('ok') + completed()
    )
    await streamResponse(target, request())
    expect(sent.map((b) => b.reasoning)).toEqual([{ effort: 'medium', summary: 'auto' }, { effort: 'medium' }])
    await streamResponse(target, request({ model: 'gpt-5' }))
    expect(sent.at(-1)!.reasoning).toEqual({ effort: 'medium' })
  })

  it('a tool round’s reasoning goes back with the next request; if the API refuses the kept items, the round is rebuilt', async () => {
    const round = sse({ type: 'response.output_item.done', output_index: 0, item: REASONING }) + sse({ type: 'response.output_item.done', output_index: 1, item: CALL }) + completed()
    let refuseKept = false
    const { sent } = stubFetch((body, n) => {
      if (n === 1) return round
      if (refuseKept && body.input.some((i) => (i as RawOutputItem).type === 'reasoning')) return refusal("Item 'rs_1' of type 'reasoning' was provided without its required following item.")
      return textDelta('Done.') + completed()
    })
    const first = await streamResponse(target, request())
    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'read_document', args: {} }])
    const next = request({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'read_document', input: {} }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'The text.' },
      ],
    })
    await streamResponse(target, next)
    expect(sent[1].input).toEqual([{ role: 'user', content: 'hello' }, REASONING, CALL, { type: 'function_call_output', call_id: 'call_1', output: 'The text.' }])

    refuseKept = true
    expect((await streamResponse(target, next)).content).toBe('Done.')
    expect(sent.at(-1)!.input).toEqual([
      { role: 'user', content: 'hello' },
      { type: 'function_call', call_id: 'call_1', name: 'read_document', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'The text.' },
    ])
  })

  it('any other failure is thrown as it is, with the provider’s code, and is not retried', async () => {
    const { sent } = stubFetch(() => ({ status: 429, json: { error: { message: 'You have no credits remaining.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } } }))
    const error = await streamResponse(target, request()).catch((e) => e)
    expect(error).toBeInstanceOf(ChatCompletionsError)
    expect(error).toMatchObject({ status: 429, code: 'insufficient_quota', message: 'HTTP 429: You have no credits remaining.' })
    expect(classifyLlmError(error).kind).toBe('quota')
    expect(sent).toHaveLength(1)
  })

  it('a refusal that teaches nothing new is thrown rather than sent a third time', async () => {
    const message = "Unsupported value: 'reasoning.effort' does not support 'low' with this model. Supported values are: 'low'."
    const { sent } = stubFetch(() => refusal(message, 'reasoning.effort'))
    const error = await streamResponse(target, request({ thinking: false })).catch((e) => e)
    expect(error).toBeInstanceOf(ChatCompletionsError)
    // none → low (the one listed) → the same refusal again: stop.
    expect(sent.map((b) => b.reasoning?.effort)).toEqual(['none', 'low'])
  })

  it('lessons: thinking on picks a real effort from the list; a non-400 teaches nothing', () => {
    const lessons = new ReasoningLessons()
    const body = buildResponsesBody({ model: 'm', system: '', messages: [], effort: 'medium', summary: true })
    const sent = { key: 'k', baseURL: 'b', thinking: true, body, replayed: false }
    expect(lessons.learn(new ChatCompletionsError('HTTP 500: reasoning.effort', 500), sent)).toBeNull()
    const error = new ChatCompletionsError("HTTP 400: 'reasoning.effort' does not support 'medium' with this model. Supported values are: 'none', 'high', and 'xhigh'.", 400)
    expect(lessons.learn(error, sent)).toBe('effort')
    expect(lessons.effort('k', true, 'medium')).toBe('high')
    expect(lessons.effort('k', false, 'none')).toBe('none')
  })

  it('the credits probe asks /responses for the smallest answer and reports only a quota refusal', async () => {
    const { sent, calls } = stubFetch(() => ({ status: 429, json: { error: { message: 'Quota exceeded', type: 'insufficient_quota', code: 'insufficient_quota' } } }))
    expect(await probeResponsesQuota(target, 'gpt-5-mini')).toMatchObject({ code: 'insufficient_quota' })
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses')
    expect(sent[0]).toEqual({ model: 'gpt-5-mini', input: 'Hi', max_output_tokens: 16, store: false })
    stubFetch(() => ({ status: 500, json: {} }))
    expect(await probeResponsesQuota(target, 'gpt-5-mini')).toBeNull()
  })
})
