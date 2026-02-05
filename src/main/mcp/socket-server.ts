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
import { app } from 'electron'
import { getToolsForMCP } from '../../shared/tools/registry'
import type { ToolResult } from '../../shared/tools/types'

// Socket location in app support directory
const SOCKET_DIR = path.join(app.getPath('userData'), '')
const SOCKET_PATH = path.join(SOCKET_DIR, 'prose.sock')

/**
 * Unix Socket MCP Server.
 */
export class McpSocketServer {
  private server: net.Server | null = null
  private onToolInvoke: ((name: string, args: unknown) => Promise<ToolResult>) | null = null

  /**
   * Get the socket path.
   */
  getSocketPath(): string {
    return SOCKET_PATH
  }

  /**
   * Set the tool invocation handler.
   */
  setToolInvokeHandler(handler: (name: string, args: unknown) => Promise<ToolResult>): void {
    this.onToolInvoke = handler
  }

  /**
   * Start the socket server.
   */
  async start(): Promise<void> {
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
        console.log(`[MCP Socket] Server listening on ${SOCKET_PATH}`)
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
        const { name, arguments: args } = params as { name: string; arguments?: unknown }

        if (!this.onToolInvoke) {
          this.sendError(socket, id, -32000, 'No tool handler registered')
          return
        }

        const result = await this.onToolInvoke(name, args ?? {})

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
