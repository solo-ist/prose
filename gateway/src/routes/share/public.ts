/**
 * routes/share/public.ts — the PUBLIC share surface (#768). Mounted at /s.
 *
 * GET /s/:token                       → serve the artifact (410 revoked, 404 unknown)
 * GET /s/:token/comments              → live comment list for the viewer poll (#769)
 * POST /s/:token/comments             → anonymous reviewer comment
 * POST /s/:token/comments/:id/replies → anonymous reviewer reply (one level)
 *
 * No session. This surface serves permissive CORS headers: the routes are
 * anonymous and capability-gated (the token is the credential, no cookies),
 * which lets downloaded file:// copies sync their comments. Rate-limited per
 * IP. The raw token is a bearer capability — never log the URL path.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prisma } from '../../db/index.js'
import { config } from '../../config.js'
import { getArtifact } from '../../artifacts/index.js'
import { ipRateLimit } from '../../middleware/ipRateLimit.js'
import {
  MAX_COMMENT_CHARS,
  MAX_EMAIL_CHARS,
  MAX_MARKED_TEXT_CHARS,
  MAX_NAME_CHARS,
  findPublicationByToken,
  publicComment,
  sanitizeField,
} from './common.js'

/** Headers for served artifacts — see web-platform.md §4.3. connect-src 'self'
 * covers the viewer's same-origin comment POSTs; the Google Fonts pair covers
 * the artifact's webfont links (Newsreader/Fraunces/IBM Plex Mono — approved
 * 2026-09-07). Cache is disabled so revocation takes effect immediately (a
 * CDN layer can revisit this). LOCKSTEP: this CSP string is mirrored in
 * e2e/web.share-viewer.spec.ts (harness) and scripts/test-share.mjs
 * (assertion) — change all three together. */
const ARTIFACT_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob:; font-src data: https://fonts.gstatic.com; connect-src 'self'",
  'Cache-Control': 'no-store',
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** HTML-escape for the revoked page — the request host lands in markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The revoked-link page — the one piece of share chrome the gateway renders
 * itself (the artifact is gone, so its baked viewer can't). Static dark HTML,
 * no script, served on ARTIFACT_HEADERS; mirrors the copy the live viewer
 * shows when its poll hits the same 410. The comments GET/POST keep JSON 410s.
 */
function revokedPage(host: string): string {
  const safeHost = escapeHtml(host)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link taken down</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0a0a0a; color: #f2efe6; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main { max-width: 460px; padding: 32px 24px; text-align: center; }
  .wordmark { font-family: Georgia, serif; font-style: italic; font-weight: 700; font-size: 22px; letter-spacing: -0.012em; color: #e2d9cb; margin-bottom: 40px; }
  h1 { font-size: 15px; font-weight: 500; line-height: 1.5; margin: 0 0 14px; }
  p { font-size: 12px; line-height: 1.7; color: rgba(242, 239, 230, 0.55); margin: 0 0 32px; }
  .meta { font-size: 11px; color: rgba(242, 239, 230, 0.35); }
</style>
</head>
<body>
<main>
  <div class="wordmark">¶ Prose.</div>
  <h1>This link was taken down by its author.</h1>
  <p>Nothing here is cached. If you have a downloaded copy, it still opens and still shows its comments.</p>
  <div class="meta">${safeHost}/s/… · 410</div>
</main>
</body>
</html>
`
}

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

// CORS wide open on this surface — deliberately. These routes are anonymous
// and capability-gated: the token IS the credential, no cookies are involved
// (no Allow-Credentials), and rate limits still apply. This is what lets a
// DOWNLOADED annotated copy (file://, Origin: null) publish its comments back
// through the shareUrl baked into it by the viewer's download.
sharePublicRoutes.use(
  '*',
  cors({ origin: '*', allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 86400 })
)

// Anonymous-ownership capability for a created row: returned ONLY in the
// creating POST's response and stored by the viewer that posted it. Whoever
// holds it may edit that row's authorName. Never readable back.
function newEditToken(): string {
  return randomBytes(24).toString('base64url')
}

function editTokenMatches(stored: string | null, presented: string): boolean {
  if (!stored) return false
  const a = Buffer.from(stored)
  const b = Buffer.from(presented)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Writes get a tighter budget than the app-level /s/* limit (which mainly
// blunts token brute-forcing on GET): ~10 comments/min per IP.
const commentWriteLimit = ipRateLimit(config.SHARE_PUBLIC_WRITE_MAX, 60)

sharePublicRoutes.get('/:token', async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.text('Not found', 404)
  if (pub.revokedAt) {
    return c.body(revokedPage(new URL(c.req.url).host), 410, ARTIFACT_HEADERS)
  }

  const html = await getArtifact(pub)
  if (!html) return c.text('Not found', 404)

  return c.body(html, 200, ARTIFACT_HEADERS)
})

// The viewer's live poll (#769). Own budget so heavy polling can't starve the
// write limiter; the app-level /s/* limit (60/min) still applies on top. The
// link token already grants full document read, so a comment read on the same
// token exposes nothing new — publicComment excludes authorEmail always.
const commentReadLimit = ipRateLimit(30, 60)

sharePublicRoutes.get('/:token/comments', commentReadLimit, async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 410)

  const since = c.req.query('since')
  const sinceDate = since ? new Date(since) : null
  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    return c.json({ error: 'invalid_since' }, 400)
  }

  const rows = await prisma.shareComment.findMany({
    where: {
      publicationId: pub.id,
      // gte, not gt — mirrors the author pull: a timestamp cursor with `gt`
      // drops same-millisecond rows across a page boundary; the viewer's
      // merge dedupes re-fetched boundary rows by id (PR #901 review).
      // KNOWN LIMIT: >500 rows in ONE millisecond would re-return the same
      // page forever — see the author pull's cursor comment before changing
      // pagination here.
      ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  })

  return c.json({
    comments: rows.map(publicComment),
    nextCursor: rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null,
  })
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

  const editToken = newEditToken()
  const row = await prisma.shareComment.create({
    data: { publicationId: pub.id, ...payload, editToken },
  })
  return c.json({ id: row.id, createdAt: row.createdAt.toISOString(), editToken }, 201)
})

sharePublicRoutes.post('/:token/comments/:commentId/replies', commentWriteLimit, async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 410)

  const parent = await prisma.shareComment.findUnique({
    where: { id: c.req.param('commentId') },
  })
  // Replies attach only to this share's TOP-LEVEL, live threads (one level
  // deep, matching the desktop CommentReply model; a deleted parent is gone).
  if (!parent || parent.publicationId !== pub.id || parent.parentId || parent.deletedAt) {
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

  const editToken = newEditToken()
  const row = await prisma.shareComment.create({
    data: {
      publicationId: pub.id,
      parentId: parent.id,
      ...payload,
      // A reply anchors through its parent; ignore any client-sent anchor.
      markedText: '',
      occurrenceIndex: 0,
      editToken,
    },
  })
  return c.json({ id: row.id, createdAt: row.createdAt.toISOString(), editToken }, 201)
})

// Edit a row you created (#769 QA asks): the editToken from the creating
// POST is the proof of authorship — viewers are anonymous, so without it any
// visitor could edit anyone. Accepts authorName and/or commentText; a text
// change stamps editedAt (viewers render an "edited" marker).
sharePublicRoutes.patch('/:token/comments/:commentId', commentWriteLimit, async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 410)

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const presented = typeof body.editToken === 'string' ? body.editToken : ''
  const wantsName = body.authorName !== undefined
  const wantsText = body.commentText !== undefined
  const authorName = wantsName ? sanitizeField(body.authorName, MAX_NAME_CHARS) : ''
  const commentText = wantsText ? sanitizeField(body.commentText, MAX_COMMENT_CHARS) : ''
  // At least one field, and any provided field must be non-empty.
  if (!presented || (!wantsName && !wantsText)) return c.json({ error: 'invalid_edit' }, 400)
  if ((wantsName && !authorName) || (wantsText && !commentText)) return c.json({ error: 'invalid_edit' }, 400)

  const row = await prisma.shareComment.findUnique({ where: { id: c.req.param('commentId') } })
  if (!row || row.publicationId !== pub.id || row.deletedAt) return c.json({ error: 'not_found' }, 404)
  if (!editTokenMatches(row.editToken, presented)) return c.json({ error: 'forbidden' }, 403)

  const updated = await prisma.shareComment.update({
    where: { id: row.id },
    data: {
      ...(wantsName ? { authorName } : {}),
      ...(wantsText ? { commentText, editedAt: new Date() } : {}),
    },
  })
  return c.json({
    ok: true,
    authorName: updated.authorName,
    commentText: updated.commentText,
    editedAt: updated.editedAt ? updated.editedAt.toISOString() : null,
  })
})

// Delete a row you created — SOFT: content scrubbed immediately (the words
// and the notification email leave, the capability burns), the row stays as
// a tombstone so polls/pulls convey the deletion and the revoke→republish
// backfill can't resurrect it. A thread with live replies is editable only
// (409): nobody's words vanish because someone else retracted theirs.
sharePublicRoutes.delete('/:token/comments/:commentId', commentWriteLimit, async (c) => {
  const pub = await findPublicationByToken(c.req.param('token'))
  if (!pub) return c.json({ error: 'not_found' }, 404)
  if (pub.revokedAt) return c.json({ error: 'revoked' }, 410)

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const presented = typeof body.editToken === 'string' ? body.editToken : ''
  if (!presented) return c.json({ error: 'invalid_edit' }, 400)

  const row = await prisma.shareComment.findUnique({ where: { id: c.req.param('commentId') } })
  if (!row || row.publicationId !== pub.id || row.deletedAt) return c.json({ error: 'not_found' }, 404)
  if (!editTokenMatches(row.editToken, presented)) return c.json({ error: 'forbidden' }, 403)

  if (!row.parentId) {
    const liveReplies = await prisma.shareComment.count({
      where: { parentId: row.id, deletedAt: null },
    })
    if (liveReplies > 0) return c.json({ error: 'has_replies' }, 409)
  }

  await prisma.shareComment.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), commentText: '', authorName: '', authorEmail: null, editToken: null },
  })
  return c.json({ ok: true })
})
