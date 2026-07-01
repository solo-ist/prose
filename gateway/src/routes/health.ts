/**
 * health.ts — GET /health. Liveness + DB connectivity probe.
 * The DB ping is wired once Prisma lands (Phase 0 auth step); until then
 * it reports "unconfigured".
 */
import { Hono } from 'hono'
import { config } from '../config.js'
import { pingDb } from '../db/index.js'

const health = new Hono()

health.get('/health', async (c) => {
  const dbStatus = await pingDb()
  return c.json({
    ok: dbStatus !== 'error',
    service: 'prose-gateway',
    env: config.NODE_ENV,
    dbStatus,
  })
})

export default health
