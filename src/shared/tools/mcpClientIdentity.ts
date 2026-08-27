import type { ReviewAttribution } from './types'

/** The label used when an MCP client does not provide a usable name. */
export const MCP_FALLBACK_CLIENT_NAME = 'MCP client'

/** Keep client-provided text bounded and safe for persisted/UI attribution. */
const MAX_CLIENT_NAME_LENGTH = 64
const SAFE_CLIENT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._():+'-]{0,63}$/u

/**
 * The identity carried alongside an MCP tool call. It is deliberately kept
 * separate from the tool's user-controlled arguments.
 */
export interface McpClientIdentity {
  /** Canonical, validated client name without the `(MCP)` display suffix. */
  name: string
}

/**
 * Normalize the name reported by the MCP initialization handshake.
 *
 * The result is safe to persist and stable across common Codex/Claude client
 * names while retaining a useful label for other clients.
 */
export function normalizeMcpClientIdentity(value: unknown): McpClientIdentity {
  const rawName = value && typeof value === 'object' && 'name' in value
    ? (value as { name?: unknown }).name
    : value

  if (typeof rawName !== 'string') {
    return { name: MCP_FALLBACK_CLIENT_NAME }
  }

  const name = rawName
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/\s+\(mcp\)$/iu, '')

  if (
    !name ||
    name.length > MAX_CLIENT_NAME_LENGTH ||
    !SAFE_CLIENT_NAME.test(name)
  ) {
    return { name: MCP_FALLBACK_CLIENT_NAME }
  }

  if (/\bcodex\b/iu.test(name)) return { name: 'Codex' }
  if (/\bclaude\b/iu.test(name)) return { name: 'Claude' }
  return { name }
}

/** Convert a normalized identity into the user-facing review label. */
export function getMcpClientLabel(value: unknown): string {
  const identity = normalizeMcpClientIdentity(value)
  return identity.name === MCP_FALLBACK_CLIENT_NAME
    ? MCP_FALLBACK_CLIENT_NAME
    : `${identity.name} (MCP)`
}

/** Build trusted review attribution for an MCP invocation. */
export function createMcpReviewAttribution(
  clientIdentity: unknown,
  requestId: string,
): ReviewAttribution {
  const label = getMcpClientLabel(clientIdentity)
  return {
    actor: 'assistant',
    origin: 'mcp',
    label,
    model: label,
    requestId,
  }
}

/** Recognise legacy and current MCP display labels in persisted provenance. */
export function isMcpAttributionLabel(value: unknown): boolean {
  return typeof value === 'string' && /^.+ \(MCP\)$/u.test(value.trim())
}
