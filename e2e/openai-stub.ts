/**
 * A stubbed OpenAI for e2e (#1241, #1242): `fetch` in the Electron main
 * process is wrapped so https://api.openai.com/ never leaves the machine. The
 * Chat Completions adapter calls the global `fetch` at request time, so the
 * stub sees every request; each is recorded for the spec to check.
 *
 * `/models` answers with `models`; each streamed `/chat/completions` request
 * takes the next scripted step: a list of SSE payloads sent as separate body
 * chunks, or an HTTP error. A non-streamed request (the key test's credits
 * probe, #1268) takes `probe` instead (a plain 200 by default) and consumes no
 * step.
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
        return probe ? json(probe.status, probe.json) : json(200, { id: 'probe', object: 'chat.completion', choices: [] })
      }
      const step = g.__oai.steps[g.__oai.n++] ?? ['data: [DONE]\n\n']
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
