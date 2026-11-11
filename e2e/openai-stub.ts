/**
 * A stubbed OpenAI for e2e (#1241, #1242, #1301): `fetch` in the Electron main
 * process is wrapped so https://api.openai.com/ never leaves the machine. The
 * adapters call the global `fetch` at request time, so the stub sees every
 * request; each is recorded for the spec to check.
 *
 * `/models` answers with `models`; each streamed request (`/responses`, which
 * OpenAI speaks since #1301, or `/chat/completions`) takes the next scripted
 * step: a list of SSE payloads sent as separate body chunks, or an HTTP error.
 * A non-streamed request (the key test's credits probe, #1268) takes `probe`
 * instead (a plain 200 by default) and consumes no step.
 */
import type { ElectronApplication } from '@playwright/test'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** SSE payloads, or an HTTP error answer. */
export type OpenAIStep = string[] | { status: number; json: unknown }

export interface OpenAIRequest {
  url: string
  auth: string | null
  body: any
}

export const DEFAULT_OPENAI_MODELS = ['gpt-5', 'gpt-5-mini', 'text-embedding-3-small', 'whisper-1']

/** One SSE `data:` line for a Chat Completions chunk. */
export const sseChunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

/** One Responses API SSE event, framed as the API frames it. */
export const rsEvent = (event: Record<string, unknown>): string => `event: ${event.type as string}\ndata: ${JSON.stringify(event)}\n\n`

/** The end of a Responses stream. */
export const rsCompleted = (): string => rsEvent({ type: 'response.completed', response: { status: 'completed', output: [] } })

/** Text deltas, one per piece (no end: follow with `rsCompleted()`). */
export const rsText = (...pieces: string[]): string[] =>
  pieces.map((delta) => rsEvent({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta }))

/** A whole text answer. */
export const rsAnswer = (text: string): string[] => [...rsText(text), rsCompleted()]

/** A reasoning item at `index`: its summary streamed in pieces, then the finished item. */
export function rsReasoning(item: { id: string; summary: string[]; encrypted: string }, index = 0): string[] {
  return [
    rsEvent({ type: 'response.reasoning_summary_part.added', output_index: index, summary_index: 0, item_id: item.id, part: { type: 'summary_text', text: '' } }),
    ...item.summary.map((delta) => rsEvent({ type: 'response.reasoning_summary_text.delta', output_index: index, summary_index: 0, item_id: item.id, delta })),
    rsEvent({ type: 'response.output_item.done', output_index: index, item: rsReasoningItem(item) }),
  ]
}
export const rsReasoningItem = (item: { id: string; summary: string[]; encrypted: string }): Record<string, unknown> => ({
  type: 'reasoning',
  id: item.id,
  summary: [{ type: 'summary_text', text: item.summary.join('') }],
  encrypted_content: item.encrypted,
})

/** A function call at `index`: announced, its arguments in pieces, then the finished item. */
export function rsCall(call: { id: string; callId: string; name: string; args: string[] }, index = 0): string[] {
  return [
    rsEvent({ type: 'response.output_item.added', output_index: index, item: { type: 'function_call', id: call.id, call_id: call.callId, name: call.name, arguments: '' } }),
    ...call.args.map((delta) => rsEvent({ type: 'response.function_call_arguments.delta', output_index: index, item_id: call.id, delta })),
    rsEvent({ type: 'response.output_item.done', output_index: index, item: rsCallItem(call) }),
  ]
}
export const rsCallItem = (call: { id: string; callId: string; name: string; args: string[] }): Record<string, unknown> => ({
  type: 'function_call',
  id: call.id,
  call_id: call.callId,
  name: call.name,
  arguments: call.args.join(''),
  status: 'completed',
})

export async function stubOpenAI(
  app: ElectronApplication,
  steps: OpenAIStep[] = [],
  models: string[] = DEFAULT_OPENAI_MODELS,
  options: { probe?: { status: number; json: unknown } } = {}
): Promise<void> {
  await app.evaluate((_electron, { steps, models, probe }) => {
    const g = globalThis as any
    g.__oai = { requests: [] as unknown[], steps, n: 0 }
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const realFetch = g.__realFetch ?? globalThis.fetch
    g.__realFetch = realFetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url
      if (!url.startsWith('https://api.openai.com/')) return realFetch(input, init)
      const headers = new Headers(init?.headers)
      g.__oai.requests.push({ url, auth: headers.get('authorization'), body: init?.body ? JSON.parse(init.body) : null })
      if (url.endsWith('/models')) {
        const data = models.map((id: string) => ({ id, object: 'model' }))
        return new Response(JSON.stringify({ object: 'list', data }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const request = init?.body ? JSON.parse(init.body) : null
      if (request?.stream !== true) {
        return probe ? json(probe.status, probe.json) : json(200, { id: 'probe', object: 'response', status: 'completed', output: [] })
      }
      const step = g.__oai.steps[g.__oai.n++] ?? ['event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n']
      if (!Array.isArray(step)) return json(step.status, step.json)
      const parts: string[] = step
      const enc = new TextEncoder()
      const body = new ReadableStream({
        start(c) {
          for (const p of parts) c.enqueue(enc.encode(p))
          c.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
  }, { steps, models, probe: options.probe })
}

export const openAIRequests = (app: ElectronApplication): Promise<OpenAIRequest[]> =>
  app.evaluate(() => (globalThis as any).__oai.requests as OpenAIRequest[])
