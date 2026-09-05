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
    let entitled: boolean
    try {
      entitled = await hasEntitlement(user.id, feature)
    } catch (err) {
      // A DB error must read as an outage (503), not as a denial (403).
      console.error('[entitlement] lookup failed:', err)
      return c.json({ error: 'service_unavailable' }, 503)
    }
    if (!entitled) {
      return c.json({ error: 'forbidden', feature }, 403)
    }
    await next()
  }
}
