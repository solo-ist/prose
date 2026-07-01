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
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('user', { id: session.user.id, email: session.user.email })
  await next()
}
