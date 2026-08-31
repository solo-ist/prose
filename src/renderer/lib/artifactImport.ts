/**
 * artifactImport.ts — merge comments embedded in an opened Prose HTML
 * artifact into the document's comment store (#768 tier 3: the sneakernet
 * loop — a reviewer annotates the artifact offline, downloads the annotated
 * copy, sends the file back; opening it in Prose lands their comments as
 * real threads).
 *
 * Merge rules (stable-ID, mirroring the #769 sync semantics):
 * - Unknown thread ids are appended (the reviewer's new comments).
 * - Known thread ids keep the LOCAL copy (the author's resolved/reply state
 *   wins), but unseen replies from the artifact are appended to the thread.
 * - Anchoring is not done here — restoreComments derives marks from
 *   markedText + occurrenceIndex on load, as always.
 */
import { extractCommentsFromHtml } from './htmlExport'
import { loadComments, saveComments } from './persistence'
import type { CommentData, CommentReply } from '../extensions/comments/types'
import { useNotificationStore } from '../stores/notificationStore'

const MAX_FIELD = 5000

function cleanString(value: unknown, max = MAX_FIELD): string {
  return String(value ?? '').substring(0, max)
}

function isImportableThread(c: unknown): c is CommentData {
  const t = c as CommentData
  return !!t && typeof t.id === 'string' && typeof t.markedText === 'string' && typeof t.comment === 'string'
}

function cleanReply(r: CommentReply): CommentReply {
  return {
    id: cleanString(r.id, 128),
    author: r.author === 'ai' ? 'ai' : 'user',
    text: cleanString(r.text),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    ...(r.authorName ? { authorName: cleanString(r.authorName, 100) } : {}),
  }
}

/**
 * Import embedded comments from artifact HTML into `documentId`'s stored
 * comments. Returns the number of new threads + replies merged in (0 when the
 * HTML carries no comments block or nothing new).
 */
export async function importArtifactComments(rawHtml: string, documentId: string): Promise<number> {
  const block = extractCommentsFromHtml(rawHtml)
  if (!block || block.comments.length === 0) return 0

  const existing = await loadComments(documentId)
  const byId = new Map(existing.map((c) => [c.id, c]))
  let merged = 0

  for (const incoming of block.comments) {
    if (!isImportableThread(incoming)) continue
    const current = byId.get(incoming.id)
    if (!current) {
      byId.set(incoming.id, {
        id: cleanString(incoming.id, 128),
        markedText: cleanString(incoming.markedText),
        comment: cleanString(incoming.comment),
        createdAt: typeof incoming.createdAt === 'number' ? incoming.createdAt : Date.now(),
        author: incoming.author === 'ai' ? 'ai' : 'user',
        ...(incoming.authorName ? { authorName: cleanString(incoming.authorName, 100) } : {}),
        occurrenceIndex: typeof incoming.occurrenceIndex === 'number' ? incoming.occurrenceIndex : 0,
        from: 0,
        to: 0,
        replies: (incoming.replies ?? []).filter((r) => r && typeof r.id === 'string').map(cleanReply),
        resolved: incoming.resolved === true,
        publishRev: incoming.publishRev ?? block.publishRev,
      })
      merged++
      continue
    }
    // Known thread: local state wins, but graft unseen replies.
    const seen = new Set((current.replies ?? []).map((r) => r.id))
    const fresh = (incoming.replies ?? []).filter((r) => r && typeof r.id === 'string' && !seen.has(r.id))
    if (fresh.length > 0) {
      current.replies = [...(current.replies ?? []), ...fresh.map(cleanReply)]
      merged += fresh.length
    }
  }

  if (merged > 0) {
    await saveComments(documentId, [...byId.values()])
    useNotificationStore.getState().notify({
      message: `Imported ${merged} comment${merged === 1 ? '' : 's'} from the shared copy.`,
      durationMs: 5000,
    })
  }
  return merged
}
