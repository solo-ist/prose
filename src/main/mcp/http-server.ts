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
import { timingSafeEqual } from 'crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { getToolsForMCP } from '../../shared/tools/registry'
import type { ToolResult } from '../../shared/tools/types'

// PROSE_MCP_PORT overrides the default so concurrent agent/QA sessions on one
// machine don't collide (mirrors PROSE_DEBUG_PORT).
const HTTP_PORT = Number(process.env.PROSE_MCP_PORT) || 9877
export const MCP_HTTP_PORT = HTTP_PORT

/**
 * HTTP MCP Server for direct Claude Desktop connection.
 */
export class McpHttpServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private onToolInvoke: ((name: string, args: unknown) => Promise<ToolResult>) | null = null
  private authToken: string | null = null

  /**
   * Set the authentication token for bearer auth.
   * Must be called before start().
   */
  setAuthToken(token: string): void {
    this.authToken = token
  }

  /**
   * Set the tool invocation handler.
   */
  setToolInvokeHandler(handler: (name: string, args: unknown) => Promise<ToolResult>): void {
    this.onToolInvoke = handler
  }

  /**
   * Build a fresh MCP Server for ONE request.
   *
   * The endpoint runs the Streamable HTTP transport in stateless mode (a new
   * transport per POST). The SDK's Protocol.connect() throws "Already connected"
   * when a Server still holds a transport, so a single shared Server only ever
   * answered the FIRST request — every later tools/list or tools/call threw
   * inside the request handler and the response was never ended (the client
   * hung or saw a reset). One Server per request is the documented stateless
   * pattern and also makes concurrent requests safe.
   */
  private buildMcpServer(): Server {
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

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = getToolsForMCP()
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

    return server
  }

  /**
   * Start the HTTP server.
   * Requires setAuthToken() to be called first.
   */
  async start(): Promise<void> {
    if (!this.authToken) {
      throw new Error('Auth token must be set before starting HTTP server')
    }
    // Create HTTP server
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Restrict CORS to localhost origins only
      const origin = req.headers.origin
      if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
      }
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`)

      // Health check endpoint (no auth required)
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', server: 'prose-mcp' }))
        return
      }

      // Verify bearer token authentication on all other endpoints
      // (authToken is guaranteed set — start() throws without it)
      const authHeader = req.headers.authorization
      const expected = `Bearer ${this.authToken}`
      const valid = authHeader
        && authHeader.length === expected.length
        && timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      // MCP endpoint
      if (url.pathname === '/mcp') {
        // Stateless mode: a fresh Server + transport per request (see buildMcpServer).
        const server = this.buildMcpServer()
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined
        })
        res.on('close', () => {
          transport.close().catch(() => {})
          server.close().catch(() => {})
        })
        try {
          await server.connect(transport)
          await transport.handleRequest(req, res)
        } catch (err) {
          console.error('[MCP HTTP] Request failed:', err)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'MCP request failed' }))
          } else {
            res.end()
          }
        }
        return
      }

      // Root endpoint - show info
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          name: 'Prose MCP Server',
          version: '1.0.0',
          endpoint: '/mcp',
          instructions: `Add http://localhost:${HTTP_PORT}/mcp as a Remote MCP server URL in Claude Desktop`
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
