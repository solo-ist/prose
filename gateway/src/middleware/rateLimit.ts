/**
 * rateLimit.ts — per-user sliding-window rate limits, one independent bucket
 * per userRateLimit() instance. Runs AFTER requireSession (keyed on user id),
 * so ceilings apply to entitled users too.
 *
 * `rateLimit` is the LLM proxy's instance: it meters the OPERATOR's Anthropic
 * spend, so its ceiling is deliberately low. The share surface gets its own,
 * larger bucket in app.ts — comment rows are tiny writes, and a
 * revoke→republish conversation migration legitimately bursts one write per
 * thread/reply/resolve plus the re-bake PUT.
 *
 * In-memory on purpose: Phase 0 deploys exactly one Render instance. The
 * shared-store seam (Redis) opens with multi-instance scaling in Phase 4
 * (#770), behind this same middleware signature.
 */
import type { MiddlewareHandler } from 'hono'
import { config } from '../config.js'
import type { AppEnv } from './session.js'

export function userRateLimit(max: number, windowS: number): MiddlewareHandler<AppEnv> {
  const windowMs = windowS * 1000
  /** userId → timestamps (ms) of requests inside the current window. */
  const hits = new Map<string, number[]>()

  return async (c, next) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const now = Date.now()
    const recent = (hits.get(user.id) ?? []).filter((t) => now - t < windowMs)

    if (recent.length >= max) {
      const retryAfterS = Math.ceil((recent[0] + windowMs - now) / 1000)
      c.header('Retry-After', String(Math.max(retryAfterS, 1)))
      return c.json({ error: 'rate_limited', retryAfter: Math.max(retryAfterS, 1) }, 429)
    }

    recent.push(now)
    hits.set(user.id, recent)

    // Opportunistic sweep so idle users don't accumulate forever.
    if (hits.size > 1000) {
      for (const [id, ts] of hits) {
        if (ts.every((t) => now - t >= windowMs)) hits.delete(id)
      }
    }

    await next()
  }
}

export const rateLimit = userRateLimit(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_S)
