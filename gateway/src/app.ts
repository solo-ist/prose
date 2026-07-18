/**
 * app.ts — the Hono application factory. Wiring order:
 *   secure headers → cors → Better Auth (/api/auth/*) → health → gated LLM proxy (/api/llm/*)
 */
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { corsMiddleware } from './middleware/cors.js'
import { requireSession, type AppEnv } from './middleware/session.js'
import { requireEntitlement } from './middleware/entitlement.js'
import { rateLimit } from './middleware/rateLimit.js'
import { auth } from './auth/index.js'
import health from './routes/health.js'
import { llmRoutes } from './routes/llm/stream.js'

export function createApp() {
  const app = new Hono<AppEnv>()

  // 2y HSTS (the gateway is TLS-only in every deployed environment).
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    })
  )
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

  return app
}
