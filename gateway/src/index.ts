/**
 * index.ts — gateway entry point. Migrations run via `prisma migrate deploy`
 * in the start command (package.json / Dockerfile) BEFORE this process serves,
 * so a migration failure exits non-zero rather than serving a partial schema.
 */
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { config, port } from './config.js'
import { createApp } from './app.js'
import { prisma } from './db/index.js'
import { hashShareToken } from './routes/share/common.js'

const app = createApp()

// One-shot sweep: hash any legacy PLAINTEXT editTokens (rows created before
// tokens were hashed at birth; a row only upgraded on PATCH would otherwise
// keep its raw capability in the DB forever — PR #901 round 11). Comparison
// distinguishes formats unambiguously (raw = 32 base64url chars, hashed =
// 64 hex), so this is safe to run on every boot; after one pass it finds
// nothing. Best-effort and non-blocking: a failure just retries next boot.
void (async () => {
  try {
    const rows = await prisma.shareComment.findMany({
      where: { editToken: { not: null } },
      select: { id: true, editToken: true },
    })
    const legacy = rows.filter((r) => r.editToken && !/^[0-9a-f]{64}$/.test(r.editToken))
    for (const r of legacy) {
      await prisma.shareComment.update({
        where: { id: r.id },
        data: { editToken: hashShareToken(r.editToken as string) },
      })
    }
    if (legacy.length > 0) console.log(`[share] hashed ${legacy.length} legacy editToken row(s)`)
  } catch (err) {
    console.error('[share] legacy editToken sweep failed (will retry next boot)', err)
  }
})()

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[gateway] listening on http://localhost:${info.port} (env=${config.NODE_ENV})`)
})

// Long-lived SSE: Anthropic streams can run for minutes. Render allows 100-min
// responses; keep Node's timeouts well above the default 5s idle keep-alive.
const httpServer = server as unknown as { keepAliveTimeout: number; headersTimeout: number }
httpServer.keepAliveTimeout = 120_000
httpServer.headersTimeout = 125_000
