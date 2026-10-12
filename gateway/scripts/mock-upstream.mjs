/**
 * mock-upstream.mjs
 *
 * A tiny Node HTTP server that emits Anthropic-shaped SSE events so the spike
 * can be run without an API key.
 *
 * Usage:  node mock-upstream.mjs [port=4001]
 *
 * Emits the canonical Anthropic streaming event sequence:
 *   message_start → content_block_start → ping → content_block_delta × N
 *   → content_block_stop → message_delta → message_stop
 */

import http from 'node:http'

const PORT = parseInt(process.argv[2] ?? '4001', 10)

const TOKENS = [
  'Hello', ' from', ' the', ' Anthropic', '-shaped', ' SSE', ' mock', '!',
  ' Token', ' 1', '.', ' Token', ' 2', '.', ' Token', ' 3', '.',
  ' This', ' proves', ' incremental', ' flush', '.'
]

const DELAY_MS = 60 // 60 ms between tokens — fast enough to test, slow enough to observe

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Write a Server-Sent Event frame in the exact format Anthropic uses.
 *   event: <type>\ndata: <json>\n\n
 */
function writeEvent(res, type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  res.write(line)
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    console.log('[mock-upstream] Received POST /v1/messages')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })

    const messageId = 'msg_mock_' + Date.now()

    // message_start
    writeEvent(res, 'message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4-5',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 }
      }
    })

    // content_block_start
    writeEvent(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' }
    })

    // ping
    writeEvent(res, 'ping', { type: 'ping' })

    // content_block_delta × N — one per token
    let outputTokens = 0

    const aborted = new Promise(resolve => req.on('close', resolve))
    let done = false
    aborted.then(() => { done = true })

    for (let i = 0; i < TOKENS.length; i++) {
      if (done) {
        console.log('[mock-upstream] Client disconnected — aborting token loop')
        break
      }
      await sleep(DELAY_MS)
      if (done) break

      const token = TOKENS[i]
      outputTokens++
      writeEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: token }
      })
      console.log(`[mock-upstream] Sent token ${i + 1}/${TOKENS.length}: "${token}"`)
    }

    if (!done) {
      // content_block_stop
      writeEvent(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })

      // message_delta
      writeEvent(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: outputTokens }
      })

      // message_stop
      writeEvent(res, 'message_stop', { type: 'message_stop' })

      console.log('[mock-upstream] Stream complete — sent', outputTokens, 'tokens')
    }

    res.end()
    return
  }

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version'
    })
    res.end()
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`[mock-upstream] Listening on http://localhost:${PORT}`)
  console.log('[mock-upstream] POST /v1/messages → emits Anthropic-shaped SSE')
})
