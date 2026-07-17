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

// Cost ceilings: the proxy spends the OPERATOR's key, so callers pick only
// from this menu. Widening it is a deliberate config change, not a client one.
const ALLOWED_MODELS = new Set(['claude-sonnet-4-5', 'claude-haiku-4-5-20251001'])
const DEFAULT_MODEL = 'claude-sonnet-4-5'
const MAX_TOKENS_CAP = 4096
// Input-side ceilings — output caps alone don't bound spend; input tokens bill too.
const MAX_SYSTEM_CHARS = 8_000
const MAX_MESSAGES = 40
const MAX_TOTAL_CONTENT_CHARS = 200_000

/** Total characters across a message's content (string or text blocks). */
function contentLength(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    return content.reduce(
      (n, block) => n + (typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text.length
        : 0),
      0
    )
  }
  return 0
}

/** Message content must be a string or Anthropic-style text blocks. */
function isValidContent(content: unknown): boolean {
  if (typeof content === 'string') return true
  return (
    Array.isArray(content) &&
    content.every(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        typeof (block as { type?: unknown }).type === 'string' &&
        typeof (block as { text?: unknown }).text === 'string'
    )
  )
}

export const llmRoutes = new Hono<AppEnv>()

llmRoutes.post('/stream', async (c) => {
  let body: StreamRequestBody
  try {
    body = await c.req.json<StreamRequestBody>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const model = body.model ?? DEFAULT_MODEL
  if (!ALLOWED_MODELS.has(model)) {
    return c.json({ error: 'model_not_allowed', allowed: [...ALLOWED_MODELS] }, 400)
  }
  const maxTokens = Math.min(body.maxTokens ?? 1024, MAX_TOKENS_CAP)
  const messages = body.messages?.length
    ? body.messages
    : [{ role: 'user', content: 'Say hello in one sentence.' }]
  if (!messages.every((m) => typeof m?.role === 'string' && isValidContent(m.content))) {
    return c.json({ error: 'invalid_messages' }, 400)
  }
  if ((body.system?.length ?? 0) > MAX_SYSTEM_CHARS) {
    return c.json({ error: 'system_too_long', max: MAX_SYSTEM_CHARS }, 400)
  }
  if (messages.length > MAX_MESSAGES) {
    return c.json({ error: 'too_many_messages', max: MAX_MESSAGES }, 400)
  }
  const totalChars = messages.reduce((n, m) => n + contentLength(m.content), 0)
  if (totalChars > MAX_TOTAL_CONTENT_CHARS) {
    return c.json({ error: 'messages_too_long', max: MAX_TOTAL_CONTENT_CHARS }, 400)
  }

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
      // Upstream error bodies can leak provider internals — log full, send generic.
      const errText = await upstreamRes.text().catch(() => '')
      console.error(`[llm] upstream ${upstreamRes.status}: ${errText}`)
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          error: { message: 'upstream_error', status: upstreamRes.status },
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
        if (done) {
          decoder.decode() // flush; a trailing partial block is never a complete SSE event
          break
        }
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
