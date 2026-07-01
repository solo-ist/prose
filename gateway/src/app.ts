/**
 * app.ts — the Hono application factory. Wiring order:
 *   cors → Better Auth (/api/auth/*) → health → gated LLM proxy (/api/llm/*)
 */
import { Hono } from 'hono'
import { corsMiddleware } from './middleware/cors.js'
import { requireSession, type AppEnv } from './middleware/session.js'
import { requireEntitlement } from './middleware/entitlement.js'
import { auth } from './auth/index.js'
import health from './routes/health.js'
import { llmRoutes } from './routes/llm/stream.js'

export function createApp() {
  const app = new Hono<AppEnv>()

  app.use('/api/*', corsMiddleware)

  // Better Auth owns all /api/auth/* routes (magic-link, session, sign-out…).
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  // Public liveness/DB probe.
  app.route('/', health)

  // Gated LLM proxy: session + ai_proxy entitlement enforced before the handler.
  app.use('/api/llm/*', requireSession, requireEntitlement('ai_proxy'))
  app.route('/api/llm', llmRoutes)

  return app
}
