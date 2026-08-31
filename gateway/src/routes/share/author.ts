/**
 * routes/share/author.ts — authenticated share management (#768). Mounted at
 * /api/share behind requireSession + requireEntitlement('share_publish').
 *
 * Publish/re-publish store the self-contained artifact (see artifacts/) and
 * the hashed capability token. The raw token is returned ONCE from publish —
 * the server cannot reconstruct it later (only the desktop keeps it), so
 * re-publish and revoke are addressed by publication id.
 */
import { Hono } from 'hono'
import { prisma } from '../../db/index.js'
import { putArtifact, deleteArtifact } from '../../artifacts/index.js'
import type { AppEnv } from '../../middleware/session.js'
import {
  MAX_ARTIFACT_BYTES,
  MAX_TITLE_CHARS,
  newShareToken,
  publicComment,
  sanitizeField,
} from './common.js'
import { config } from '../../config.js'

/** Public origin the share URL should use (the gateway serves /s/*). */
function shareBase(): string {
  return config.BETTER_AUTH_URL.replace(/\/$/, '')
}

/** The artifact must be a Prose export — a cheap structural check, not a parse. */
function looksLikeProseArtifact(html: unknown): html is string {
  return (
    typeof html === 'string' &&
    html.length > 0 &&
    html.length <= MAX_ARTIFACT_BYTES &&
    html.includes('application/x-prose-markdown')
  )
}

export const shareAuthorRoutes = new Hono<AppEnv>()

shareAuthorRoutes.post('/publish', async (c) => {
  const user = c.get('user')
  let body: { title?: unknown; html?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }

  const title = sanitizeField(body.title, MAX_TITLE_CHARS)
  if (!title) return c.json({ error: 'title_required' }, 400)
  if (!looksLikeProseArtifact(body.html)) {
    return c.json({ error: 'invalid_artifact' }, 400)
  }

  const { token, tokenHash } = newShareToken()
  const pub = await prisma.publication.create({
    data: {
      tokenHash,
      authorId: user.id,
      title,
      publishRev: extractPublishRev(body.html) ?? 'unknown',
      // Storage fields land in the update below once the id exists (R2 keys
      // are namespaced by publication id).
    },
  })
  const stored = await putArtifact(pub.id, body.html)
  await prisma.publication.update({ where: { id: pub.id }, data: stored })

  return c.json(
    {
      publicationId: pub.id,
      shareUrl: `${shareBase()}/s/${token}`,
      publishRev: pub.publishRev,
      revCount: 1,
    },
    201
  )
})

shareAuthorRoutes.put('/:pubId/publish', async (c) => {
  const user = c.get('user')
  const pub = await prisma.publication.findUnique({ where: { id: c.req.param('pubId') } })
  if (!pub || pub.authorId !== user.id) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 409)

  let body: { title?: unknown; html?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  if (!looksLikeProseArtifact(body.html)) {
    return c.json({ error: 'invalid_artifact' }, 400)
  }
  const title = sanitizeField(body.title, MAX_TITLE_CHARS) || pub.title

  const stored = await putArtifact(pub.id, body.html)
  const updated = await prisma.publication.update({
    where: { id: pub.id },
    data: {
      ...stored,
      title,
      publishRev: extractPublishRev(body.html) ?? pub.publishRev,
      revCount: { increment: 1 },
    },
  })

  return c.json({
    publicationId: updated.id,
    publishRev: updated.publishRev,
    revCount: updated.revCount,
  })
})

shareAuthorRoutes.get('/', async (c) => {
  const user = c.get('user')
  const rows = await prisma.publication.findMany({
    where: { authorId: user.id },
    orderBy: { publishedAt: 'desc' },
    include: { _count: { select: { comments: true } } },
  })
  return c.json({
    publications: rows.map((p) => ({
      publicationId: p.id,
      title: p.title,
      publishRev: p.publishRev,
      revCount: p.revCount,
      publishedAt: p.publishedAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      revokedAt: p.revokedAt ? p.revokedAt.toISOString() : null,
      commentCount: p._count.comments,
    })),
  })
})

shareAuthorRoutes.get('/:pubId/comments', async (c) => {
  const user = c.get('user')
  const pub = await prisma.publication.findUnique({ where: { id: c.req.param('pubId') } })
  if (!pub || pub.authorId !== user.id) return c.json({ error: 'not_found' }, 404)

  const since = c.req.query('since')
  const sinceDate = since ? new Date(since) : null
  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    return c.json({ error: 'invalid_since' }, 400)
  }

  const rows = await prisma.shareComment.findMany({
    where: {
      publicationId: pub.id,
      ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  })

  // publicComment excludes authorEmail by construction — notification-only.
  return c.json({
    comments: rows.map(publicComment),
    nextCursor: rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null,
  })
})

shareAuthorRoutes.delete('/:pubId', async (c) => {
  const user = c.get('user')
  const pub = await prisma.publication.findUnique({ where: { id: c.req.param('pubId') } })
  if (!pub || pub.authorId !== user.id) return c.json({ error: 'not_found' }, 404)

  // Revoke: tombstone the row (410 on /s/), destroy the artifact, and delete
  // reviewer comments (privacy — their words leave when the share does).
  await deleteArtifact(pub)
  await prisma.shareComment.deleteMany({ where: { publicationId: pub.id } })
  await prisma.publication.update({
    where: { id: pub.id },
    data: { revokedAt: new Date() },
  })
  return c.body(null, 204)
})

/** Pull publishRev out of the artifact's share/comments block (best-effort). */
function extractPublishRev(html: string): string | null {
  const m = html.match(/"publishRev"\s*:\s*"([0-9a-f]{8,64})"/)
  return m ? m[1] : null
}
