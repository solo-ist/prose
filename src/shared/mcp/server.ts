/**
 * The one definition of Prose's MCP server, shared by the HTTP endpoint in
 * the main process (src/main/mcp/http-server.ts) and the stdio bridge that
 * MCP clients launch (src/mcp-stdio/index.ts).
 *
 * Built on the v2 SDK, which serves both protocol eras from one factory: the
 * 2025-era `initialize` handshake (2025-11-25 and earlier) and the 2026-07-28
 * per-request envelope with `server/discover`. The factory is called once per
 * HTTP request (`createMcpHandler`) or once per stdio connection
 * (`serveStdio`), so it must stay cheap and hold no state.
 */

import { CLIENT_INFO_META_KEY, Server } from '@modelcontextprotocol/server'
import type { CallToolResult, ServerContext, Tool } from '@modelcontextprotocol/server'
import { getToolsForMCP } from '../tools/registry'
import type { ToolResult } from '../tools/types'
import { PROSE_MCP_INSTRUCTIONS } from './instructions'
import type { McpClientInfo } from './actor'

/** What the server knows about a call beyond its arguments. */
export interface McpCallContext {
  /** The client's self-reported `clientInfo`, when it sent one. Untrusted. */
  client?: McpClientInfo
}

/** Runs one MCP tool call and answers with the MCP result shape. */
export type McpToolCaller = (name: string, args: Record<string, unknown>, context: McpCallContext) => Promise<CallToolResult>

export interface ProseMcpServerOptions {
  /** The app version, reported as `serverInfo.version`. */
  version: string
  callTool: McpToolCaller
}

/**
 * A tool executor's result as an MCP `tools/call` result: the payload as JSON
 * text for every client, plus `structuredContent` (which the tool's
 * `outputSchema` describes) when the payload is an object. Failures stay
 * text-only with `isError`, as before.
 */
export function toCallToolResult(result: ToolResult): CallToolResult {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}${result.code ? ` (${result.code})` : ''}` }],
      isError: true
    }
  }
  const { data } = result
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return { content: [{ type: 'text', text }], structuredContent: data as Record<string, unknown> }
  }
  return { content: [{ type: 'text', text }] }
}

/** A failure raised before a tool could answer (bridge timeout, Prose not reachable). */
export function toolCallFailure(error: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true
  }
}

/**
 * The client's `clientInfo`: carried by every 2026-07-28 request's envelope,
 * or by the connection's `initialize` in the 2025 era (stdio; over stateless
 * HTTP the `initialize` was a different request, so there is none).
 */
function clientInfoOf(server: Server, ctx: ServerContext | undefined): McpClientInfo | undefined {
  const fromEnvelope = (ctx?.mcpReq.envelope as Record<string, unknown> | undefined)?.[CLIENT_INFO_META_KEY]
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the 2025-era source of clientInfo
  const info = (fromEnvelope ?? server.getClientVersion()) as McpClientInfo | undefined
  return info && typeof info === 'object' ? { name: info.name, version: info.version } : undefined
}

export function createProseMcpServer({ version, callTool }: ProseMcpServerOptions): Server {
  const server = new Server(
    { name: 'Prose', title: 'Prose', version },
    { capabilities: { tools: {} }, instructions: PROSE_MCP_INSTRUCTIONS }
  )
  // The registry's schemas are plain JSON Schema objects with an object root.
  const tools = getToolsForMCP().map((tool): Tool => ({
    ...tool,
    inputSchema: tool.inputSchema as Tool['inputSchema'],
    outputSchema: tool.outputSchema as Tool['outputSchema']
  }))
  const outputSchemas = new Map(tools.map((tool) => [tool.name, tool.outputSchema]))

  server.setRequestHandler('tools/list', async () => ({ tools }))

  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name, arguments: args } = request.params
    let result: CallToolResult
    try {
      result = await callTool(name, (args ?? {}) as Record<string, unknown>, { client: clientInfoOf(server, ctx) })
    } catch (error) {
      result = toolCallFailure(error)
    }
    // The era-specific wire shape (the SDK's codec) lives in one place.
    return server.projectCallToolResult(result, outputSchemas.get(name))
  })

  return server
}
