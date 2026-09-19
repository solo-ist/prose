/**
 * app.ts — the Hono application factory. Wiring order:
 *   secure headers → cors → Better Auth (/api/auth/*) → health
 *   → gated LLM proxy (/api/llm/*) → gated share management (/api/share/*)
 *   → public share surface (/s/*)
 */
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { config } from './config.js'
import { bodyLimit } from 'hono/body-limit'
import { corsMiddleware } from './middleware/cors.js'
import { requireSession, type AppEnv } from './middleware/session.js'
import { requireEntitlement } from './middleware/entitlement.js'
import { rateLimit, userRateLimit } from './middleware/rateLimit.js'
import { ipRateLimit } from './middleware/ipRateLimit.js'
import { auth } from './auth/index.js'
import health from './routes/health.js'
import { llmRoutes } from './routes/llm/stream.js'
import { shareAuthorRoutes } from './routes/share/author.js'
import { sharePublicRoutes } from './routes/share/public.js'
import { MAX_ARTIFACT_BYTES } from './routes/share/common.js'

export function createApp() {
  const app = new Hono<AppEnv>()

  // Dev-only request log. Share capability tokens are redacted from the path
  // (the raw token must never be logged); production logging is the
  // platform's concern.
  if (config.NODE_ENV === 'development') {
    app.use('*', async (c, next) => {
      const started = Date.now()
      await next()
      const path = c.req.path.replace(/^\/s\/[^/]+/, '/s/<token>')
      console.log(`[gateway] ${c.req.method} ${path} -> ${c.res.status} (${Date.now() - started}ms)`)
    })
  }

  // 2y HSTS (the gateway is TLS-only in every deployed environment).
  // xFrameOptions DENY globally: API responses are never framed, and served
  // share artifacts (#768) must not be — secureHeaders runs on unwind, so it
  // would overwrite a weaker per-route value anyway.
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains',
      xFrameOptions: 'DENY',
    })
  )

  // Origin isolation (#902): served share pages are author-controlled
  // HTML+JS by design, so when SHARE_BASE_URL is set they live on a
  // dedicated cookie-less host. The share host serves ONLY /s/* (+ health) —
  // artifact JS finds no API and no session there, and the two origins'
  // localStorage never mix. The API host redirects artifact PAGE loads to
  // the share host; the JSON comment sub-routes stay dual-host so file://
  // copies baked before the split keep publishing (they're capability-gated
  // and cookie-free — serving them on either host executes nothing).
  const shareHost = (() => {
    if (!config.SHARE_BASE_URL) return null
    const host = new URL(config.SHARE_BASE_URL).host
    if (host === new URL(config.BETTER_AUTH_URL).host) {
      console.warn('[app] SHARE_BASE_URL matches the API host — origin isolation disabled')
      return null
    }
    return host
  })()
  if (shareHost) {
    const shareBase = config.SHARE_BASE_URL!.replace(/\/$/, '')
    const ARTIFACT_PAGE = /^\/s\/[^/]+$/
    app.use('*', async (c, next) => {
      const host = c.req.header('host')
      const path = c.req.path
      if (host === shareHost) {
        if (!path.startsWith('/s/') && path !== '/health') {
          return c.text('Not found', 404)
        }
      } else if (ARTIFACT_PAGE.test(path) && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
        return c.redirect(shareBase + path, 308)
      }
      await next()
    })
  }

  app.use('/api/*', corsMiddleware)

  // Better Auth owns all /api/auth/* routes (magic-link, session, sign-out…).
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  // Public liveness/DB probe.
  app.route('/', health)

  // Gated LLM proxy: session + ai_proxy entitlement + per-user rate limit,
  // all enforced before the handler opens an upstream connection. bodyLimit
  // runs first so an oversized POST is rejected before c.req.json() buffers
  // it; 1 MiB covers MAX_TOTAL_CONTENT_CHARS worst-case (multi-byte + JSON
  // escaping) while bounding memory on the 512MB instance.
  app.use(
    '/api/llm/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    requireSession,
    requireEntitlement('ai_proxy'),
    rateLimit
  )
  app.route('/api/llm', llmRoutes)

  // Gated share management (#768): publish/re-publish/list/comments/revoke.
  // The artifact ceiling covers image-fattened exports; the JSON envelope
  // roughly doubles the raw HTML bytes. Its OWN rate bucket — sharing the
  // LLM proxy's 20/min starved conversation migrations (one write per
  // thread/reply/resolve in a burst) and then 429'd the re-publish itself.
  app.use(
    '/api/share/*',
    bodyLimit({
      maxSize: MAX_ARTIFACT_BYTES * 2,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    requireSession,
    requireEntitlement('share_publish'),
    userRateLimit(config.SHARE_RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_S)
  )
  app.route('/api/share', shareAuthorRoutes)

  // Public share surface (#768): artifact serving + anonymous reviewer
  // comments. No session — per-IP rate limit only (~10 comments/min).
  // The GET is limited too (generously) to blunt token brute-forcing.
  app.use(
    '/s/*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    ipRateLimit(60, 60)
  )
  app.route('/s', sharePublicRoutes)

  return app
}
