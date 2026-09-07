/**
 * sharePush.ts — fire-and-forget pushes of author replies and resolution
 * state into a publication's live conversation (#769).
 *
 * "Content follows the mode; the conversation is always live": these pushes
 * run in BOTH sync modes, so a reply or resolve made in Prose reaches the
 * shared page without a re-publish.
 *
 * Invariants:
 * - Called ONLY from user/AI action handlers (CommentPopover, Comment
 *   Review, AI tool executors) — never from useCommentStore.saveComments,
 *   which also fires on tab flushes and on the sync merge itself and would
 *   echo-loop.
 * - Local state is the source of truth. A failed push queues and retries on
 *   the next window focus or successful content push; errors surface only
 *   into shareStore (the status icon), never as dialogs.
 * - A successful reply push records the server row id as reply.shareId —
 *   the dedupe key for pull-merge and bake (see commentMerge/htmlExport).
 */
import { getApi } from './browserApi'
import { isWebPlatformEnabled } from './featureFlags'
import { useCommentStore } from '../extensions/comments/store'
import { useEditorStore } from '../stores/editorStore'
import { useShareStore } from '../stores/shareStore'
import type { ShareEntry } from '../types'

type PendingOp =
  | { kind: 'reply'; threadId: string; replyId: string }
  | { kind: 'resolve'; threadId: string }

const inFlight = new Set<string>()
let pendingOps: PendingOp[] = []

/** Active non-revoked entry for the current document, or null. */
async function activeEntry(): Promise<ShareEntry | null> {
  const path = useEditorStore.getState().document.path
  if (!path) return null
  const res = await getApi().shareGetForPath(path)
  return res.ok && res.entries.length > 0 ? res.entries[0] : null
}

function reportPushError(error: string, code?: string): void {
  useShareStore.getState().setError(error, code ?? null)
}

function clearPushError(): void {
  const s = useShareStore.getState()
  if (s.lastError) s.setError(null, null)
}

function queueOnce(op: PendingOp): void {
  const key = op.kind === 'reply' ? `reply:${op.threadId}:${op.replyId}` : `resolve:${op.threadId}`
  const exists = pendingOps.some(
    (p) => (p.kind === 'reply' ? `reply:${p.threadId}:${p.replyId}` : `resolve:${p.threadId}`) === key
  )
  if (!exists) pendingOps.push(op)
}

/**
 * Push a just-written reply on a share-sourced thread. No-op for local-only
 * threads (no shareId) or replies already pushed.
 */
export function pushReplyToShare(threadId: string, replyId: string): void {
  if (!isWebPlatformEnabled()) return
  const { pendingComments } = useCommentStore.getState()
  const thread = pendingComments.find((c) => c.id === threadId)
  if (!thread?.shareId) return
  const reply = (thread.replies ?? []).find((r) => r.id === replyId)
  if (!reply || reply.shareId) return

  const key = `reply:${threadId}:${replyId}`
  if (inFlight.has(key)) return
  inFlight.add(key)

  void (async () => {
    try {
      const entry = await activeEntry()
      if (!entry) return
      const res = await getApi().shareReplyToComment(
        entry.publicationId,
        thread.shareId as string,
        reply.text,
        reply.author === 'ai' ? 'Prose' : undefined
      )
      if (!res.ok) {
        queueOnce({ kind: 'reply', threadId, replyId })
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
      // Record the server row id on the local reply — the dedupe invariant.
      const store = useCommentStore.getState()
      const updated = store.pendingComments.map((c) =>
        c.id === threadId
          ? {
              ...c,
              replies: (c.replies ?? []).map((r) => (r.id === replyId ? { ...r, shareId: res.id } : r)),
            }
          : c
      )
      useCommentStore.setState({ pendingComments: updated })
      if (store.documentId) await store.saveComments(store.documentId, updated)
    } catch {
      queueOnce({ kind: 'reply', threadId, replyId })
    } finally {
      inFlight.delete(key)
    }
  })()
}

/**
 * Push the thread's current resolution state. Reads `resolved` from the
 * store at send time, so a queued retry always pushes the latest state.
 */
export function pushResolveToShare(threadId: string): void {
  if (!isWebPlatformEnabled()) return
  const { pendingComments } = useCommentStore.getState()
  const thread = pendingComments.find((c) => c.id === threadId)
  if (!thread?.shareId) return

  const key = `resolve:${threadId}`
  if (inFlight.has(key)) return
  inFlight.add(key)

  void (async () => {
    try {
      const entry = await activeEntry()
      if (!entry) return
      // Re-read at send time — the source of truth is the local store.
      const current = useCommentStore.getState().pendingComments.find((c) => c.id === threadId)
      if (!current?.shareId) return
      const res = await getApi().shareResolveComment(
        entry.publicationId,
        current.shareId,
        current.resolved === true
      )
      if (!res.ok) {
        queueOnce({ kind: 'resolve', threadId })
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
    } catch {
      queueOnce({ kind: 'resolve', threadId })
    } finally {
      inFlight.delete(key)
    }
  })()
}

/** Retry queued pushes (window focus, or after a successful content push). */
export function flushPendingShareOps(): void {
  if (pendingOps.length === 0) return
  const ops = pendingOps
  pendingOps = []
  for (const op of ops) {
    if (op.kind === 'reply') pushReplyToShare(op.threadId, op.replyId)
    else pushResolveToShare(op.threadId)
  }
}
