/**
 * A stub for the Inference Coop gateway (#956), in the Electron main process.
 *
 * The same idea as ./openai-stub: `fetch` is replaced for
 * https://gateway.inference.coop/ only, each request is recorded, `/models`
 * answers with `models`, and each streamed `/chat/completions` request takes
 * the next step: SSE chunks, or a JSON error. A request that isn't streamed is
 * the key test's credits probe.
 */
import type { ElectronApplication } from '@playwright/test'
import type { OpenAIRequest, OpenAIStep } from './openai-stub'

export const COOP_GATEWAY = 'https://gateway.inference.coop/v1'

/** What the gateway lists: chat models beside the speech, image and embedding ones. */
export const COOP_MODELS = [
  'greenpt/deepseek-v4.1-flash',
  'greenpt/glm-5.3',
  'greenpt/glm-5.3-flash',
  'tinfoil/deepseek-v4-1-flash',
  'tinfoil/glm-5.3',
  'tinfoil/nomic-embed-text',
  'tinfoil/whisper-large-v3-turbo',
  'regolo/qwen-image',
]

export async function stubCoop(
  app: ElectronApplication,
  steps: OpenAIStep[] = [],
  options: { probe?: { status: number; json: unknown } } = {}
): Promise<void> {
  await app.evaluate((_electron, { steps, models, probe }) => {
    const g = globalThis as any
    g.__coop = { requests: [] as unknown[], steps, n: 0 }
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const previous = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url
      if (!url.startsWith('https://gateway.inference.coop/')) return previous(input, init)
      const headers = new Headers(init?.headers)
      const request = init?.body ? JSON.parse(init.body) : null
      g.__coop.requests.push({ url, auth: headers.get('authorization'), body: request })
      if (url.endsWith('/models')) return json(200, { object: 'list', data: models.map((id: string) => ({ id, object: 'model' })) })
      if (request?.stream !== true) {
        return probe ? json(probe.status, probe.json) : json(200, { id: 'probe', choices: [{ message: { role: 'assistant', content: 'Hi' } }] })
      }
      const step = g.__coop.steps[g.__coop.n++] ?? ['data: [DONE]\n\n']
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
  }, { steps, models: COOP_MODELS, probe: options.probe })
}

export const coopRequests = (app: ElectronApplication): Promise<OpenAIRequest[]> =>
  app.evaluate(() => (globalThis as any).__coop.requests as OpenAIRequest[])
