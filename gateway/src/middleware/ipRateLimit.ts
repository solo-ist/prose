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
  // written by Render (the hop directly in front of this app) and is never
  // a client-chosen value.
  //
  // TOPOLOGY DEPENDENCE — re-verify on ANY infra change: this holds only
  // while Render is the hop directly in front of the app. Put a CDN in
  // front (Cloudflare/Fastly) and the last entry becomes the CDN's egress
  // IP — still not client-spoofable (Render still appends last), but rate
  // limits collapse onto shared CDN IPs. In that world, switch to counting
  // right-to-left past the KNOWN proxy hops, or key on the CDN's canonical
  // client header (e.g. CF-Connecting-IP) after verifying the CDN strips
  // client-supplied copies of it. A PREPENDING proxy instead of Render
  // would make the last entry client-controlled — never assume, re-verify.
  // Keys are lowercased so IPv6 case variants share a bucket. Full IPv6
  // canonicalization is unnecessary here: the entry we key on is written by
  // the proxy (append-trust above), so a client can't alternate forms.
  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last && IP_SHAPE.test(last)) return last.toLowerCase()
  }
  try {
    return (getConnInfo(c).remote.address ?? fallbackBucket()).toLowerCase()
  } catch {
    return fallbackBucket()
  }
}

// When no IP is resolvable, everyone shares ONE bucket — deliberately
// conservative (a stricter shared allowance, not a bypass), but it would
// throttle legitimate traffic if it ever fired in production, so make the
// condition observable the first time it happens.
let warnedUnknownIp = false
function fallbackBucket(): string {
  if (!warnedUnknownIp) {
    warnedUnknownIp = true
    console.warn('[ipRateLimit] client IP unresolvable — sharing the "unknown" bucket (all such callers throttle together)')
  }
  return 'unknown'
}

export function ipRateLimit(maxPerWindow: number, windowS: number): MiddlewareHandler {
  const windowMs = windowS * 1000
  // Per-INSTANCE bucket — the app-level /s/* limiter and the stricter
  // comment-write limiter must not share counts.
  const hits = new Map<string, number[]>()
  let lastSweep = Date.now()
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

    // Sweep fully-expired entries once per window (plus immediately above
    // 5000 keys) — the old size-only trigger let a slow trickle of unique
    // IPs sit in the map forever below the threshold. (Addendum review.)
    if (hits.size > 5000 || now - lastSweep >= windowMs) {
      lastSweep = now
      for (const [key, ts] of hits) {
        if (ts.every((t) => now - t >= windowMs)) hits.delete(key)
      }
    }

    await next()
  }
}
