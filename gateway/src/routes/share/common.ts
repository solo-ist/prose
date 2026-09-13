/**
 * routes/share/common.ts — shared pieces of the share service (#768):
 * capability-token handling, field sanitization, and the public comment shape.
 *
 * Token contract (web-platform.md §4.3): 32 random bytes, base64url. The
 * server stores ONLY SHA-256(token) — the raw token exists in the share URL
 * alone, and never in logs (log the /s/ prefix, never the path).
 */
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '../../db/index.js'

export const MAX_COMMENT_CHARS = 5000
export const MAX_MARKED_TEXT_CHARS = 5000
export const MAX_NAME_CHARS = 100
export const MAX_EMAIL_CHARS = 254
export const MAX_TITLE_CHARS = 200
/** Artifact ceiling: base64-inlined images fatten exports; 8 MiB bounds memory. */
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024

export function newShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashShareToken(token) }
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex')
}

/** C0/C1 control chars except \t and \n — mirrors the desktop sanitizer. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

export function sanitizeField(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(CONTROL_CHARS, '').substring(0, maxLength).trim()
}

/** Resolve a live (or revoked) publication from a raw URL token. */
export async function findPublicationByToken(token: string) {
  if (!token || token.length > 64) return null
  return prisma.publication.findUnique({ where: { tokenHash: hashShareToken(token) } })
}

/**
 * The comment shape safe for ANY reader (author pull today, future bridge).
 * `authorEmail` is notification-only and deliberately absent — never add it.
 * `editToken` is the anonymous-ownership capability — never add it either.
 * Deleted rows appear as tombstones (deleted: true, content already
 * scrubbed) so polls and pulls can convey the deletion.
 */
export function publicComment(row: {
  id: string
  parentId: string | null
  markedText: string
  occurrenceIndex: number
  commentText: string
  authorName: string
  fromAuthor: boolean
  resolvedAt: Date | null
  editedAt: Date | null
  deletedAt: Date | null
  publishRev: string
  createdAt: Date
}) {
  return {
    id: row.id,
    parentId: row.parentId,
    markedText: row.markedText,
    occurrenceIndex: row.occurrenceIndex,
    commentText: row.commentText,
    authorName: row.authorName,
    fromAuthor: row.fromAuthor === true,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deleted: row.deletedAt !== null,
    publishRev: row.publishRev,
    createdAt: row.createdAt.toISOString(),
  }
}
