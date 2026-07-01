/**
 * routes/llm/stream.ts — POST /api/llm/stream. The gated LLM proxy.
 *
 * Relays Anthropic's SSE through Hono `streamSSE` verbatim (proven in spike
 * #775). Mounted behind requireSession + requireEntitlement('ai_proxy') in
 * app.ts, so the gate fires BEFORE this handler opens the upstream connection.
 *
 * Render buffers text/event-stream by default → we set `X-Accel-Buffering: no`
 * (+ no-cache, keep-alive) and flush immediately, or the stream only surfaces
 * once complete.
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { config, upstreamBase, useRealAnthropic } from '../../config.js'
import type { AppEnv } from '../../middleware/session.js'

interface StreamRequestBody {
  model?: string
  system?: string
  messages?: Array<{ role: string; content: unknown }>
  maxTokens?: number
}

export const llmRoutes = new Hono<AppEnv>()

llmRoutes.post('/stream', async (c) => {
  let body: StreamRequestBody
  try {
    body = await c.req.json<StreamRequestBody>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const model = body.model ?? 'claude-sonnet-4-5'
  const maxTokens = body.maxTokens ?? 1024
  const messages = body.messages?.length
    ? body.messages
    : [{ role: 'user', content: 'Say hello in one sentence.' }]

  // Defeat proxy buffering (Render) and flush headers immediately.
  c.header('X-Accel-Buffering', 'no')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  const abortController = new AbortController()
  const upstreamUrl = `${upstreamBase}/v1/messages`
  const upstreamBody = JSON.stringify({
    model,
    max_tokens: maxTokens,
    stream: true,
    system: body.system ?? '',
    messages,
  })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    Accept: 'text/event-stream',
  }
  if (useRealAnthropic) headers['x-api-key'] = config.ANTHROPIC_API_KEY as string

  return streamSSE(c, async (stream) => {
    // Client disconnect → abort the upstream Anthropic call (stops the meter).
    stream.onAbort(() => abortController.abort())

    let upstreamRes: Response
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: upstreamBody,
        signal: abortController.signal,
      })
    } catch (err) {
      if (abortController.signal.aborted) return
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ type: 'error', error: { message: (err as Error).message } }),
      })
      return
    }

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => '')
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          error: { message: `Upstream ${upstreamRes.status}: ${errText}` },
        }),
      })
      return
    }

    // Relay upstream SSE frames verbatim; carry incomplete blocks across reads.
    const reader = upstreamRes.body.getReader()
    const decoder = new TextDecoder()
    let leftover = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = leftover + decoder.decode(value, { stream: true })
        const parts = text.split('\n\n')
        leftover = parts.pop() ?? ''
        for (const block of parts) {
          if (!block.trim()) continue
          let eventType = 'message'
          let dataLine = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) dataLine = line.slice(6)
          }
          if (!dataLine) continue
          await stream.writeSSE({ event: eventType, data: dataLine })
        }
      }
    } catch (err) {
      if (abortController.signal.aborted) return
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ type: 'error', error: { message: (err as Error).message } }),
      })
    }
  })
})
