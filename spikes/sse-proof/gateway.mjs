/**
 * gateway.mjs — Hono SSE-proxy spike
 *
 * Stands up a minimal Hono + @hono/node-server gateway that:
 *   1. Accepts POST /api/llm/stream
 *   2. Opens an upstream Anthropic (or mock) SSE connection
 *   3. Relays every SSE frame to the browser client verbatim via streamSSE
 *   4. Propagates client-disconnect → upstream AbortController
 *
 * Config via env:
 *   UPSTREAM_URL    upstream base URL (default: http://localhost:4001)
 *   GATEWAY_PORT    port to listen on (default: 4000)
 *   ANTHROPIC_API_KEY  if set AND UPSTREAM_URL is not overridden, calls real Anthropic
 *
 * Usage:
 *   node gateway.mjs
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { cors } from 'hono/cors'

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT ?? '4000', 10)

// If ANTHROPIC_API_KEY is set, use real Anthropic; otherwise the mock upstream
const USE_REAL_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY
const UPSTREAM_BASE = process.env.UPSTREAM_URL ??
  (USE_REAL_ANTHROPIC ? 'https://api.anthropic.com' : 'http://localhost:4001')

console.log(`[gateway] Upstream: ${UPSTREAM_BASE} (real=${USE_REAL_ANTHROPIC})`)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw SSE line buffer into { event, data } frames.
 * Anthropic sends `event: <type>\ndata: <json>\n\n` blocks.
 */
function* parseSSEChunk(rawText) {
  const blocks = rawText.split('\n\n')
  for (const block of blocks) {
    if (!block.trim()) continue
    const lines = block.split('\n')
    let eventType = 'message'
    let dataLine = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice('event: '.length).trim()
      } else if (line.startsWith('data: ')) {
        dataLine = line.slice('data: '.length)
      }
    }
    if (dataLine) {
      yield { event: eventType, data: dataLine }
    }
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono()

// CORS — allow localhost origins (mirrors §5 security posture: no wildcard in prod)
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return null // non-browser / curl
      if (
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1')
      ) {
        return origin
      }
      return null // reject unknown origins
    },
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-stream-id'],
    exposeHeaders: ['Content-Type']
  })
)

// Health check
app.get('/health', (c) => c.json({ ok: true, upstream: UPSTREAM_BASE }))

// ---------------------------------------------------------------------------
// POST /api/llm/stream
//
// Body (JSON):
//   { streamId, model, system, messages, maxTokens? }
//
// Relays upstream SSE → client SSE.
// Events forwarded verbatim:  message_start, content_block_start, ping,
//   content_block_delta, content_block_stop, message_delta, message_stop, error
// ---------------------------------------------------------------------------

app.post('/api/llm/stream', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const {
    streamId = 'stream_' + Date.now(),
    model = 'claude-sonnet-4-5',
    system = '',
    messages = [],
    maxTokens = 1024
  } = body

  console.log(`[gateway] /api/llm/stream  streamId=${streamId}  model=${model}`)

  // AbortController — cancelled when the client disconnects
  const abortController = new AbortController()

  // Build upstream request
  const upstreamUrl = `${UPSTREAM_BASE}/v1/messages`
  const upstreamBody = JSON.stringify({
    model,
    max_tokens: maxTokens,
    stream: true,
    system,
    messages: messages.length > 0
      ? messages
      : [{ role: 'user', content: 'Say hello in one sentence.' }]
  })

  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    Accept: 'text/event-stream'
  }
  if (USE_REAL_ANTHROPIC) {
    headers['x-api-key'] = process.env.ANTHROPIC_API_KEY
  }

  // Return the SSE stream to the client
  return streamSSE(c, async (stream) => {
    // Detect client disconnect: hono/streaming exposes stream.close event
    stream.onAbort(() => {
      console.log(`[gateway] Client disconnected — aborting upstream  streamId=${streamId}`)
      abortController.abort()
    })

    let upstreamRes
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: upstreamBody,
        signal: abortController.signal
      })
    } catch (fetchErr) {
      if (abortController.signal.aborted) {
        console.log(`[gateway] Upstream fetch aborted  streamId=${streamId}`)
        return
      }
      console.error('[gateway] Upstream fetch error:', fetchErr.message)
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ type: 'error', error: { message: fetchErr.message } })
      })
      return
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text()
      console.error(`[gateway] Upstream HTTP ${upstreamRes.status}:`, errText)
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          error: { message: `Upstream error ${upstreamRes.status}: ${errText}` }
        })
      })
      return
    }

    console.log(`[gateway] Upstream connected  streamId=${streamId}  status=${upstreamRes.status}`)

    // Read the upstream SSE stream and forward each frame
    const reader = upstreamRes.body.getReader()
    const decoder = new TextDecoder()
    let leftover = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.log(`[gateway] Upstream stream ended  streamId=${streamId}`)
          break
        }

        // Decode chunk; carry over incomplete SSE blocks across read boundaries
        const text = leftover + decoder.decode(value, { stream: true })
        leftover = ''

        // Split on double-newline (SSE block separator)
        const parts = text.split('\n\n')
        // The last part may be an incomplete block
        leftover = parts.pop() ?? ''

        for (const block of parts) {
          if (!block.trim()) continue
          const lines = block.split('\n')
          let eventType = 'message'
          let dataLine = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice('event: '.length).trim()
            } else if (line.startsWith('data: ')) {
              dataLine = line.slice('data: '.length)
            }
          }
          if (!dataLine) continue

          // Log content_block_delta events for visibility
          if (eventType === 'content_block_delta') {
            try {
              const parsed = JSON.parse(dataLine)
              const token = parsed?.delta?.text ?? ''
              console.log(`[gateway] → relay ${eventType}: "${token}"`)
            } catch { /* ignore parse errors */ }
          } else {
            console.log(`[gateway] → relay ${eventType}`)
          }

          // Forward verbatim
          await stream.writeSSE({ event: eventType, data: dataLine })
        }
      }
    } catch (readErr) {
      if (abortController.signal.aborted) {
        console.log(`[gateway] Read loop aborted (client disconnect)  streamId=${streamId}`)
        return
      }
      console.error('[gateway] Stream read error:', readErr.message)
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ type: 'error', error: { message: readErr.message } })
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

serve({ fetch: app.fetch, port: GATEWAY_PORT }, () => {
  console.log(`[gateway] Listening on http://localhost:${GATEWAY_PORT}`)
  console.log(`[gateway] POST http://localhost:${GATEWAY_PORT}/api/llm/stream`)
})
