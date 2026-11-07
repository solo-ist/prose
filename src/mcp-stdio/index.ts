#!/usr/bin/env node
/**
 * MCP Server for Prose.
 *
 * The stdio bridge MCP clients launch (Claude Desktop, and any client that
 * takes a command: Claude Code, Codex, LibreChat). It speaks MCP on stdio —
 * both protocol eras, from the shared server definition
 * (src/shared/mcp/server.ts) — and relays tool calls to the running app over
 * its Unix socket. It can launch the installed app on demand.
 *
 * Usage in Claude Desktop config:
 * {
 *   "mcpServers": {
 *     "prose": {
 *       "command": "node",
 *       "args": ["/Applications/Prose.app/Contents/Resources/mcp-stdio.cjs"]
 *     }
 *   }
 * }
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { CallToolResult } from '@modelcontextprotocol/server'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import { createProseMcpServer, type McpCallContext } from '../shared/mcp/server'
import { resolveProfile } from './profile'

/** Injected by the build (`build:mcp-stdio`): the app version this bridge shipped with. */
declare const __PROSE_VERSION__: string | undefined
const VERSION = typeof __PROSE_VERSION__ === 'string' ? __PROSE_VERSION__ : '0.0.0'

// The profile this bridge serves (see profile.ts): the socket and the auth
// token live in its folder.
const PROFILE = resolveProfile({ env: process.env, scriptDir: __dirname, platform: process.platform, home: os.homedir() })
const SOCKET_PATH = path.join(PROFILE.dir, 'prose.sock')
const AUTH_TOKEN_PATH = path.join(PROFILE.dir, 'mcp-auth-token')

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
    // Only the installed app can be launched for its own profile; a dev or
    // test profile belongs to an instance this bridge can't start.
    if (!PROFILE.isInstalledApp) {
      throw new Error(`Prose is not running (profile ${PROFILE.dir}). Start it and try again.`)
    }
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
      let needsAuth = false
      try {
        const token = fs.readFileSync(AUTH_TOKEN_PATH, 'utf-8').trim()
        if (token) {
          needsAuth = true
          const authId = ++requestIdCounter
          const authRequest = {
            jsonrpc: '2.0',
            id: authId,
            method: 'auth',
            params: { token }
          }

          // Wait for auth response before resolving
          pendingRequests.set(authId, {
            resolve: (result) => {
              console.error('[Prose MCP] Auth handshake confirmed')
              resolve(socket)
            },
            reject: (error) => {
              console.error('[Prose MCP] Auth handshake failed:', error.message)
              socketConnection = null
              socket.destroy()
              reject(new Error('MCP auth handshake failed'))
            },
            timeout: setTimeout(() => {
              pendingRequests.delete(authId)
              socketConnection = null
              socket.destroy()
              reject(new Error('MCP auth handshake timed out'))
            }, 5000)
          })

          socket.write(JSON.stringify(authRequest) + '\n')
          console.error('[Prose MCP] Auth handshake sent, waiting for confirmation')
        }
      } catch {
        // No auth token file — server may not require auth
        console.error('[Prose MCP] No auth token found, connecting without auth')
      }

      // Only resolve immediately if no auth is needed
      if (!needsAuth) {
        resolve(socket)
      }
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
async function executeTool(name: string, args: Record<string, unknown>, context: McpCallContext): Promise<CallToolResult> {
  const timeout = TOOL_TIMEOUTS[name] || DEFAULT_TIMEOUT
  // The client's self-reported name and version: the app labels the call with
  // them (cleaned), as "who" for a bridge that has no connection of its own.
  const client = context.client ? { name: context.client.name, version: context.client.version } : undefined

  try {
    // The app answers in the MCP result shape already (socket-server.ts).
    const result = await sendRequest('tools/call', { name, arguments: args, ...(client ? { client } : {}) }, timeout)
    return result as CallToolResult
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
 * Main entry point: serve MCP on stdio. The opening exchange picks the
 * protocol era for the connection; tools/list works without Prose running.
 */
function main(): void {
  console.error(`[Prose MCP] Starting MCP server ${VERSION} for profile ${PROFILE.dir}`)
  serveStdio(() => createProseMcpServer({ version: VERSION, callTool: executeTool }), {
    onerror: (err) => console.error('[Prose MCP] Protocol error:', err.message)
  })
  console.error('[Prose MCP] MCP server running')
}

main()
