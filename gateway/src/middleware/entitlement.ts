/**
 * entitlement.ts — requireEntitlement(feature) middleware. Runs AFTER
 * requireSession; 403s an authenticated-but-unentitled user BEFORE any
 * upstream (Anthropic) connection opens. Never an ungated proxy.
 */
import type { MiddlewareHandler } from 'hono'
import { hasEntitlement } from '../entitlements/index.js'
import type { AppEnv } from './session.js'

export function requireEntitlement(feature: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!(await hasEntitlement(user.id, feature))) {
      return c.json({ error: 'forbidden', feature }, 403)
    }
    await next()
  }
}
