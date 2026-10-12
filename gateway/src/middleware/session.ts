/**
 * session.ts — requireSession middleware. Validates the Better Auth session
 * cookie and stashes a minimal user on the context. 401 when absent.
 */
import type { MiddlewareHandler } from 'hono'
import { auth } from '../auth/index.js'

export type SessionUser = { id: string; email: string }

/** Shared Hono env: routes behind requireSession can read `c.get('user')`. */
export type AppEnv = { Variables: { user: SessionUser } }

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers })
  } catch (err) {
    // A DB hiccup is a transient outage, not an auth verdict — 503, never 500.
    console.error('[session] getSession failed:', err)
    return c.json({ error: 'service_unavailable' }, 503)
  }
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('user', { id: session.user.id, email: session.user.email })
  await next()
}
