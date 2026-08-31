/**
 * ipRateLimit.ts — sliding-window rate limit keyed on client IP, for PUBLIC
 * routes (anonymous share comments) where no session exists. Same in-memory
 * posture as rateLimit.ts: Phase 0 runs one instance; the shared-store seam
 * opens with multi-instance scaling.
 */
import type { MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  // Render fronts the service with a proxy that sets X-Forwarded-For; the
  // FIRST hop it appends is trustworthy on Render (client-supplied entries
  // precede it, so take the LAST address).
  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function ipRateLimit(maxPerWindow: number, windowS: number): MiddlewareHandler {
  const windowMs = windowS * 1000
  // Per-INSTANCE bucket — the app-level /s/* limiter and the stricter
  // comment-write limiter must not share counts.
  const hits = new Map<string, number[]>()
  return async (c, next) => {
    const ip = clientIp(c)
    const now = Date.now()
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)

    if (recent.length >= maxPerWindow) {
      const retryAfterS = Math.max(Math.ceil((recent[0] + windowMs - now) / 1000), 1)
      c.header('Retry-After', String(retryAfterS))
      return c.json({ error: 'rate_limited', retryAfter: retryAfterS }, 429)
    }

    recent.push(now)
    hits.set(ip, recent)

    if (hits.size > 5000) {
      for (const [key, ts] of hits) {
        if (ts.every((t) => now - t >= windowMs)) hits.delete(key)
      }
    }

    await next()
  }
}
