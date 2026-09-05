/**
 * rateLimit.ts — per-user sliding-window rate limit for the LLM proxy. Runs
 * AFTER requireSession (keyed on user id), so the ceiling applies to entitled
 * users too: the proxy meters the OPERATOR's Anthropic spend.
 *
 * In-memory on purpose: Phase 0 deploys exactly one Render instance. The
 * shared-store seam (Redis) opens with multi-instance scaling in Phase 4
 * (#770), behind this same middleware signature.
 */
import type { MiddlewareHandler } from 'hono'
import { config } from '../config.js'
import type { AppEnv } from './session.js'

const WINDOW_MS = config.RATE_LIMIT_WINDOW_S * 1000

/** userId → timestamps (ms) of requests inside the current window. */
const hits = new Map<string, number[]>()

export const rateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const now = Date.now()
  const recent = (hits.get(user.id) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= config.RATE_LIMIT_MAX) {
    const retryAfterS = Math.ceil((recent[0] + WINDOW_MS - now) / 1000)
    c.header('Retry-After', String(Math.max(retryAfterS, 1)))
    return c.json({ error: 'rate_limited', retryAfter: Math.max(retryAfterS, 1) }, 429)
  }

  recent.push(now)
  hits.set(user.id, recent)

  // Opportunistic sweep so idle users don't accumulate forever.
  if (hits.size > 1000) {
    for (const [id, ts] of hits) {
      if (ts.every((t) => now - t >= WINDOW_MS)) hits.delete(id)
    }
  }

  await next()
}
