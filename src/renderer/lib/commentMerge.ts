/**
 * commentMerge.ts — the stable-ID comment-thread merge shared by every path
 * that lands external comments in a document's store (#768/#769):
 *
 * - artifactImport: threads embedded in an opened share artifact (sneakernet)
 * - shareSync: threads pulled from the gateway for a published document
 *
 * Merge rules:
 * - Unknown thread ids are appended (the reviewer's new comments).
 * - Known thread ids keep the LOCAL copy (the author's resolved/reply state
 *   wins), but unseen replies from the incoming side are grafted onto the
 *   thread by reply id.
 * - Anchoring never happens here — restoreComments derives marks from
 *   markedText + occurrenceIndex on load, as always.
 */
import type { CommentData, CommentReply } from '../extensions/comments/types'

const MAX_FIELD = 5000

export function cleanString(value: unknown, max = MAX_FIELD): string {
  return String(value ?? '').substring(0, max)
}

export function cleanReply(r: CommentReply): CommentReply {
  return {
    id: cleanString(r.id, 128),
    author: r.author === 'ai' ? 'ai' : 'user',
    text: cleanString(r.text),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    ...(r.authorName ? { authorName: cleanString(r.authorName, 100) } : {}),
  }
}

/**
 * Merge `incoming` threads (already shaped as CommentData) into `existing`.
 * Returns the merged list and how many new threads + grafted replies landed.
 * Pure — callers persist the result themselves.
 */
export function mergeCommentThreads(
  existing: CommentData[],
  incoming: CommentData[]
): { merged: CommentData[]; added: number } {
  const byId = new Map(existing.map((c) => [c.id, c]))
  let added = 0

  for (const thread of incoming) {
    const current = byId.get(thread.id)
    if (!current) {
      byId.set(thread.id, thread)
      added++
      continue
    }
    // Known thread: local state wins, but graft unseen replies.
    const seen = new Set((current.replies ?? []).map((r) => r.id))
    const fresh = (thread.replies ?? []).filter((r) => r && typeof r.id === 'string' && !seen.has(r.id))
    if (fresh.length > 0) {
      byId.set(thread.id, { ...current, replies: [...(current.replies ?? []), ...fresh] })
      added += fresh.length
    }
  }

  return { merged: [...byId.values()], added }
}
