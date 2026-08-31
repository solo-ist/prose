/**
 * routes/share/public.ts — the PUBLIC share surface (#768). Mounted at /s.
 *
 * GET /s/:token                       → serve the artifact (410 revoked, 404 unknown)
 * POST /s/:token/comments             → anonymous reviewer comment
 * POST /s/:token/comments/:id/replies → anonymous reviewer reply (one level)
 *
 * No session, no CORS exposure (the artifact posts same-origin). Rate-limited
 * per IP. The raw token is a bearer capability — never log the URL path.
 */
import { Hono } from 'hono'
import { prisma } from '../../db/index.js'
import { getArtifact } from '../../artifacts/index.js'
import { ipRateLimit } from '../../middleware/ipRateLimit.js'
import {
  MAX_COMMENT_CHARS,
  MAX_EMAIL_CHARS,
  MAX_MARKED_TEXT_CHARS,
  MAX_NAME_CHARS,
  findPublicationByToken,
  sanitizeField,
} from './common.js'

/** Headers for served artifacts — see web-platform.md §4.3. connect-src 'self'
 * covers the viewer's same-origin comment POSTs. Cache is disabled so
 * revocation takes effect immediately (a CDN layer can revisit this). */
const ARTIFACT_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'",
  'Cache-Control': 'no-store',
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type CommentPayload = {
  markedText: string
  occurrenceIndex: number
  commentText: string
  authorName: string
  authorEmail: string | null
  publishRev: string
}

/** Validate + sanitize a reviewer comment body; null when invalid. */
function parseCommentBody(body: Record<string, unknown>, requireAnchor: boolean): CommentPayload | null {
  const commentText = sanitizeField(body.commentText, MAX_COMMENT_CHARS)
  const authorName = sanitizeField(body.authorName, MAX_NAME_CHARS)
  if (!commentText || !authorName) return null

  const markedText = sanitizeField(body.markedText, MAX_MARKED_TEXT_CHARS)
  const occurrenceIndex =
    typeof body.occurrenceIndex === 'number' &&
    Number.isInteger(body.occurrenceIndex) &&
    body.occurrenceIndex >= 0 &&
    body.occurrenceIndex <= 100000
      ? body.occurrenceIndex
      : 0
  if (requireAnchor && !markedText) return null

  let authorEmail: string | null = null
  if (body.authorEmail !== undefined && body.authorEmail !== null && body.authorEmail !== '') {
    const email = sanitizeField(body.authorEmail, MAX_EMAIL_CHARS)
    if (!EMAIL_SHAPE.test(email)) return null
    authorEmail = email
  }

  const publishRev = sanitizeField(body.publishRev, 64)
  return { markedText, occurrenceIndex, commentText, authorName, authorEmail, publishRev }
}

export const sharePublicRoutes = new Hono()

// Writes get a tighter budget than the app-level /s/* limit (which mainly
// blunts token brute-forcing on GET): ~10 comments/min per IP.
const commentWriteLimit = ipRateLimit(10, 60)

sharePublicRoutes.get('/:token', async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.text('Not found', 404)
  if (pub.revokedAt) return c.text('This share link has been revoked.', 410)

  const html = await getArtifact(pub)
  if (!html) return c.text('Not found', 404)

  return c.body(html, 200, ARTIFACT_HEADERS)
})

sharePublicRoutes.post('/:token/comments', commentWriteLimit, async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 410)

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const payload = parseCommentBody(body, true)
  if (!payload) return c.json({ error: 'invalid_comment' }, 400)

  const row = await prisma.shareComment.create({
    data: { publicationId: pub.id, ...payload },
  })
  return c.json({ id: row.id, createdAt: row.createdAt.toISOString() }, 201)
})

sharePublicRoutes.post('/:token/comments/:commentId/replies', commentWriteLimit, async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 410)

  const parent = await prisma.shareComment.findUnique({
    where: { id: c.req.param('commentId') },
  })
  // Replies attach only to this share's TOP-LEVEL threads (one level deep,
  // matching the desktop CommentReply model).
  if (!parent || parent.publicationId !== pub.id || parent.parentId) {
    return c.json({ error: 'not_found' }, 404)
  }

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const payload = parseCommentBody(body, false)
  if (!payload) return c.json({ error: 'invalid_comment' }, 400)

  const row = await prisma.shareComment.create({
    data: {
      publicationId: pub.id,
      parentId: parent.id,
      ...payload,
      // A reply anchors through its parent; ignore any client-sent anchor.
      markedText: '',
      occurrenceIndex: 0,
    },
  })
  return c.json({ id: row.id, createdAt: row.createdAt.toISOString() }, 201)
})
