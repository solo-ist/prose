/**
 * sharePush.ts — fire-and-forget pushes of author comment threads, replies,
 * and resolution state into a publication's live conversation (#769).
 *
 * "Content follows the mode; the conversation is always live": these pushes
 * run in BOTH sync modes, so a comment, reply, or resolve made in Prose
 * reaches the shared page without a re-publish.
 *
 * Invariants:
 * - Called ONLY from user/AI action handlers (the Comment extension's
 *   onCommentAdded mirror for new threads, CommentPopover, Comment Review,
 *   AI tool executors) — never from useCommentStore.saveComments, which also
 *   fires on tab flushes and on the sync merge itself and would echo-loop.
 * - Local state is the source of truth. A failed push queues and retries on
 *   the next window focus or successful content push; errors surface only
 *   into shareStore (the status icon), never as dialogs.
 * - A successful push records the server row id as shareId (on the thread or
 *   reply) — the dedupe key for pull-merge and bake (see
 *   commentMerge/htmlExport): the local row, the baked row, and the live-poll
 *   row stay one identity.
 */
import { getApi } from './browserApi'
import { isWebPlatformEnabled } from './featureFlags'
import { useCommentStore } from '../extensions/comments/store'
import { useEditorStore } from '../stores/editorStore'
import { useShareStore } from '../stores/shareStore'
import type { ShareEntry } from '../types'

type PendingOp =
  | { kind: 'thread'; threadId: string }
  | { kind: 'reply'; threadId: string; replyId: string }
  | { kind: 'resolve'; threadId: string }

function opKey(op: PendingOp): string {
  return op.kind === 'reply' ? `reply:${op.threadId}:${op.replyId}` : `${op.kind}:${op.threadId}`
}

const inFlight = new Set<string>()
// Thread pushes keep their promise so a concurrent caller can WAIT for the
// in-flight push instead of no-opping past it. The backfill awaits every
// thread push before the caller bakes; if a concurrent on-create push made
// its await resolve instantly (the old Set-only early return), the bake
// could still emit the thread under its desktop id and every viewer reply
// to it would 404. (Addendum review — confirmed by trace.)
const inFlightThreads = new Map<string, Promise<void>>()
// Resolve pushes that arrived while one was in flight — re-fired on settle
// so the server converges on the final toggle state (#909).
const resolveRerun = new Set<string>()
let pendingOps: PendingOp[] = []

// After a gateway 'rate_limited', hold ALL pushes for the window instead of
// hammering it shut — every retry burns budget the queued ops need. Ops that
// fire while limited queue instead of sending.
let rateLimitedUntil = 0

function noteRateLimit(code?: string | null): void {
  if (code === 'rate_limited') rateLimitedUntil = Date.now() + 60_000
}

function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil
}

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
  const key = opKey(op)
  if (!pendingOps.some((p) => opKey(p) === key)) pendingOps.push(op)
}

/**
 * Push a just-created comment thread to the publication as a live server row
 * (fromAuthor). No-op for threads that are already server rows (a shareId
 * means it was pulled, or already pushed) and for anchor-less threads. On
 * success the returned row id becomes the thread's shareId, and anything
 * written on the thread while the push was in flight (replies, a resolve)
 * flows through the now-unblocked reply/resolve pushes.
 */
export function pushNewThreadToShare(threadId: string): void {
  void pushThread(threadId)
}

async function pushThread(threadId: string): Promise<void> {
  if (!isWebPlatformEnabled()) return
  const thread = useCommentStore.getState().pendingComments.find((c) => c.id === threadId)
  if (!thread || thread.shareId || !thread.markedText) return
  if (isRateLimited()) {
    queueOnce({ kind: 'thread', threadId })
    return
  }

  const key = `thread:${threadId}`
  const existing = inFlightThreads.get(key)
  if (existing) return existing

  const run = (async () => {
    try {
      const entry = await activeEntry()
      if (!entry) return
      // Re-read at send time — a queued retry pushes the current text, and a
      // thread deleted/merged meanwhile must not post.
      const current = useCommentStore.getState().pendingComments.find((c) => c.id === threadId)
      if (!current || current.shareId || !current.markedText) return
      // A thread carrying an authorName is a viewer's (pulled) — re-seeding
      // it (revoke→republish migration) must keep the original identity, so
      // it posts as fromAuthor: false under that name.
      const isViewerThread = current.author !== 'ai' && !!current.authorName
      const res = await getApi().shareCreateComment(entry.publicationId, {
        markedText: current.markedText,
        occurrenceIndex: current.occurrenceIndex ?? 0,
        text: current.comment,
        authorName: current.author === 'ai' ? 'Prose' : current.authorName || undefined,
        ...(isViewerThread ? { fromAuthor: false } : {})
      })
      if (!res.ok) {
        noteRateLimit(res.code)
        queueOnce({ kind: 'thread', threadId })
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
      // Record the server row id on the local thread — the dedupe invariant.
      const store = useCommentStore.getState()
      const updated = store.pendingComments.map((c) => (c.id === threadId ? { ...c, shareId: res.id } : c))
      useCommentStore.setState({ pendingComments: updated })
      if (store.documentId) await store.saveComments(store.documentId, updated)
      // Replies/resolves written before the server row existed were silent
      // no-ops in their own pushes — release them now.
      const settled = updated.find((c) => c.id === threadId)
      for (const r of settled?.replies ?? []) {
        if (!r.shareId) pushReplyToShare(threadId, r.id)
      }
      if (settled?.resolved === true) pushResolveToShare(threadId)
    } catch {
      queueOnce({ kind: 'thread', threadId })
    } finally {
      inFlightThreads.delete(key)
    }
  })()
  inFlightThreads.set(key, run)
  return run
}

/**
 * Backfill: push every thread that never got a server row. Threads created
 * BEFORE the document was shared miss the on-create push (no publication
 * existed), bake under their desktop ids, and every viewer reply to them
 * 404s — this is the repair. The content push calls it BEFORE baking, so
 * the artifact always bakes under server ids. Sequential on purpose (the
 * dedupe invariant writes shareIds between pushes); pulled viewer threads
 * already carry a shareId and are untouched.
 */
// Row ids proven to exist in a publication (`${pubId}:${rowId}`) — rows
// never leave a live publication, so a verification holds for the session.
const verifiedRows = new Set<string>()

export async function backfillShareThreads(): Promise<boolean> {
  if (!isWebPlatformEnabled()) return false
  // The comment store must hold THIS document's threads — right after a tab
  // switch it can still hold the previous doc's, and pushing those to this
  // doc's publication would cross-pollinate conversations.
  const docId = useEditorStore.getState().document.documentId
  const store = useCommentStore.getState()
  if (!docId || store.documentId !== docId) return false
  // A closed rate window means every push below would bounce — wait for the
  // next content push rather than burning the reopening budget.
  if (isRateLimited()) return false
  const entry = await activeEntry()
  if (!entry) return false

  // Conversation migration (revoke → republish): a shareId whose row is not
  // in THIS publication is stale — its row lived in a revoked publication,
  // and revoke deletes reviewer rows server-side. Clear those ids (thread +
  // replies) so the missing-push below re-seeds them, with viewer identity
  // preserved via fromAuthor: false.
  const unverified = store.pendingComments.filter(
    (c) => c.shareId && !verifiedRows.has(`${entry.publicationId}:${c.shareId}`)
  )
  if (unverified.length > 0) {
    const res = await getApi().shareComments(entry.publicationId)
    if (res.ok) {
      const live = new Set(res.comments.map((r) => r.id))
      for (const id of live) verifiedRows.add(`${entry.publicationId}:${id}`)
      const staleIds = new Set(
        unverified.filter((c) => !live.has(c.shareId as string)).map((c) => c.id)
      )
      if (staleIds.size > 0) {
        const cleared = useCommentStore.getState().pendingComments.map((c) =>
          staleIds.has(c.id)
            ? { ...c, shareId: undefined, replies: (c.replies ?? []).map((r) => ({ ...r, shareId: undefined })) }
            : c
        )
        // Not persisted here — the re-pushes below record and save the new
        // shareIds; if they all fail, the stale ids return on reload and are
        // re-detected next push.
        useCommentStore.setState({ pendingComments: cleared })
      }
    }
  }

  const missing = useCommentStore
    .getState()
    .pendingComments.filter((c) => !c.shareId && c.markedText)
    .map((c) => c.id)
  if (missing.length === 0) return false
  for (const id of missing) {
    // A mid-loop 429 closes the window — stop instead of queueing bounces;
    // the remainder re-detects as missing on the next content push.
    if (isRateLimited()) break
    await pushThread(id)
  }
  const after = useCommentStore.getState().pendingComments
  for (const c of after) {
    if (c.shareId) verifiedRows.add(`${entry.publicationId}:${c.shareId}`)
  }
  return after.some((c) => missing.indexOf(c.id) !== -1 && c.shareId)
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
  if (isRateLimited()) {
    queueOnce({ kind: 'reply', threadId, replyId })
    return
  }

  const key = `reply:${threadId}:${replyId}`
  if (inFlight.has(key)) return
  inFlight.add(key)

  void (async () => {
    try {
      const entry = await activeEntry()
      if (!entry) return
      // Same migration identity rule as threads: a reply with an authorName
      // is a viewer's and re-seeds under that name as fromAuthor: false.
      const isViewerReply = reply.author !== 'ai' && !!reply.authorName
      const res = await getApi().shareReplyToComment(
        entry.publicationId,
        thread.shareId as string,
        reply.text,
        reply.author === 'ai' ? 'Prose' : reply.authorName || undefined,
        isViewerReply ? false : undefined
      )
      if (!res.ok) {
        noteRateLimit(res.code)
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
  if (isRateLimited()) {
    queueOnce({ kind: 'resolve', threadId })
    return
  }

  const key = `resolve:${threadId}`
  // Resolve is a TOGGLE, so a concurrent call can't just no-op past an
  // in-flight push: a double-click lands inside the HTTP window, the
  // early-return drops the newer state, and — resolution being author-only —
  // nothing ever pulls the server back into line (#909). Coalesce instead:
  // note the re-request and re-fire once the in-flight push settles; the
  // send-time re-read then pushes whatever the store says NOW.
  if (inFlight.has(key)) {
    resolveRerun.add(key)
    return
  }
  inFlight.add(key)

  void (async () => {
    let sentState: boolean | null = null
    try {
      const entry = await activeEntry()
      if (!entry) return
      // Re-read at send time — the source of truth is the local store.
      const current = useCommentStore.getState().pendingComments.find((c) => c.id === threadId)
      if (!current?.shareId) return
      sentState = current.resolved === true
      const res = await getApi().shareResolveComment(
        entry.publicationId,
        current.shareId,
        sentState
      )
      if (!res.ok) {
        noteRateLimit(res.code)
        queueOnce({ kind: 'resolve', threadId })
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
    } catch {
      queueOnce({ kind: 'resolve', threadId })
    } finally {
      inFlight.delete(key)
      // A toggle arrived mid-flight, or the state changed after we read it —
      // converge on the final local state instead of leaving the server on
      // the stale value.
      const latest = useCommentStore.getState().pendingComments.find((c) => c.id === threadId)
      const changedUnderUs = sentState !== null && latest !== undefined && (latest.resolved === true) !== sentState
      if (resolveRerun.delete(key) || changedUnderUs) {
        pushResolveToShare(threadId)
      }
    }
  })()
}

/** Retry queued pushes (window focus, or after a successful content push). */
export function flushPendingShareOps(): void {
  if (pendingOps.length === 0 || isRateLimited()) return
  const ops = pendingOps
  pendingOps = []
  for (const op of ops) {
    if (op.kind === 'thread') pushNewThreadToShare(op.threadId)
    else if (op.kind === 'reply') pushReplyToShare(op.threadId, op.replyId)
    else pushResolveToShare(op.threadId)
  }
}
