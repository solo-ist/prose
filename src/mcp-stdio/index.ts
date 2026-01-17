#!/usr/bin/env node
/**
 * MCP Stdio-to-HTTP Bridge for Prose.
 *
 * This script bridges Claude Desktop's stdio transport to Prose's HTTP/SSE MCP server.
 * Claude Desktop spawns this script and communicates via stdin/stdout.
 * This script forwards requests to http://localhost:9877/mcp.
 *
 * Usage in Claude Desktop config:
 * {
 *   "mcpServers": {
 *     "prose": {
 *       "command": "node",
 *       "args": ["/Applications/Prose.app/Contents/Resources/mcp-stdio.js"]
 *     }
 *   }
 * }
 */

import * as readline from 'readline'
import * as http from 'http'

const PROSE_URL = 'http://127.0.0.1:9877/mcp'

// Track pending requests to avoid exiting before they complete
let pendingRequests = 0
let stdinClosed = false

function checkExit(): void {
  if (stdinClosed && pendingRequests === 0) {
    console.error('[Prose MCP] All requests complete, exiting')
    process.exit(0)
  }
}

/**
 * Send a JSON-RPC request to Prose and return the response.
 */
async function sendRequest(jsonRpcMessage: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const url = new URL(PROSE_URL)

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        }
      },
      (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk.toString()
        })

        res.on('end', () => {
          console.error('[Prose MCP] Response received, length:', data.length)

          // Parse SSE response - look for "data:" lines
          const lines = data.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonData = line.slice(6) // Remove "data: " prefix
              if (jsonData.trim()) {
                console.error('[Prose MCP] Found SSE data')
                resolve(jsonData)
                return
              }
            }
          }

          // If no SSE data found, maybe it's direct JSON
          if (data.trim().startsWith('{')) {
            console.error('[Prose MCP] Found direct JSON')
            resolve(data.trim())
            return
          }

          console.error('[Prose MCP] No valid data found in response')
          resolve(null)
        })
      }
    )

    req.on('error', (err) => {
      // Connection refused means Prose isn't running
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        // Return a proper JSON-RPC error response
        const parsed = JSON.parse(jsonRpcMessage)
        const errorResponse = {
          jsonrpc: '2.0',
          id: parsed.id,
          error: {
            code: -32000,
            message: 'Prose is not running. Please start Prose to use these tools.'
          }
        }
        resolve(JSON.stringify(errorResponse))
      } else {
        reject(err)
      }
    })

    req.write(jsonRpcMessage)
    req.end()
  })
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Log to stderr (doesn't interfere with stdio transport)
  console.error('[Prose MCP] Stdio bridge started')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })

  rl.on('line', async (line) => {
    if (!line.trim()) return

    pendingRequests++
    console.error('[Prose MCP] Processing request, pending:', pendingRequests)

    try {
      // Forward request to Prose HTTP server
      const response = await sendRequest(line)

      if (response) {
        // Write response to stdout
        process.stdout.write(response + '\n')
      }
    } catch (err) {
      console.error('[Prose MCP] Error:', err)

      // Try to send error response
      try {
        const parsed = JSON.parse(line)
        const errorResponse = {
          jsonrpc: '2.0',
          id: parsed.id,
          error: {
            code: -32603,
            message: `Internal error: ${err instanceof Error ? err.message : String(err)}`
          }
        }
        process.stdout.write(JSON.stringify(errorResponse) + '\n')
      } catch {
        // Can't even parse the request, nothing we can do
      }
    } finally {
      pendingRequests--
      console.error('[Prose MCP] Request complete, pending:', pendingRequests)
      checkExit()
    }
  })

  rl.on('close', () => {
    console.error('[Prose MCP] Stdin closed, pending requests:', pendingRequests)
    stdinClosed = true
    checkExit()
  })

  // Handle process signals
  process.on('SIGINT', () => {
    console.error('[Prose MCP] Received SIGINT, exiting')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.error('[Prose MCP] Received SIGTERM, exiting')
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[Prose MCP] Fatal error:', err)
  process.exit(1)
})
