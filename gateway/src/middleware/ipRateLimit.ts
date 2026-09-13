/**
 * ipRateLimit.ts — sliding-window rate limit keyed on client IP, for PUBLIC
 * routes (anonymous share comments) where no session exists. Same in-memory
 * posture as rateLimit.ts: Phase 0 runs one instance; the shared-store seam
 * opens with multi-instance scaling.
 */
import type { MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

// A plausible IPv4/IPv6 literal — a defense-in-depth gate on the XFF entry
// we key rate limits on (a junk value falls through to the socket address).
const IP_SHAPE = /^[0-9a-fA-F.:]{2,45}$/

function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  // Trust direction VERIFIED against Render's docs (PR #901 review finding):
  // Render APPENDS to any passed-in X-Forwarded-For and never clears it —
  // https://feedback.render.com/features/p/send-the-correct-x-forwarded-for /
  // community "Accessing client IPs" guidance. The LAST entry is therefore
  // proxy-observed and unspoofable; client-supplied entries precede it. At
  // worst (an upstream CDN hop in front) the last entry over-aggregates to
  // the edge's IP — never to a client-chosen value. If the deployment ever
  // moves to a PREPENDING proxy, this must flip to counted right-to-left
  // hops — re-verify, don't assume.
  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last && IP_SHAPE.test(last)) return last
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
