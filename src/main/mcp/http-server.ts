/**
 * HTTP/SSE MCP Server for Prose.
 *
 * @deprecated This HTTP server is being replaced by Unix socket IPC (see socket-server.ts).
 * The socket approach allows mcp-stdio to communicate with Prose directly, enabling
 * on-demand launching and better integration with Claude Desktop. This HTTP server
 * will be removed in a future release.
 *
 * Exposes MCP tools via HTTP with SSE transport, allowing Claude Desktop
 * to connect directly via URL: http://localhost:9877/mcp
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { getToolsForMCP } from '../../shared/tools/registry'
import type { ToolResult } from '../../shared/tools/types'

const HTTP_PORT = 9877

/**
 * HTTP MCP Server for direct Claude Desktop connection.
 */
export class McpHttpServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private mcpServer: Server | null = null
  private transport: StreamableHTTPServerTransport | null = null
  private onToolInvoke: ((name: string, args: unknown) => Promise<ToolResult>) | null = null

  /**
   * Set the tool invocation handler.
   */
  setToolInvokeHandler(handler: (name: string, args: unknown) => Promise<ToolResult>): void {
    this.onToolInvoke = handler
  }

  /**
   * Start the HTTP server.
   */
  async start(): Promise<void> {
    // Create MCP server
    this.mcpServer = new Server(
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

    // Register tool list handler
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = getToolsForMCP()
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      }
    })

    // Register tool call handler
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      if (!this.onToolInvoke) {
        return {
          content: [{ type: 'text', text: 'No tool handler registered' }],
          isError: true
        }
      }

      try {
        const result = await this.onToolInvoke(name, args ?? {})

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)
              }
            ]
          }
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${result.error}${result.code ? ` (${result.code})` : ''}`
              }
            ],
            isError: true
          }
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      }
    })

    // Create HTTP server
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Restrict CORS to the Electron app origin only.
      // Wildcard (*) would allow any web page the user visits to invoke MCP tools.
      // Claude Desktop uses stdio transport, not HTTP, so it is unaffected by this header.
      const origin = req.headers['origin'] as string | undefined
      const allowedOrigin = 'app://'
      if (origin === allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id')
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`)

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', server: 'prose-mcp' }))
        return
      }

      // MCP endpoint
      if (url.pathname === '/mcp') {
        // Create a new transport for each connection
        // Using stateless mode (no session ID) for simplicity
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined
        })

        // Connect MCP server to transport
        await this.mcpServer!.connect(transport)

        // Handle the request
        await transport.handleRequest(req, res)
        return
      }

      // Root endpoint - show info
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          name: 'Prose MCP Server',
          version: '1.0.0',
          endpoint: '/mcp',
          instructions: 'Add http://localhost:9877/mcp as a Remote MCP server URL in Claude Desktop'
        }))
        return
      }

      // 404 for other paths
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[MCP HTTP] Port ${HTTP_PORT} is already in use`)
        }
        reject(err)
      })

      this.httpServer!.listen(HTTP_PORT, '127.0.0.1', () => {
        console.log(`[MCP HTTP] Server listening on http://127.0.0.1:${HTTP_PORT}`)
        console.log(`[MCP HTTP] Claude Desktop URL: http://localhost:${HTTP_PORT}/mcp`)
        resolve()
      })
    })
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close()
      this.transport = null
    }

    if (this.mcpServer) {
      await this.mcpServer.close()
      this.mcpServer = null
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve())
      })
      this.httpServer = null
    }

    console.log('[MCP HTTP] Server stopped')
  }
}

// Singleton instance
let serverInstance: McpHttpServer | null = null

/**
 * Get or create the MCP HTTP server instance.
 */
export function getMcpHttpServer(): McpHttpServer {
  if (!serverInstance) {
    serverInstance = new McpHttpServer()
  }
  return serverInstance
}
