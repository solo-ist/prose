/**
 * MCP over Streamable HTTP on loopback, for clients that connect by URL
 * (Claude Code, Codex, Open WebUI, LibreChat, ...): http://localhost:<port>/mcp.
 *
 * Serves both protocol eras from the shared server definition
 * (src/shared/mcp/server.ts): 2026-07-28 requests per request, and 2025-era
 * requests (2025-11-25 and earlier) through the SDK's stateless fallback, the
 * same stateless shape this endpoint served before.
 *
 * Every request passes, in order: the Host check (DNS-rebinding defence: a
 * page on another site can't reach this port by pointing its own hostname at
 * 127.0.0.1), the Origin check (browser callers), then the bearer token.
 * The stdio bridge that Claude Desktop launches doesn't use this endpoint; it
 * reaches the app over the Unix socket (socket-server.ts).
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { timingSafeEqual } from 'crypto'
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server'
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node'
import { createProseMcpServer, toCallToolResult } from '../../shared/mcp/server'
import type { ToolResult } from '../../shared/tools/types'

/**
 * Hostnames this endpoint answers to, for both `Host` and `Origin`.
 * host.docker.internal is how Docker-hosted clients (Open WebUI, LibreChat)
 * reach a server on the host.
 */
export const MCP_ALLOWED_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']

/** The two protocol revisions this endpoint is tested against. */
export const MCP_PROTOCOL_REVISIONS = ['2026-07-28', '2025-11-25']

/**
 * The port for this instance: PROSE_MCP_PORT when set, else 9877 for the
 * installed app and 9878 for unpackaged runs (dev, e2e), so a dev window
 * never takes the installed app's port.
 */
export function mcpHttpPort(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.PROSE_MCP_PORT) || (isPackaged ? 9877 : 9878)
}

export interface McpHttpServerStartOptions {
  /** 0 picks a free port (tests); read it back from `port`. */
  port: number
  /** The app version, reported as `serverInfo.version`. */
  version: string
}

export class McpHttpServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private mcpHandler: McpHttpHandler | null = null
  private onToolInvoke: ((name: string, args: unknown) => Promise<ToolResult>) | null = null
  private authToken: string | null = null
  private listeningPort = 0

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

  /** The port the server is listening on (0 before start). */
  get port(): number {
    return this.listeningPort
  }

  /**
   * Start the HTTP server.
   * Requires setAuthToken() to be called first.
   */
  async start({ port, version }: McpHttpServerStartOptions): Promise<void> {
    if (!this.authToken) {
      throw new Error('Auth token must be set before starting HTTP server')
    }
    const authToken = this.authToken

    // One stateless server instance per request, for either era.
    this.mcpHandler = createMcpHandler(
      () =>
        createProseMcpServer({
          version,
          callTool: async (name, args) => {
            if (!this.onToolInvoke) {
              return { content: [{ type: 'text', text: 'No tool handler registered' }], isError: true }
            }
            return toCallToolResult(await this.onToolInvoke(name, args))
          }
        }),
      {
        legacy: 'stateless',
        onerror: (err) => console.error('[MCP HTTP] Request failed:', err.message)
      }
    )
    const handleMcp = toNodeHandler(this.mcpHandler, {
      onerror: (err) => console.error('[MCP HTTP] Adapter error:', err.message)
    })
    const validateHost = hostHeaderValidation(MCP_ALLOWED_HOSTNAMES)
    const validateOrigin = originValidation(MCP_ALLOWED_HOSTNAMES)

    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Both guards answer 403 themselves when they refuse.
      if (!validateHost(req, res)) return
      if (!validateOrigin(req, res)) return

      // Only an allowed Origin gets this far, so reflecting it is safe.
      const origin = req.headers.origin
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID'
      )
      res.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version, Mcp-Session-Id')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url || '/', 'http://localhost')

      // Health check endpoint (no auth required)
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', server: 'prose-mcp' }))
        return
      }

      // Verify bearer token authentication on all other endpoints
      const authHeader = req.headers.authorization
      const expected = `Bearer ${authToken}`
      const valid = authHeader
        && authHeader.length === expected.length
        && timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="Prose"' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      if (url.pathname === '/mcp') {
        await handleMcp(req, res)
        return
      }

      // Root endpoint - show info
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          name: 'Prose MCP Server',
          version,
          endpoint: '/mcp',
          protocolRevisions: MCP_PROTOCOL_REVISIONS,
          auth: 'Bearer token'
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
          console.error(`[MCP HTTP] Port ${port} is already in use`)
        }
        reject(err)
      })

      this.httpServer!.listen(port, '127.0.0.1', () => {
        this.listeningPort = (this.httpServer!.address() as AddressInfo).port
        console.log(`[MCP HTTP] Server listening on http://127.0.0.1:${this.listeningPort}/mcp`)
        resolve()
      })
    })
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    await this.mcpHandler?.close().catch(() => {})
    this.mcpHandler = null
    if (this.httpServer) {
      const server = this.httpServer
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
      this.httpServer = null
    }
    this.listeningPort = 0

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
