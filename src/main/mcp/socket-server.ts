/**
 * Unix Socket MCP Server for Prose.
 *
 * Listens on a Unix socket for JSON-RPC requests from mcp-stdio.
 * This allows Claude Desktop to communicate with Prose even when
 * launching the mcp-stdio script separately.
 *
 * Socket path: ~/Library/Application Support/Prose/prose.sock
 */

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { app } from 'electron'
import { getToolsForMCP, isToolExposedViaMCP } from '../../shared/tools/registry'
import {
  normalizeMcpClientIdentity,
  type McpClientIdentity,
} from '../../shared/tools/mcpClientIdentity'
import type { ToolResult } from '../../shared/tools/types'

// Resolve the socket location lazily. The app redirects userData for isolated
// QA profiles before this module's server is started; resolving it at module
// load would point tests at the user's normal socket.
function getSocketLocation(): { directory: string; path: string } {
  const directory = path.join(app.getPath('userData'), '')
  return { directory, path: path.join(directory, 'prose.sock') }
}

// Maximum buffer size (1MB) to prevent memory exhaustion from malformed input
const MAX_BUFFER_SIZE = 1024 * 1024

/**
 * Unix Socket MCP Server.
 */
export class McpSocketServer {
  private server: net.Server | null = null
  private socketPath: string | null = null
  private onToolInvoke: ((name: string, args: unknown, clientIdentity?: McpClientIdentity) => Promise<ToolResult>) | null = null
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
    return this.socketPath ?? getSocketLocation().path
  }

  /**
   * Set the tool invocation handler.
   */
  setToolInvokeHandler(handler: (name: string, args: unknown, clientIdentity?: McpClientIdentity) => Promise<ToolResult>): void {
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

    const socketLocation = getSocketLocation()
    this.socketPath = socketLocation.path

    // Ensure socket directory exists
    if (!fs.existsSync(socketLocation.directory)) {
      fs.mkdirSync(socketLocation.directory, { recursive: true })
    }

    // Clean up stale socket file from previous crashes
    if (fs.existsSync(socketLocation.path)) {
      try {
        fs.unlinkSync(socketLocation.path)
        console.log('[MCP Socket] Removed stale socket file')
      } catch (err) {
        console.error('[MCP Socket] Failed to remove stale socket:', err)
        throw new Error(`Cannot remove stale socket at ${socketLocation.path}`)
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

      this.server!.listen(socketLocation.path, () => {
        // Restrict socket permissions to owner only
        try {
          fs.chmodSync(socketLocation.path, 0o600)
        } catch (err) {
          console.warn('[MCP Socket] Failed to set socket permissions:', err)
        }
        console.log(`[MCP Socket] Server listening on ${socketLocation.path}`)
        resolve()
      })
    })
  }

  /**
   * Stop the socket server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve())
      })
      this.server = null
    }

    // Clean up socket file
    const socketPath = this.socketPath
    if (socketPath && fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath)
        console.log('[MCP Socket] Socket file removed')
      } catch (err) {
        console.error('[MCP Socket] Failed to remove socket file:', err)
      }
    }
    this.socketPath = null

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
        const tools = getToolsForMCP()
        this.sendResult(socket, id, {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        })
      } else if (method === 'tools/call') {
        // Execute tool
        const { name, arguments: args, clientIdentity } = params as {
          name: string
          arguments?: unknown
          clientIdentity?: unknown
        }

        // Keep the call surface identical to tools/list. A client can send a
        // direct tools/call without first listing tools, so the allowlist must
        // be enforced at the execution boundary as well.
        if (!isToolExposedViaMCP(name)) {
          this.sendResult(socket, id, {
            content: [{
              type: 'text',
              text: `Error: Tool "${name}" is not exposed through MCP (MCP_TOOL_NOT_EXPOSED)`
            }],
            isError: true
          })
          return
        }

        if (!this.onToolInvoke) {
          this.sendError(socket, id, -32000, 'No tool handler registered')
          return
        }

        const result = await this.onToolInvoke(
          name,
          args ?? {},
          normalizeMcpClientIdentity(clientIdentity),
        )

        if (result.success) {
          this.sendResult(socket, id, {
            content: [
              {
                type: 'text',
                text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)
              }
            ]
          })
        } else {
          this.sendResult(socket, id, {
            content: [
              {
                type: 'text',
                text: `Error: ${result.error}${result.code ? ` (${result.code})` : ''}`
              }
            ],
            isError: true
          })
        }
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
