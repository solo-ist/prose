/**
 * One call from a remote MCP client, carried by the relay socket (#1239;
 * design docs/architecture/mcp-relay.md §4 and §6).
 *
 * The gateway has already checked the client's OAuth token and its scopes;
 * this is the second gate. A client the writer hasn't approved in Prose is
 * recorded as pending and refused, unless it is on the short list of trusted
 * clients (#1304), which is connected on its first call with the scopes its
 * token carries. A connected one reaches only the tools both its token's
 * scopes and the connection allow, through the same MCP server definition
 * the local endpoint serves, and every record it makes carries the actor
 * main builds here (`via: 'relay'`), labelled with the writer's name for the
 * connection.
 *
 * Everything in a frame is data from the network: the client's name is shown,
 * never trusted (trust reads the verified client id's domain, never the
 * name); the params are tool arguments like any MCP client's.
 */

import { createMcpHandler, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server'
import { createProseMcpServer, toCallToolResult } from '../../shared/mcp/server'
import { connectionActor } from '../../shared/mcp/actor'
import { remoteScopesOf, toolsForRemoteScopes } from '../../shared/mcp/remoteScopes'
import { isTrustedRemoteClient } from '../../shared/mcp/trustedRemoteClients'
import type { McpAgentActor } from '../../shared/review/actor'
import type { McpToolInvoker } from './http-server'
import type { RemoteConnection, RemoteConnectionStore } from './remoteConnections'

/** A call as the gateway frames it. */
export interface RelayCallFrame {
  type: 'call'
  id: string
  client: { id: string; name: string; verified: boolean }
  scopes: string[]
  method: string
  params?: Record<string, unknown>
  headers: Record<string, string>
}

export type RelayAnswer = { result: unknown } | { error: { code: number; message: string } }

/** JSON-RPC errors the desktop answers with (server-defined range, after the gateway's). */
export const RELAY_CALL_ERROR = {
  NOT_APPROVED: -32010,
  DECLINED: -32011,
  NO_PERMISSION: -32012,
} as const

/** The SEP-2243 standard headers the gateway forwards; anything else in a frame is dropped. */
const FORWARDED_HEADERS = /^(mcp-protocol-version|mcp-method|mcp-name|mcp-param-[a-z0-9-]{1,64})$/

interface RelayContext {
  tools: ReadonlySet<string>
  actor: McpAgentActor
}

export interface RelayCallHandlerOptions {
  store: Pick<RemoteConnectionStore, 'get' | 'notePending' | 'connectTrusted' | 'touch'>
  /** Runs an approved call's tool (the renderer bridge). */
  invokeTool: McpToolInvoker
  /** The app version, reported as `serverInfo.version`. */
  version: string
  /** A client was recorded as pending: tell the writer. */
  onPending?: (connection: RemoteConnection) => void
  /** A trusted client was connected without approval (#1304): tell the writer. */
  onConnected?: (connection: RemoteConnection) => void
}

function fail(code: number, message: string): RelayAnswer {
  return { error: { code, message } }
}

/** A frame's shape, checked field by field; null when it isn't a call. */
export function parseCallFrame(value: unknown): RelayCallFrame | null {
  const f = value as Partial<RelayCallFrame> | null
  if (!f || typeof f !== 'object' || f.type !== 'call') return null
  if (typeof f.id !== 'string' || f.id.length === 0 || f.id.length > 100) return null
  const c = f.client as RelayCallFrame['client'] | undefined
  if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 2048 || typeof c.name !== 'string' || typeof c.verified !== 'boolean') {
    return null
  }
  if (!Array.isArray(f.scopes) || typeof f.method !== 'string' || f.method.length === 0 || f.method.length > 128) return null
  if (f.params !== undefined && (f.params === null || typeof f.params !== 'object' || Array.isArray(f.params))) return null
  const headers: Record<string, string> = {}
  if (f.headers && typeof f.headers === 'object') {
    for (const [key, value] of Object.entries(f.headers)) {
      const name = key.toLowerCase()
      if (typeof value === 'string' && value.length <= 8192 && FORWARDED_HEADERS.test(name)) headers[name] = value
    }
  }
  return {
    type: 'call',
    id: f.id,
    client: { id: c.id, name: c.name.slice(0, 200), verified: c.verified },
    scopes: f.scopes.filter((s): s is string => typeof s === 'string'),
    method: f.method,
    ...(f.params !== undefined ? { params: f.params } : {}),
    headers
  }
}

/** The JSON-RPC messages in a response body: one JSON object, or a 2025-era SSE stream. */
function messagesOf(body: string, contentType: string): unknown[] {
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  if (!contentType.includes('text/event-stream')) return body.trim() ? [parse(body)] : []
  return body
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
    )
    .filter(Boolean)
    .map(parse)
}

export class RelayCallHandler {
  private readonly handler: McpHttpHandler

  constructor(private readonly options: RelayCallHandlerOptions) {
    // One stateless server per call, for either protocol era, as the local
    // endpoint does; the call's tools and actor ride in as the SDK's
    // pass-through authInfo. JSON responses: nothing in a tool call streams.
    this.handler = createMcpHandler(
      ({ authInfo }) => {
        const relay = authInfo?.extra?.relay as RelayContext
        return createProseMcpServer({
          version: options.version,
          allowedTools: relay.tools,
          callTool: async (name, args) => toCallToolResult(await options.invokeTool(name, args, relay.actor))
        })
      },
      { legacy: 'stateless', responseMode: 'json', onerror: (err) => console.error('[MCP relay] Request failed:', err.message) }
    )
  }

  /** Answer one call frame (already parsed). */
  async handle(frame: RelayCallFrame): Promise<RelayAnswer> {
    const { store } = this.options
    let connection = store.get(frame.client.id)
    if (!connection) {
      if (isTrustedRemoteClient(frame.client)) {
        connection = store.connectTrusted(frame.client, remoteScopesOf(frame.scopes))
        this.options.onConnected?.(connection)
      } else {
        connection = store.notePending(frame.client)
        this.options.onPending?.(connection)
      }
    }
    if (connection.status === 'pending') {
      return fail(
        RELAY_CALL_ERROR.NOT_APPROVED,
        `Approve ${connection.clientName} in Prose → Settings → Integrations → Connections, then try again.`
      )
    }
    if (connection.status === 'denied') {
      return fail(RELAY_CALL_ERROR.DECLINED, `The writer declined ${connection.clientName} in Prose.`)
    }

    // Both gates: what the token's consent allows AND what the writer approved.
    const granted = toolsForRemoteScopes(remoteScopesOf(frame.scopes))
    const approved = toolsForRemoteScopes(connection.scopes)
    const tools = new Set([...granted].filter((tool) => approved.has(tool)))
    if (tools.size === 0) return fail(RELAY_CALL_ERROR.NO_PERMISSION, 'This connection has no permissions in Prose.')

    store.touch(connection.clientId)
    const actor = connectionActor({ id: connection.id, label: connection.label }, 'relay', { name: connection.clientName })
    const request = new Request('http://relay.prose.invalid/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...frame.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: frame.id, method: frame.method, ...(frame.params !== undefined ? { params: frame.params } : {}) })
    })
    const authInfo: AuthInfo = { token: 'relay', clientId: connection.id, scopes: [...connection.scopes], extra: { relay: { tools, actor } satisfies RelayContext } }
    let response: Response
    try {
      response = await this.handler.fetch(request, { authInfo })
    } catch (err) {
      return fail(-32603, `Prose could not answer: ${err instanceof Error ? err.message : String(err)}`)
    }
    const messages = messagesOf(await response.text(), response.headers.get('content-type') ?? '')
    const reply = messages.find(
      (m): m is { id: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } } =>
        !!m && typeof m === 'object' && (m as { id?: unknown }).id === frame.id && ('result' in m || 'error' in m)
    ) ?? messages.find((m) => !!m && typeof m === 'object' && 'error' in m && (m as { id?: unknown }).id === null) as
      | { error?: { code?: unknown; message?: unknown } }
      | undefined
    if (!reply) return fail(-32603, `Prose could not answer (HTTP ${response.status}).`)
    if ('error' in reply && reply.error) {
      const code = Number.isInteger(reply.error.code) ? (reply.error.code as number) : -32603
      return fail(code, typeof reply.error.message === 'string' ? reply.error.message : 'Prose could not answer.')
    }
    return { result: (reply as { result?: unknown }).result ?? null }
  }

  async close(): Promise<void> {
    await this.handler.close().catch(() => {})
  }
}
