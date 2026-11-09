/**
 * relay/revoke.ts — `POST /api/relay/revoke {clientId}` (#1238, design §6
 * "Revoke"): the desktop calls this when the writer removes a remote
 * connection. Every access and refresh token the account holds for that
 * client is marked revoked and the consent is deleted, in one transaction, so
 * the client's next `/mcp` call gets 401 and its refresh token can't be
 * exchanged; reconnecting means signing in and consenting again. Scoped to
 * the session's own account: a writer can only revoke their own grants.
 */
import { Hono } from 'hono'
import { prisma } from '../db/index.js'
import type { AppEnv } from '../middleware/session.js'
import { safeId } from './log.js'

export const relayRevokeRoutes = new Hono<AppEnv>()

relayRevokeRoutes.post('/revoke', async (c) => {
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
    return c.json({ error: 'unsupported_media_type' }, 415)
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const clientId = (body as { clientId?: unknown } | null)?.clientId
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 2048) {
    return c.json({ error: 'invalid_client_id' }, 400)
  }
  const userId = c.get('user').id
  const now = new Date()
  try {
    const [access, refresh, consents] = await prisma.$transaction([
      prisma.oauthAccessToken.updateMany({ where: { userId, clientId, revoked: null }, data: { revoked: now } }),
      prisma.oauthRefreshToken.updateMany({ where: { userId, clientId, revoked: null }, data: { revoked: now } }),
      prisma.oauthConsent.deleteMany({ where: { userId, clientId } }),
    ])
    console.log(
      `[relay] revoked account=${userId} client=${safeId(clientId)} access=${access.count} refresh=${refresh.count} consents=${consents.count}`
    )
    return c.json({ revoked: { accessTokens: access.count, refreshTokens: refresh.count, consents: consents.count } })
  } catch (err) {
    console.error('[relay] revoke failed:', err instanceof Error ? err.message : 'unknown error')
    return c.json({ error: 'service_unavailable' }, 503)
  }
})
