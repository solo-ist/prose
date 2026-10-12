/**
 * health.ts — GET /health. Liveness + DB connectivity probe.
 * The DB ping is wired once Prisma lands (Phase 0 auth step); until then
 * it reports "unconfigured".
 */
import { Hono } from 'hono'
import { pingDb } from '../db/index.js'

const health = new Hono()

health.get('/health', async (c) => {
  // Unauthenticated: expose liveness only. env/dbStatus details stay in logs.
  const dbStatus = await pingDb()
  if (dbStatus === 'error') console.error('[health] db ping failed')
  return c.json({ ok: dbStatus !== 'error', service: 'prose-gateway' })
})

export default health
