/**
 * shareSync.ts — pull reviewer comments from the gateway and merge them into
 * the open document's comment store (#769, the pull half of the sync engine).
 *
 * Pure data merge: threads land in the store shaped like any local thread and
 * the existing comment-load → restoreComments path derives their marks from
 * markedText + occurrenceIndex. Threads whose anchor text no longer exists
 * stay in the store flagged `anchorLost` (restore sets/clears the flag) —
 * they are never dropped.
 *
 * Cursor protocol is two-phase so a failed merge can't lose comments: the
 * main process pulls since the stored cursor WITHOUT advancing it; the
 * renderer merges + persists, then acks the new cursor.
 */
import { useEffect } from 'react'
import { getApi } from './browserApi'
import { mergeCommentThreads, cleanString } from './commentMerge'
import { useCommentStore } from '../extensions/comments/store'
import { useEditorStore } from '../stores/editorStore'
import { useNotificationStore } from '../stores/notificationStore'
import { isWebPlatformEnabled } from './featureFlags'
import { flushPendingShareOps } from './sharePush'
import type { CommentData, CommentReply } from '../extensions/comments/types'
import type { ShareEntry, SharePulledComment } from '../types'

/** Focus-poll debounce: don't re-pull a publication more often than this. */
const FOCUS_SYNC_MIN_MS = 5 * 60 * 1000
const lastSyncAt = new Map<string, number>()

function toReply(r: SharePulledComment): CommentReply {
  return {
    id: cleanString(r.id, 128),
    author: 'user',
    text: cleanString(r.commentText),
    createdAt: Date.parse(r.createdAt) || Date.now(),
    ...(r.authorName ? { authorName: cleanString(r.authorName, 100) } : {}),
  }
}

/**
 * Shape pulled gateway rows into CommentData threads. Replies whose parent is
 * in this batch nest under it; replies to threads already in the store become
 * graft-only shells (the merge only takes replies from a known-id incoming
 * thread, so the shell's other fields never land).
 */
function toThreads(pulled: SharePulledComment[], knownThreadIds: Set<string>): CommentData[] {
  const topLevel = pulled.filter((c) => !c.parentId)
  const replies = pulled.filter((c) => c.parentId)
  const batchIds = new Set(topLevel.map((c) => c.id))

  const threads: CommentData[] = topLevel.map((c) => ({
    id: cleanString(c.id, 128),
    markedText: cleanString(c.markedText),
    comment: cleanString(c.commentText),
    createdAt: Date.parse(c.createdAt) || Date.now(),
    author: 'user',
    ...(c.authorName ? { authorName: cleanString(c.authorName, 100) } : {}),
    occurrenceIndex: typeof c.occurrenceIndex === 'number' ? c.occurrenceIndex : 0,
    from: 0,
    to: 0,
    replies: replies.filter((r) => r.parentId === c.id).map(toReply),
    resolved: false,
    publishRev: c.publishRev,
    shareId: c.id,
    // Not yet anchored — restoreComments clears this once it finds the text.
    // Keeps the thread safe from the markless-drop in persistence meanwhile.
    anchorLost: true,
  }))

  // Graft-only shells for replies to threads pulled in an earlier sync.
  const orphans = replies.filter((r) => r.parentId && !batchIds.has(r.parentId) && knownThreadIds.has(r.parentId))
  const byParent = new Map<string, SharePulledComment[]>()
  for (const r of orphans) {
    byParent.set(r.parentId as string, [...(byParent.get(r.parentId as string) ?? []), r])
  }
  for (const [parentId, rs] of byParent) {
    threads.push({
      id: parentId,
      markedText: '',
      comment: '',
      createdAt: Date.now(),
      author: 'user',
      from: 0,
      to: 0,
      replies: rs.map(toReply),
      resolved: false,
    })
  }

  return threads
}

export type ShareSyncOutcome = { ok: true; added: number } | { ok: false; error: string }

/**
 * Pull new reviewer comments for `entry` and merge them into the OPEN
 * document's comment store. Only valid while `documentId` is the loaded
 * document (callers hold the ShareDialog / focus context that guarantees it).
 */
export async function syncShareComments(entry: ShareEntry, documentId: string): Promise<ShareSyncOutcome> {
  const res = await getApi().sharePullComments(entry.publicationId)
  if (!res.ok) return { ok: false, error: res.error }
  lastSyncAt.set(entry.publicationId, Date.now())

  const store = useCommentStore.getState()
  if (store.documentId !== documentId) {
    return { ok: false, error: 'Document changed while syncing — open it and retry.' }
  }

  const existing = store.pendingComments
  const incoming = toThreads(res.comments, new Set(existing.map((c) => c.id)))
  const { merged, added } = mergeCommentThreads(existing, incoming)

  if (added > 0) {
    await store.saveComments(documentId, merged)
    // Reload → sets needsRestore → the Editor restore effect re-derives marks.
    await store.loadComments(documentId)
    useNotificationStore.getState().notify({
      message: `Synced ${added} reviewer comment${added === 1 ? '' : 's'} into this document.`,
      durationMs: 5000,
    })
  }

  if (res.nextCursor) {
    // Merge persisted — safe to advance the pull cursor.
    void getApi().shareAckCursor(entry.publicationId, res.nextCursor)
  }
  return { ok: true, added }
}

/**
 * Window-focus poll (#769): when the app regains focus and the open document
 * is published, quietly pull new comments (≥5-min debounce per publication).
 */
export function useShareFocusSync(): void {
  useEffect(() => {
    const onFocus = async (): Promise<void> => {
      try {
        if (!isWebPlatformEnabled()) return
        // Retry any queued reply/resolve pushes regardless of the pull debounce.
        flushPendingShareOps()
        const { document } = useEditorStore.getState()
        if (!document.path || !document.documentId) return
        const res = await getApi().shareGetForPath(document.path)
        if (!res.ok || res.entries.length === 0) return
        const entry = res.entries.find((e) => !e.revokedAt)
        if (!entry) return
        const last = lastSyncAt.get(entry.publicationId) ?? 0
        if (Date.now() - last < FOCUS_SYNC_MIN_MS) return
        await syncShareComments(entry, document.documentId)
      } catch {
        // Background poll — never surface errors.
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}
