/**
 * index.ts — gateway entry point. Migrations run via `prisma migrate deploy`
 * in the start command (package.json / Dockerfile) BEFORE this process serves,
 * so a migration failure exits non-zero rather than serving a partial schema.
 */
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { config } from './config.js'
import { createApp } from './app.js'

const app = createApp()

const server = serve({ fetch: app.fetch, port: config.GATEWAY_PORT }, (info) => {
  console.log(`[gateway] listening on http://localhost:${info.port} (env=${config.NODE_ENV})`)
})

// Long-lived SSE: Anthropic streams can run for minutes. Render allows 100-min
// responses; keep Node's timeouts well above the default 5s idle keep-alive.
const httpServer = server as unknown as { keepAliveTimeout: number; headersTimeout: number }
httpServer.keepAliveTimeout = 120_000
httpServer.headersTimeout = 125_000
