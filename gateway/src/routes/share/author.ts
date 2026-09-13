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
  MAX_COMMENT_CHARS,
  MAX_MARKED_TEXT_CHARS,
  MAX_NAME_CHARS,
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
    // Deleted rows stay as tombstones (they propagate deletions) but they
    // are not conversation — the count shows live rows only.
    include: { _count: { select: { comments: { where: { deletedAt: null } } } } },
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

// Author thread push (#769): a comment the author creates in Prose becomes a
// live server row immediately instead of waiting for the next content
// re-publish ("the conversation is always live" — new threads are
// conversation, not content). Anchored like a reviewer comment via
// markedText + occurrenceIndex; publishRev is the currently-served rev, the
// content the anchor will be resolved against by viewers. Dedupe follows the
// reply invariant: the desktop records the returned id as the thread's
// shareId, bakes emit the thread under it, and the pull-merge treats both
// ids as one thread.
//
// Migration identity: `fromAuthor: false` marks a row the author is
// RE-SEEDING into this publication — a viewer's comment whose original row
// lives in a revoked publication (revoke → republish continues the
// conversation). The name must be the original commenter's; the author is
// authenticated, so this is the author restating history they already hold.
shareAuthorRoutes.post('/:pubId/comments', async (c) => {
  const user = c.get('user')
  const pub = await prisma.publication.findUnique({ where: { id: c.req.param('pubId') } })
  if (!pub || pub.authorId !== user.id) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 409)

  let body: {
    commentText?: unknown
    authorName?: unknown
    markedText?: unknown
    occurrenceIndex?: unknown
    fromAuthor?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const commentText = sanitizeField(body.commentText, MAX_COMMENT_CHARS)
  if (!commentText) return c.json({ error: 'invalid_comment' }, 400)
  const markedText = sanitizeField(body.markedText, MAX_MARKED_TEXT_CHARS)
  if (!markedText) return c.json({ error: 'invalid_anchor' }, 400)
  const occurrenceIndex =
    typeof body.occurrenceIndex === 'number' &&
    Number.isInteger(body.occurrenceIndex) &&
    body.occurrenceIndex >= 0 &&
    body.occurrenceIndex <= 100000
      ? body.occurrenceIndex
      : 0
  const fromAuthor = body.fromAuthor !== false
  const authorName = sanitizeField(body.authorName, MAX_NAME_CHARS)
  // A re-seeded viewer row without its original name would misattribute.
  if (!fromAuthor && !authorName) return c.json({ error: 'invalid_comment' }, 400)

  const row = await prisma.shareComment.create({
    data: {
      publicationId: pub.id,
      commentText,
      authorName: authorName || 'Author',
      fromAuthor,
      markedText,
      occurrenceIndex,
      publishRev: pub.publishRev,
    },
  })
  return c.json({ id: row.id, createdAt: row.createdAt.toISOString() }, 201)
})

// Author reply push (#769): a reply the author wrote in Prose lands in the
// live conversation immediately instead of waiting for a re-publish. The row
// carries fromAuthor so viewers can style it; authorName defaults to 'Author'
// (the desktop sends 'Prose' for AI-authored replies).
shareAuthorRoutes.post('/:pubId/comments/:commentId/replies', async (c) => {
  const user = c.get('user')
  const pub = await prisma.publication.findUnique({ where: { id: c.req.param('pubId') } })
  if (!pub || pub.authorId !== user.id) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 409)

  const parent = await prisma.shareComment.findUnique({
    where: { id: c.req.param('commentId') },
  })
  if (!parent || parent.publicationId !== pub.id || parent.parentId || parent.deletedAt) {
    return c.json({ error: 'not_found' }, 404)
  }

  let body: { commentText?: unknown; authorName?: unknown; fromAuthor?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const commentText = sanitizeField(body.commentText, MAX_COMMENT_CHARS)
  if (!commentText) return c.json({ error: 'invalid_comment' }, 400)
  // Same migration identity rule as the thread push: fromAuthor: false marks
  // a re-seeded viewer reply and requires its original name.
  const fromAuthor = body.fromAuthor !== false
  const authorName = sanitizeField(body.authorName, MAX_NAME_CHARS)
  if (!fromAuthor && !authorName) return c.json({ error: 'invalid_comment' }, 400)

  const row = await prisma.shareComment.create({
    data: {
      publicationId: pub.id,
      parentId: parent.id,
      commentText,
      authorName: authorName || 'Author',
      fromAuthor,
      // A reply anchors through its parent.
      markedText: '',
      occurrenceIndex: 0,
      publishRev: parent.publishRev,
    },
  })
  return c.json({ id: row.id, createdAt: row.createdAt.toISOString() }, 201)
})

// Author resolve push (#769): resolution is author-controlled, one-way from
// Prose. Meaningful on top-level rows only; the viewer poll treats it as
// authoritative.
shareAuthorRoutes.patch('/:pubId/comments/:commentId', async (c) => {
  const user = c.get('user')
  const pub = await prisma.publication.findUnique({ where: { id: c.req.param('pubId') } })
  if (!pub || pub.authorId !== user.id) return c.json({ error: 'not_found' }, 404)

  const target = await prisma.shareComment.findUnique({
    where: { id: c.req.param('commentId') },
  })
  if (!target || target.publicationId !== pub.id || target.parentId) {
    return c.json({ error: 'not_found' }, 404)
  }

  let body: { resolved?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  if (typeof body.resolved !== 'boolean') return c.json({ error: 'invalid_body' }, 400)

  const row = await prisma.shareComment.update({
    where: { id: target.id },
    data: { resolvedAt: body.resolved ? new Date() : null },
  })
  return c.json({ id: row.id, resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null })
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
