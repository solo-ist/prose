/**
 * relay/socket.ts — `GET /relay`, the WebSocket the signed-in desktop dials
 * out to (#1238, design §2 and §4). The writer's machine opens no port.
 *
 * Authenticated with the desktop's existing gateway session cookie. Refused
 * with an `Origin` header: browsers always send one on a WebSocket handshake,
 * and the writer's browser may hold a gateway session from the OAuth consent
 * flow, so without this a page the writer visits could connect as their
 * "desktop" and receive their remote calls. The desktop's Node client sends
 * none.
 *
 * The session is re-checked every ten minutes; a socket whose session was
 * signed out or expired is closed.
 */
import { Hono } from 'hono'
import { upgradeWebSocket } from '@hono/node-server'
import { prisma } from '../db/index.js'
import { ipRateLimit } from '../middleware/ipRateLimit.js'
import type { SessionUser } from '../middleware/session.js'
import { auth } from '../auth/index.js'
import { CLOSE_PROTOCOL, relayHub, type RelayDevice, type RelayHub } from './hub.js'

/** The desktop's stable per-install id: 16–64 base64url characters. */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/

const SESSION_RECHECK_MS = 10 * 60 * 1000
export const CLOSE_SESSION_ENDED = 4003

export function relaySocketRoutes(hub: RelayHub = relayHub) {
  const routes = new Hono<{ Variables: { user: SessionUser; sessionId: string } }>()

  routes.get(
    '/relay',
    ipRateLimit(30, 600),
    async (c, next) => {
      if (c.req.header('origin') !== undefined) return c.json({ error: 'forbidden' }, 403)
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'upgrade_required' }, 426)
      if (!DEVICE_ID_RE.test(c.req.query('device') ?? '')) return c.json({ error: 'invalid_device' }, 400)
      await next()
    },
    async (c, next) => {
      // requireSession's check, keeping the session row's id for the re-check.
      let session: Awaited<ReturnType<typeof auth.api.getSession>>
      try {
        session = await auth.api.getSession({ headers: c.req.raw.headers })
      } catch (err) {
        console.error('[relay] getSession failed:', err instanceof Error ? err.message : 'unknown error')
        return c.json({ error: 'service_unavailable' }, 503)
      }
      if (!session?.user) return c.json({ error: 'Unauthorized' }, 401)
      c.set('user', { id: session.user.id, email: session.user.email })
      c.set('sessionId', session.session.id)
      await next()
    },
    upgradeWebSocket((c) => {
      const user = c.get('user')
      const deviceId = c.req.query('device') as string
      const sessionId = c.get('sessionId')
      let device: RelayDevice | null = null
      let recheck: NodeJS.Timeout | null = null
      // ws reports an over-cap frame as an error, then drops the connection
      // without the closing handshake (the close code reads 1006).
      let oversized = false
      return {
        onOpen(_event, ws) {
          device = hub.attach(user.id, deviceId, {
            send: (data) => ws.send(data),
            close: (code, reason) => ws.close(code, reason),
          })
          console.log(`[relay] socket open account=${user.id} device=${deviceId.slice(0, 8)}… live=${hub.size}`)
          recheck = setInterval(async () => {
            const row = await prisma.session.findUnique({ where: { id: sessionId }, select: { expiresAt: true } }).catch(() => undefined)
            if (row === undefined) return // a DB hiccup is not a sign-out
            if (!row || row.expiresAt.getTime() < Date.now()) ws.close(CLOSE_SESSION_ENDED, 'session ended')
          }, SESSION_RECHECK_MS)
          recheck.unref()
        },
        onMessage(event, ws) {
          if (!device) return
          if (typeof event.data !== 'string') {
            ws.close(CLOSE_PROTOCOL, 'text frames only')
            return
          }
          hub.receive(device, event.data)
        },
        onError(event) {
          const code = ((event as { error?: { code?: unknown } }).error ?? {}).code
          if (code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') oversized = true
        },
        onClose(event) {
          if (recheck) clearInterval(recheck)
          if (!device) return
          hub.detach(device, oversized ? 1009 : event.code)
          console.log(`[relay] socket closed account=${user.id} device=${deviceId.slice(0, 8)}… code=${event.code} live=${hub.size}`)
          device = null
        },
      }
    })
  )

  return routes
}
