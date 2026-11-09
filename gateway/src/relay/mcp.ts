/**
 * relay/mcp.ts — `POST /mcp`, the relay's one protected resource (#1238,
 * design §3–§5): Streamable HTTP, answering JSON, for ChatGPT and claude.ai.
 *
 * Each request is authorized here, then forwarded in memory to the token's
 * account's live desktop (hub.ts) and answered with the desktop's reply.
 * Nothing is stored and nothing queues: with no desktop connected the client
 * gets "Prose is not running". Stateless, so no session id and no
 * server-initiated stream (GET and DELETE answer 405).
 *
 * The bearer token is the only credential; cookies are never read on this
 * route and no CORS headers are sent, so a web page can't drive it with the
 * writer's browser session.
 */
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { auth } from '../auth/index.js'
import { OAUTH_SCOPES } from '../auth/oauth.js'
import { config, gatewayOrigin, mcpResourceUrl } from '../config.js'
import { prisma } from '../db/index.js'
import { NOT_RUNNING_MESSAGE, RELAY_ERROR, relayHub, type RelayClient, type RelayHub } from './hub.js'
import { SlidingWindow } from './limits.js'
import { logCall } from './log.js'
import { relayScopesOf, toolsForScopes, type RelayScope } from './scopes.js'

/** Requests to the desktop are capped at 1 MiB (§4). */
export const MAX_REQUEST_BYTES = 1024 * 1024

/** RFC 9728 metadata URL for the resource (path-inserted). */
export const protectedResourceMetadataUrl = `${gatewayOrigin}/.well-known/oauth-protected-resource${new URL(mcpResourceUrl).pathname}`

const CHALLENGE_SCOPE = OAUTH_SCOPES.join(' ')

/** The SEP-2243 standard request headers the desktop's MCP handler checks; nothing else is forwarded. */
const FORWARDED_HEADERS = ['mcp-protocol-version', 'mcp-method', 'mcp-name']
const PARAM_HEADER_PREFIX = 'mcp-param-'
const MAX_PARAM_HEADERS = 32
const MAX_HEADER_VALUE = 8 * 1024

type JsonRpcId = string | number

function rpcError(c: Context, id: JsonRpcId | null, code: number, message: string, status: 200 | 400 | 413 | 429 = 200) {
  return c.json({ jsonrpc: '2.0', id, error: { code, message } }, status)
}

/** 401 with the RFC 9728 pointer, so the client starts (or restarts) discovery. */
function challenge(c: Context, error?: 'invalid_token', description?: string) {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl}"`, `scope="${CHALLENGE_SCOPE}"`]
  if (error) parts.unshift(`error="${error}"`, `error_description="${description ?? 'The access token is invalid'}"`)
  c.header('WWW-Authenticate', `Bearer ${parts.join(', ')}`)
  c.header('Cache-Control', 'no-store')
  return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Unauthorized' } }, 401)
}

/** Who a request is from, once its token checks out. */
interface Caller {
  userId: string
  client: RelayClient
  scopes: RelayScope[]
}

type Verdict = { ok: true; caller: Caller } | { ok: false; response: Response }

async function authorize(c: Context): Promise<Verdict> {
  const header = c.req.header('authorization') ?? ''
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header)
  if (!match) return { ok: false, response: challenge(c) }
  let payload: Record<string, unknown>
  try {
    ;({ payload } = await auth.api.verifyRelayAccessToken({ body: { token: match[1] } }))
  } catch (err) {
    console.error('[relay] token check failed:', err instanceof Error ? err.message : 'unknown error')
    return { ok: false, response: c.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Service unavailable' } }, 503) }
  }
  if (payload.active !== true) return { ok: false, response: challenge(c, 'invalid_token') }
  // Audience binding (RFC 8707): the token must name this resource.
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.includes(mcpResourceUrl)) {
    return { ok: false, response: challenge(c, 'invalid_token', 'The access token is not for this resource') }
  }
  const userId = typeof payload.sub === 'string' ? payload.sub : ''
  const clientId = typeof payload.client_id === 'string' ? payload.client_id : ''
  if (!userId || !clientId) return { ok: false, response: challenge(c, 'invalid_token') }
  const scopes = relayScopesOf(typeof payload.scope === 'string' ? payload.scope : '')
  if (scopes.length === 0) {
    c.header(
      'WWW-Authenticate',
      `Bearer error="insufficient_scope", scope="read", resource_metadata="${protectedResourceMetadataUrl}"`
    )
    return { ok: false, response: c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Insufficient scope' } }, 403) }
  }
  const row = await prisma.oauthClient.findUnique({
    where: { clientId },
    select: { name: true, clientDiscoveryId: true },
  })
  if (!row) return { ok: false, response: challenge(c, 'invalid_token') }
  return {
    ok: true,
    caller: {
      userId,
      // CIMD clients proved their client_id URL's domain; DCR clients named themselves.
      client: { id: clientId, name: row.name?.trim() || clientId, verified: row.clientDiscoveryId === 'cimd' },
      scopes,
    },
  }
}

function forwardedHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  let params = 0
  headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (value.length > MAX_HEADER_VALUE) return
    if (FORWARDED_HEADERS.includes(name)) out[name] = value
    else if (name.startsWith(PARAM_HEADER_PREFIX) && params < MAX_PARAM_HEADERS) {
      params++
      out[name] = value
    }
  })
  return out
}

/** Keep only the tools this token's scopes reach, whatever the desktop listed. */
function filterToolList(result: unknown, allowed: Set<string>): unknown {
  if (!result || typeof result !== 'object' || !Array.isArray((result as { tools?: unknown }).tools)) return result
  const r = result as { tools: Array<{ name?: unknown }> }
  return { ...r, tools: r.tools.filter((t) => typeof t?.name === 'string' && allowed.has(t.name)) }
}

export function relayMcpRoutes(hub: RelayHub = relayHub) {
  const routes = new Hono()
  const perAccount = new SlidingWindow(config.RELAY_ACCOUNT_RATE_MAX, 60_000)
  const perClient = new SlidingWindow(config.RELAY_CLIENT_RATE_MAX, 60_000)
  const timeoutMs = config.RELAY_CALL_TIMEOUT_S * 1000

  routes.on(['GET', 'DELETE'], '/mcp', (c) => {
    c.header('Allow', 'POST')
    return c.body(null, 405)
  })

  routes.post(
    '/mcp',
    bodyLimit({
      maxSize: MAX_REQUEST_BYTES,
      onError: (c) => rpcError(c, null, -32600, 'Request too large (the relay accepts up to 1 MiB)', 413),
    }),
    async (c) => {
      const started = Date.now()
      const verdict = await authorize(c)
      if (!verdict.ok) return verdict.response
      const { caller } = verdict
      const log = { account: caller.userId, client: caller.client.id }

      const retryAccount = perAccount.hit(caller.userId)
      const retryClient = retryAccount ? 0 : perClient.hit(`${caller.userId} ${caller.client.id}`)
      if (retryAccount || retryClient) {
        c.header('Retry-After', String(retryAccount || retryClient))
        logCall({ ...log, method: '-', ms: Date.now() - started, inBytes: 0, outBytes: 0, outcome: 'rate_limited' })
        return rpcError(c, null, -32000, 'Too many requests. Try again shortly.', 429)
      }

      const raw = await c.req.text()
      const inBytes = Buffer.byteLength(raw)
      let message: unknown
      try {
        message = JSON.parse(raw)
      } catch {
        return rpcError(c, null, -32700, 'Parse error', 400)
      }
      if (Array.isArray(message)) return rpcError(c, null, -32600, 'Batch requests are not supported', 400)
      if (!message || typeof message !== 'object') return rpcError(c, null, -32600, 'Invalid request', 400)
      const msg = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
      if (msg.jsonrpc !== '2.0') return rpcError(c, null, -32600, 'Invalid request', 400)
      // A notification or a response to the server: accepted, nothing to forward (stateless).
      if (typeof msg.method !== 'string' || msg.id === undefined) return c.body(null, 202)
      if (typeof msg.id !== 'string' && typeof msg.id !== 'number') return rpcError(c, null, -32600, 'Invalid request id', 400)
      const id = msg.id
      const method = msg.method.slice(0, 128)
      if (msg.params !== undefined && (msg.params === null || typeof msg.params !== 'object')) {
        return rpcError(c, id, -32602, 'Invalid params')
      }

      const allowed = toolsForScopes(caller.scopes)
      let tool: string | undefined
      if (method === 'tools/call') {
        const name = (msg.params as { name?: unknown } | undefined)?.name
        tool = typeof name === 'string' ? name : undefined
        if (!tool || !allowed.has(tool)) {
          logCall({ ...log, method, tool: tool && allowed.has(tool) ? tool : undefined, ms: Date.now() - started, inBytes, outBytes: 0, outcome: 'refused_scope' })
          return rpcError(
            c,
            id,
            -32602,
            `This connection can't use ${tool ? `"${tool.slice(0, 64)}"` : 'that tool'}. Remote clients get the tools for the documents open in Prose that the writer allowed (read, propose, comment).`
          )
        }
      }

      const outcome = await hub.call(
        caller.userId,
        {
          client: caller.client,
          scopes: caller.scopes,
          method,
          ...(msg.params !== undefined ? { params: msg.params } : {}),
          headers: forwardedHeaders(c.req.raw.headers),
        },
        timeoutMs
      )

      const ms = Date.now() - started
      if (outcome.kind === 'not_running') {
        logCall({ ...log, method, tool, ms, inBytes, outBytes: 0, outcome: 'not_running' })
        return rpcError(c, id, RELAY_ERROR.NOT_RUNNING, NOT_RUNNING_MESSAGE)
      }
      if (outcome.kind === 'error') {
        logCall({ ...log, method, tool, ms, inBytes, outBytes: outcome.bytes, outcome: outcome.reason === 'desktop' ? 'error' : outcome.reason })
        return rpcError(c, id, outcome.error.code, outcome.error.message)
      }
      logCall({ ...log, method, tool, ms, inBytes, outBytes: outcome.bytes, outcome: 'ok' })
      const result = method === 'tools/list' ? filterToolList(outcome.result, allowed) : outcome.result
      c.header('Cache-Control', 'no-store')
      return c.json({ jsonrpc: '2.0', id, result })
    }
  )

  return routes
}
