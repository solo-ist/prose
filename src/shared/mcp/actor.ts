/**
 * Who an MCP call is from (#1236). Main builds the actor — from the
 * connection a bearer token resolved to (HTTP), or from the stdio bridge's
 * `clientInfo` — and sends it to the renderer beside the call; the renderer
 * accepts it only through `mcpActorFrom` and never reads identity from tool
 * arguments. Everything a client says about itself is cleaned and shown
 * beside the connection's label, never instead of it.
 */

import { cleanActorText, clientDisplayName, type McpAgentActor } from '../review/actor'

/** What a client reports about itself (`clientInfo`). Untrusted. */
export interface McpClientInfo {
  name?: unknown
  version?: unknown
}

/** The per-launch token's connection (the bundled stdio bridge, or HTTP with that token). */
export const LAUNCH_CONNECTION_ID = 'launch'
export const DEFAULT_CONNECTION_LABEL = 'MCP client'

const VIAS = ['stdio', 'http', 'relay'] as const

function withClient(actor: McpAgentActor, client: McpClientInfo | undefined): McpAgentActor {
  const name = cleanActorText(client?.name)
  const version = cleanActorText(client?.version)
  return {
    ...actor,
    ...(name ? { client: name } : {}),
    ...(version ? { clientVersion: version } : {})
  }
}

/** An HTTP call made with a connection's token. */
export function connectionActor(
  connection: { id: string; label: string },
  via: 'http' | 'relay',
  client?: McpClientInfo
): McpAgentActor {
  return withClient(
    { kind: 'mcp-agent', connectionId: connection.id, connectionLabel: cleanActorText(connection.label) || DEFAULT_CONNECTION_LABEL, via },
    client
  )
}

/** A call made with the per-launch token: over stdio it is labelled with the client's own name, as a writer knows it. */
export function launchActor(via: 'stdio' | 'http', client?: McpClientInfo): McpAgentActor {
  const label = via === 'stdio' ? clientDisplayName(client?.name) || DEFAULT_CONNECTION_LABEL : DEFAULT_CONNECTION_LABEL
  return withClient({ kind: 'mcp-agent', connectionId: LAUNCH_CONNECTION_ID, connectionLabel: label, via }, client)
}

/**
 * The actor main sent with an MCP call, re-validated on the renderer's side
 * of the IPC boundary: only an `mcp-agent` with clean strings gets through.
 */
export function mcpActorFrom(value: unknown): McpAgentActor | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.kind !== 'mcp-agent') return null
  const connectionId = cleanActorText(v.connectionId)
  if (!connectionId) return null
  const actor: McpAgentActor = {
    kind: 'mcp-agent',
    connectionId,
    connectionLabel: cleanActorText(v.connectionLabel) || DEFAULT_CONNECTION_LABEL
  }
  for (const key of ['client', 'clientVersion', 'model'] as const) {
    const text = cleanActorText(v[key])
    if (text) actor[key] = text
  }
  if ((VIAS as readonly unknown[]).includes(v.via)) actor.via = v.via as McpAgentActor['via']
  return actor
}
