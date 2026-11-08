// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChatCompletionsError,
  ChatStreamAccumulator,
  buildChatBody,
  probeChatQuota,
  listChatModels,
  parseArguments,
  streamChatCompletion,
  toChatMessages,
  toChatTools,
} from './chatCompletions'
import { PROVIDERS } from '../shared/llm/providers'
import type { LLMMessage } from '../renderer/types'

/** An SSE `data:` line for one chunk. */
const sse = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })

function stubFetch(parts: string[], init: { status?: number; json?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', async (url: string, reqInit: RequestInit) => {
    calls.push({ url, init: reqInit })
    if (init.json !== undefined || (init.status && init.status >= 400)) {
      return new Response(JSON.stringify(init.json ?? {}), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } })
    }
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p))
        c.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('out: Prose messages and tools as Chat Completions (#1241)', () => {
  it('system first; assistant text + tool_use → content + tool_calls; thinking dropped; tool results as tool messages', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Tighten the intro.' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret', signature: 'sig' },
          { type: 'text', text: 'Reading it first.' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_document', input: {} },
          { type: 'tool_use', id: 'toolu_2', name: 'suggest_edit', input: { nodeId: 'n1', content: 'New.' } },
        ],
      },
      { role: 'tool', content: '{"nodes":[]}', tool_call_id: 'toolu_1' },
      { role: 'tool', content: 'Suggested.', tool_call_id: 'toolu_2' },
      { role: 'assistant', content: 'Done.' },
    ]
    expect(toChatMessages('Be brief.', messages)).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Tighten the intro.' },
      {
        role: 'assistant',
        content: 'Reading it first.',
        tool_calls: [
          { id: 'toolu_1', type: 'function', function: { name: 'read_document', arguments: '{}' } },
          { id: 'toolu_2', type: 'function', function: { name: 'suggest_edit', arguments: '{"nodeId":"n1","content":"New."}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: '{"nodes":[]}' },
      { role: 'tool', tool_call_id: 'toolu_2', content: 'Suggested.' },
      { role: 'assistant', content: 'Done.' },
    ])
  })

  it('an assistant turn that is only tool calls has null content; an empty system is omitted', () => {
    const out = toChatMessages('', [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'get_outline', input: undefined }] }])
    expect(out).toEqual([{ role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'get_outline', arguments: '{}' } }] }])
  })

  it("Anthropic-shaped tool_result blocks in a user message become tool messages ahead of the user's text", () => {
    const out = toChatMessages('', [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: 'ok' }, { type: 'text', text: 'And now?' }] },
    ])
    expect(out).toEqual([
      { role: 'tool', tool_call_id: 't9', content: 'ok' },
      { role: 'user', content: 'And now?' },
    ])
  })

  it('tools become functions; the body carries tools, max_completion_tokens and reasoning_effort only when set', () => {
    const tools = [{ name: 'read_document', description: 'Read it', input_schema: { type: 'object', properties: {} } }]
    expect(toChatTools(tools)).toEqual([
      { type: 'function', function: { name: 'read_document', description: 'Read it', parameters: { type: 'object', properties: {} } } },
    ])
    const plain = buildChatBody({ model: 'gpt-5', system: 's', messages: [{ role: 'user', content: 'hi' }] })
    expect(plain).toEqual({ model: 'gpt-5', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }], stream: true })
    const full = buildChatBody({ model: 'm', system: '', messages: [], tools, maxTokens: 4000, reasoningEffort: 'none' })
    expect(full.tools).toHaveLength(1)
    expect(full.max_completion_tokens).toBe(4000)
    expect(full.reasoning_effort).toBe('none')
    expect(buildChatBody({ model: 'm', system: '', messages: [], tools: [] })).not.toHaveProperty('tools')
  })
})

describe('back: the SSE stream as text, reasoning and tool calls (#1241)', () => {
  it('text across chunks, with SSE lines split mid-line', () => {
    const texts: string[] = []
    const acc = new ChatStreamAccumulator({ onText: (t) => texts.push(t) })
    const stream = sse(delta({ role: 'assistant', content: 'Hel' })) + sse(delta({ content: 'lo' })) + sse(delta({}, 'stop')) + 'data: [DONE]\n\n'
    for (let i = 0; i < stream.length; i += 7) acc.push(stream.slice(i, i + 7))
    expect(acc.finish()).toEqual({ content: 'Hello', toolCalls: [] })
    expect(texts).toEqual(['Hel', 'lo'])
    expect(acc.finishReason).toBe('stop')
  })

  it('one tool call split across chunks: start once with id and name, arguments joined', () => {
    const starts: Array<[string, string]> = []
    const acc = new ChatStreamAccumulator({ onToolCallStart: (id, name) => starts.push([id, name]) })
    acc.push(sse(delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'suggest_edit', arguments: '' } }] })))
    acc.push(sse(delta({ tool_calls: [{ index: 0, function: { arguments: '{"nodeId":"n1",' } }] })))
    acc.push(sse(delta({ tool_calls: [{ index: 0, function: { arguments: '"content":"The quick' } }] })))
    acc.push(sse(delta({ tool_calls: [{ index: 0, function: { arguments: ' brown fox."}' } }] })))
    acc.push(sse(delta({}, 'tool_calls')) + 'data: [DONE]\n\n')
    expect(starts).toEqual([['call_a', 'suggest_edit']])
    expect(acc.finish()).toEqual({
      content: '',
      toolCalls: [{ id: 'call_a', name: 'suggest_edit', args: { nodeId: 'n1', content: 'The quick brown fox.' } }],
    })
    expect(acc.finishReason).toBe('tool_calls')
  })

  it('two interleaved calls come back in index order; text before them is kept', () => {
    const acc = new ChatStreamAccumulator()
    acc.push(sse(delta({ content: 'Two things.' })))
    acc.push(sse(delta({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'get_outline', arguments: '{' } }] })))
    acc.push(sse(delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_document', arguments: '{}' } }] })))
    acc.push(sse(delta({ tool_calls: [{ index: 1, function: { arguments: '}' } }] })))
    acc.push(sse(delta({}, 'tool_calls')))
    const { content, toolCalls } = acc.finish()
    expect(content).toBe('Two things.')
    expect(toolCalls.map((c) => [c.id, c.name, c.args])).toEqual([
      ['c1', 'read_document', {}],
      ['c2', 'get_outline', {}],
    ])
  })

  it('a stream that ends without [DONE] still finishes, including a last line with no newline', () => {
    const acc = new ChatStreamAccumulator()
    acc.push(sse(delta({ content: 'Partial' })))
    acc.push(`data: ${JSON.stringify(delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'read_document', arguments: '{}' } }] }, 'tool_calls'))}`)
    expect(acc.finish().toolCalls).toEqual([{ id: 'c', name: 'read_document', args: {} }])
  })

  it('the first name wins: a repeat, or a different name on the same index, is ignored', () => {
    const acc = new ChatStreamAccumulator()
    acc.push(sse(delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'read_document', arguments: '{' } }] })))
    acc.push(sse(delta({ tool_calls: [{ index: 0, function: { name: 'read_document', arguments: '' } }] })))
    acc.push(sse(delta({ tool_calls: [{ index: 0, function: { name: 'get_outline', arguments: '}' } }] })))
    expect(acc.finish().toolCalls).toEqual([{ id: 'c', name: 'read_document', args: {} }])
  })

  it('reasoning is reported cumulatively; usage chunks and comments are ignored', () => {
    const snaps: string[] = []
    const acc = new ChatStreamAccumulator({ onReasoning: (s) => snaps.push(s) })
    acc.push(': keep-alive\n\n')
    acc.push(sse(delta({ reasoning_content: 'Think' })) + sse(delta({ reasoning_content: 'ing.' })))
    acc.push(sse({ choices: [], usage: { total_tokens: 5 } }))
    acc.push(sse(delta({ content: 'Answer.' })))
    expect(snaps).toEqual(['Think', 'Thinking.'])
    expect(acc.finish().content).toBe('Answer.')
  })

  it('an error object in the stream throws with its message', () => {
    const acc = new ChatStreamAccumulator()
    expect(() => acc.push(sse({ error: { message: 'Budget exceeded', code: 429 } }))).toThrow('Budget exceeded')
  })

  it('malformed or empty arguments reach the tool loop instead of failing the turn', () => {
    expect(parseArguments('')).toEqual({})
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 })
    expect(parseArguments('{"a":')).toEqual({ _unparsedArguments: '{"a":' })
  })
})

describe('calls (#1241)', () => {
  it('streamChatCompletion posts the body with the bearer key and reads the stream', async () => {
    const calls = stubFetch([sse(delta({ content: 'Hi' })), sse(delta({}, 'stop')), 'data: [DONE]\n\n'])
    const body = buildChatBody({ model: 'gpt-5', system: 'sys', messages: [{ role: 'user', content: 'hello' }] })
    const result = await streamChatCompletion({ baseURL: 'https://api.openai.com/v1/', apiKey: 'sk-test' }, body)
    expect(result).toEqual({ content: 'Hi', toolCalls: [], finishReason: 'stop' })
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(calls[0].init.body as string)).toEqual(body)
  })

  it("a non-2xx response carries the provider's code and type (#1268)", async () => {
    stubFetch([], { status: 429, json: { error: { message: 'You have no credits remaining.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } } })
    const error = await streamChatCompletion({ baseURL: 'https://api.openai.com/v1', apiKey: 'k' }, buildChatBody({ model: 'm', system: '', messages: [] })).catch((e) => e)
    expect(error).toBeInstanceOf(ChatCompletionsError)
    expect(error).toMatchObject({ status: 429, code: 'insufficient_quota', type: 'insufficient_quota', message: 'HTTP 429: You have no credits remaining.' })
  })

  it('an error object in the stream carries its code and type', () => {
    const acc = new ChatStreamAccumulator()
    let thrown: unknown
    try {
      acc.push(sse({ error: { message: 'Budget has been exceeded!', type: 'budget_exceeded', code: '400' } }))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toMatchObject({ code: '400', type: 'budget_exceeded', message: 'Budget has been exceeded!' })
  })

  it('probeChatQuota reports only a quota answer', async () => {
    stubFetch([], { status: 429, json: { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } } })
    expect(await probeChatQuota({ baseURL: 'https://api.openai.com/v1', apiKey: 'k' }, 'gpt-5-mini')).toBeInstanceOf(ChatCompletionsError)
    stubFetch([], { status: 400, json: { error: { message: 'max_completion_tokens is too small', type: 'invalid_request_error', code: null } } })
    expect(await probeChatQuota({ baseURL: 'https://api.openai.com/v1', apiKey: 'k' }, 'gpt-5-mini')).toBeNull()
    stubFetch([], { json: { id: 'x', choices: [] } })
    expect(await probeChatQuota({ baseURL: 'https://api.openai.com/v1', apiKey: 'k' }, 'gpt-5-mini')).toBeNull()
  })

  it('a non-2xx response throws the provider message with its status', async () => {
    stubFetch([], { status: 401, json: { error: { message: 'Incorrect API key provided' } } })
    await expect(
      streamChatCompletion({ baseURL: 'https://api.openai.com/v1', apiKey: 'bad' }, buildChatBody({ model: 'm', system: '', messages: [] }))
    ).rejects.toThrow('HTTP 401: Incorrect API key provided')
  })

  it("listChatModels keeps OpenAI's chat models only", async () => {
    stubFetch([], {
      json: {
        data: ['gpt-5', 'gpt-5-mini', 'o4-mini', 'text-embedding-3-small', 'whisper-1', 'gpt-4o-audio-preview', 'gpt-5-codex', 'dall-e-3', 'gpt-realtime', 'gpt-5-pro'].map((id) => ({ id })),
      },
    })
    const ids = await listChatModels({ baseURL: PROVIDERS.openai.baseURL, apiKey: 'k' }, PROVIDERS.openai.liveModels)
    expect(ids).toEqual(['gpt-5', 'gpt-5-mini', 'o4-mini'])
  })
})
