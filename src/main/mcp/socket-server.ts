/**
 * Unix Socket MCP Server for Prose.
 *
 * Listens on a Unix socket for JSON-RPC requests from mcp-stdio.
 * This allows Claude Desktop to communicate with Prose even when
 * launching the mcp-stdio script separately.
 *
 * Socket path: <userData>/prose.sock, resolved when it is used, not at import:
 * index.ts redirects userData (the Prose Dev profile, the PROSE_USER_DATA_DIR
 * test seam) after the hoisted imports have run, so a path computed at module
 * load pointed at the installed app's profile and the dev instance took over
 * the installed app's socket (#1139).
 */

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { app } from 'electron'
import { getToolsForMCP } from '../../shared/tools/registry'
import type { ToolResult } from '../../shared/tools/types'
import { toCallToolResult } from '../../shared/mcp/server'
import { launchActor, type McpClientInfo } from '../../shared/mcp/actor'
import type { McpAgentActor } from '../../shared/review/actor'

/** The socket's path under the profile in force when it is asked for. */
function socketPath(): string {
  return path.join(app.getPath('userData'), 'prose.sock')
}

// Maximum buffer size (1MB) to prevent memory exhaustion from malformed input
const MAX_BUFFER_SIZE = 1024 * 1024

/**
 * Unix Socket MCP Server.
 */
export class McpSocketServer {
  private server: net.Server | null = null
  private onToolInvoke: ((name: string, args: unknown, actor: McpAgentActor) => Promise<ToolResult>) | null = null
  private authToken: string | null = null
  private authenticatedSockets = new WeakSet<net.Socket>()

  /**
   * Set the authentication token for socket auth.
   * Must be called before start().
   */
  setAuthToken(token: string): void {
    this.authToken = token
  }


  /**
   * Get the socket path.
   */
  getSocketPath(): string {
    return socketPath()
  }

  /**
   * Set the tool invocation handler.
   */
  setToolInvokeHandler(handler: (name: string, args: unknown, actor: McpAgentActor) => Promise<ToolResult>): void {
    this.onToolInvoke = handler
  }

  /**
   * Start the socket server.
   * Requires setAuthToken() to be called first.
   */
  async start(): Promise<void> {
    if (!this.authToken) {
      throw new Error('Auth token must be set before starting socket server')
    }

    const SOCKET_PATH = socketPath()
    const SOCKET_DIR = path.dirname(SOCKET_PATH)

    // Ensure socket directory exists
    if (!fs.existsSync(SOCKET_DIR)) {
      fs.mkdirSync(SOCKET_DIR, { recursive: true })
    }

    // Clean up stale socket file from previous crashes
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH)
        console.log('[MCP Socket] Removed stale socket file')
      } catch (err) {
        console.error('[MCP Socket] Failed to remove stale socket:', err)
        throw new Error(`Cannot remove stale socket at ${SOCKET_PATH}`)
      }
    }

    // Create server
    this.server = net.createServer((socket) => {
      this.handleConnection(socket)
    })

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', (err) => {
        console.error('[MCP Socket] Server error:', err)
        reject(err)
      })

      this.server!.listen(SOCKET_PATH, () => {
        // Restrict socket permissions to owner only
        try {
          fs.chmodSync(SOCKET_PATH, 0o600)
        } catch (err) {
          console.warn('[MCP Socket] Failed to set socket permissions:', err)
        }
        console.log(`[MCP Socket] Server listening on ${SOCKET_PATH}`)
        resolve()
      })
    })
  }

  /**
   * Stop the socket server.
   */
  async stop(): Promise<void> {
    const SOCKET_PATH = socketPath()
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve())
      })
      this.server = null
    }

    // Clean up socket file
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH)
        console.log('[MCP Socket] Socket file removed')
      } catch (err) {
        console.error('[MCP Socket] Failed to remove socket file:', err)
      }
    }

    console.log('[MCP Socket] Server stopped')
  }

  /**
   * Handle a new connection.
   * Uses newline-delimited JSON-RPC 2.0 protocol.
   */
  private handleConnection(socket: net.Socket): void {
    console.log('[MCP Socket] New connection')

    let buffer = ''

    socket.on('data', async (data) => {
      buffer += data.toString()

      // Guard against unbounded buffer growth
      if (buffer.length > MAX_BUFFER_SIZE) {
        console.error('[MCP Socket] Buffer exceeded max size, disconnecting client')
        socket.destroy()
        return
      }

      // Process complete lines (newline-delimited JSON)
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)

        if (line.trim()) {
          await this.handleMessage(socket, line)
        }
      }
    })

    socket.on('close', () => {
      console.log('[MCP Socket] Connection closed')
    })

    socket.on('error', (err) => {
      console.error('[MCP Socket] Connection error:', err)
    })
  }

  /**
   * Handle a JSON-RPC message.
   */
  private async handleMessage(socket: net.Socket, message: string): Promise<void> {
    let request: { jsonrpc: string; id: number | string; method: string; params?: unknown }

    try {
      request = JSON.parse(message)
    } catch (err) {
      this.sendError(socket, null, -32700, 'Parse error')
      return
    }

    const { id, method, params } = request

    // Require authentication before any other method
    if (method === 'auth') {
      const { token } = (params as { token?: string }) || {}
      const expected = this.authToken || ''
      const valid = token
        && token.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
      if (valid) {
        this.authenticatedSockets.add(socket)
        this.sendResult(socket, id, { authenticated: true })
      } else {
        this.sendError(socket, id, -32000, 'Authentication failed')
        socket.destroy()
      }
      return
    }

    // Reject unauthenticated requests when auth is configured
    if (this.authToken && !this.authenticatedSockets.has(socket)) {
      this.sendError(socket, id, -32000, 'Not authenticated. Send auth method first.')
      socket.destroy()
      return
    }

    try {
      if (method === 'tools/list') {
        // Return tool definitions
        this.sendResult(socket, id, { tools: getToolsForMCP() })
      } else if (method === 'tools/call') {
        // Execute tool
        // `client` is the bridge's MCP client's self-reported clientInfo
        // (#1236): it labels the call, cleaned, and is never trusted further.
        const { name, arguments: args, client } = params as { name: string; arguments?: unknown; client?: McpClientInfo }

        if (!this.onToolInvoke) {
          this.sendError(socket, id, -32000, 'No tool handler registered')
          return
        }

        // The MCP result shape (text + structuredContent): the stdio bridge
        // passes it through unchanged, so older installed bridges keep working.
        const result = await this.onToolInvoke(name, args ?? {}, launchActor('stdio', client))
        this.sendResult(socket, id, toCallToolResult(result))
      } else {
        this.sendError(socket, id, -32601, `Method not found: ${method}`)
      }
    } catch (err) {
      console.error('[MCP Socket] Error handling message:', err)
      this.sendError(
        socket,
        id,
        -32603,
        `Internal error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * Send a JSON-RPC success result.
   */
  private sendResult(socket: net.Socket, id: number | string | null, result: unknown): void {
    const response = {
      jsonrpc: '2.0',
      id,
      result
    }
    socket.write(JSON.stringify(response) + '\n')
  }

  /**
   * Send a JSON-RPC error.
   */
  private sendError(
    socket: net.Socket,
    id: number | string | null,
    code: number,
    message: string
  ): void {
    const response = {
      jsonrpc: '2.0',
      id,
      error: { code, message }
    }
    socket.write(JSON.stringify(response) + '\n')
  }
}

// Singleton instance
let serverInstance: McpSocketServer | null = null

/**
 * Get or create the MCP socket server instance.
 */
export function getMcpSocketServer(): McpSocketServer {
  if (!serverInstance) {
    serverInstance = new McpSocketServer()
  }
  return serverInstance
}
