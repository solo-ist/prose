#!/usr/bin/env node
/**
 * MCP Server for Prose.
 *
 * This is a full MCP server that communicates with Claude Desktop via stdio
 * and with Prose via Unix socket. It can launch Prose on-demand if not running.
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

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import { getToolsForMCP } from '../shared/tools/registry'

// Socket path must match the one in socket-server.ts
const SOCKET_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Prose', 'prose.sock')
const AUTH_TOKEN_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Prose', 'mcp-auth-token')

// Tool definitions from shared registry (works without Prose running)
const TOOLS = getToolsForMCP()

// Per-tool execution timeouts (milliseconds)
const TOOL_TIMEOUTS: Record<string, number> = {
  read_document: 30000,
  get_outline: 30000,
  open_file: 30000,
  suggest_edit: 60000 // May involve LLM calls
}

const DEFAULT_TIMEOUT = 30000

// Maximum buffer size (1MB) to prevent memory exhaustion from malformed responses
const MAX_BUFFER_SIZE = 1024 * 1024

// Connection state
let socketConnection: net.Socket | null = null
let pendingRequests: Map<number | string, {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}> = new Map()
let requestIdCounter = 0

/**
 * Check if Prose socket is available.
 */
function canConnectToSocket(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCKET_PATH)) {
      resolve(false)
      return
    }

    const testSocket = net.createConnection(SOCKET_PATH)
    testSocket.on('connect', () => {
      testSocket.destroy()
      resolve(true)
    })
    testSocket.on('error', () => {
      resolve(false)
    })
  })
}

/**
 * Launch Prose application.
 */
function launchProse(): void {
  console.error('[Prose MCP] Launching Prose...')

  // Try different app locations
  const appPaths = [
    '/Applications/Prose.app',
    path.join(os.homedir(), 'Applications', 'Prose.app')
  ]

  for (const appPath of appPaths) {
    if (fs.existsSync(appPath)) {
      spawn('open', ['-a', appPath], {
        detached: true,
        stdio: 'ignore'
      }).unref()
      return
    }
  }

  // Fallback: try 'open -a Prose'
  spawn('open', ['-a', 'Prose'], {
    detached: true,
    stdio: 'ignore'
  }).unref()
}

/**
 * Wait for Prose to be ready with exponential backoff.
 * Max timeout: 20s (accounts for Gatekeeper verification on first launch)
 */
async function waitForProse(): Promise<boolean> {
  const maxTimeout = 20000
  let elapsed = 0
  let interval = 500

  while (elapsed < maxTimeout) {
    await sleep(interval)
    elapsed += interval

    if (await canConnectToSocket()) {
      console.error(`[Prose MCP] Prose ready after ${elapsed}ms`)
      return true
    }

    // Exponential backoff: 500ms → 1s → 2s → 4s
    interval = Math.min(interval * 2, 4000)
  }

  return false
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Ensure Prose is running and socket is connected.
 */
async function ensureConnection(): Promise<net.Socket> {
  // If we have an active connection, use it
  if (socketConnection && !socketConnection.destroyed) {
    return socketConnection
  }

  // Check if Prose is running
  if (!await canConnectToSocket()) {
    console.error('[Prose MCP] Prose not running, launching...')
    launchProse()

    if (!await waitForProse()) {
      throw new Error('Prose failed to start within timeout. Please start Prose manually.')
    }
  }

  // Connect to socket
  return connectToSocket()
}

/**
 * Connect to Prose socket.
 */
function connectToSocket(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    console.error('[Prose MCP] Connecting to socket...')

    const socket = net.createConnection(SOCKET_PATH)
    let buffer = ''

    socket.on('connect', async () => {
      console.error('[Prose MCP] Connected to Prose')
      socketConnection = socket

      // Send auth handshake if token file exists
      try {
        const token = fs.readFileSync(AUTH_TOKEN_PATH, 'utf-8').trim()
        if (token) {
          const authRequest = {
            jsonrpc: '2.0',
            id: ++requestIdCounter,
            method: 'auth',
            params: { token }
          }
          socket.write(JSON.stringify(authRequest) + '\n')
          console.error('[Prose MCP] Auth handshake sent')
        }
      } catch {
        // No auth token file — server may not require auth
        console.error('[Prose MCP] No auth token found, connecting without auth')
      }

      resolve(socket)
    })

    socket.on('data', (data) => {
      buffer += data.toString()

      // Guard against unbounded buffer growth
      if (buffer.length > MAX_BUFFER_SIZE) {
        console.error('[Prose MCP] Buffer exceeded max size, disconnecting')
        socket.destroy()
        return
      }

      // Process complete lines
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)

        if (line.trim()) {
          handleSocketResponse(line)
        }
      }
    })

    socket.on('close', () => {
      console.error('[Prose MCP] Socket closed')
      socketConnection = null
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Connection to Prose lost'))
      }
      pendingRequests.clear()
    })

    socket.on('error', (err) => {
      console.error('[Prose MCP] Socket error:', err.message)
      if (!socketConnection) {
        reject(err)
      }
    })
  })
}

/**
 * Handle response from Prose socket.
 */
function handleSocketResponse(message: string): void {
  try {
    const response = JSON.parse(message)
    const pending = pendingRequests.get(response.id)

    if (pending) {
      clearTimeout(pending.timeout)
      pendingRequests.delete(response.id)

      if (response.error) {
        pending.reject(new Error(response.error.message || 'Unknown error'))
      } else {
        pending.resolve(response.result)
      }
    }
  } catch (err) {
    console.error('[Prose MCP] Failed to parse response:', err)
  }
}

/**
 * Send a request to Prose and wait for response.
 */
async function sendRequest(
  method: string,
  params: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<unknown> {
  const socket = await ensureConnection()
  const id = ++requestIdCounter

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error(`Request timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    pendingRequests.set(id, { resolve, reject, timeout })

    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    socket.write(JSON.stringify(request) + '\n')
  })
}

/**
 * Execute a tool via Prose.
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const timeout = TOOL_TIMEOUTS[name] || DEFAULT_TIMEOUT

  try {
    const result = await sendRequest('tools/call', { name, arguments: args }, timeout)
    return result as { content: Array<{ type: string; text: string }>; isError?: boolean }
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : String(err)}`
        }
      ],
      isError: true
    }
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.error('[Prose MCP] Starting MCP server...')

  // Create MCP server
  const server = new Server(
    {
      name: 'Prose',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  )

  // Register tools/list handler (works without Prose running)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS }
  })

  // Register tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    return executeTool(name, (args ?? {}) as Record<string, unknown>)
  })

  // Create stdio transport
  const transport = new StdioServerTransport()

  // Connect server to transport
  await server.connect(transport)

  console.error('[Prose MCP] MCP server running')
}

main().catch((err) => {
  console.error('[Prose MCP] Fatal error:', err)
  process.exit(1)
})
