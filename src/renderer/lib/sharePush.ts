/**
 * sharePush.ts — fire-and-forget pushes of author comment threads, replies,
 * resolution state, and removals into a publication's live conversation
 * (#769, #903).
 *
 * "Content follows the mode; the conversation is always live": these pushes
 * run in BOTH sync modes, so a comment, reply, or resolve made in Prose
 * reaches the shared page without a re-publish.
 *
 * Invariants:
 * - Every push is addressed by `documentId` (#1147). The comment threads
 *   plugin records what a transition asks for (a new local thread, a reply,
 *   a resolve toggle, a removal) and the session layer hands the batch to
 *   `performSharePushes` with the owning document; a backfill and a queued
 *   retry name the document too. A push never reads "the active document":
 *   a tab switch while one is in flight changes nothing about where its
 *   result lands.
 * - Local state is the source of truth. A failed push queues and retries on
 *   the next window focus or successful content push; errors surface only
 *   into shareStore (the status icon), never as dialogs.
 * - A successful push records the server row id as shareId (on the thread or
 *   reply) through `patchThread`, a quiet transaction on the owning session
 *   (or the stored rows when the document is closed) — the dedupe key for
 *   pull-merge and bake (see commentMerge/htmlExport): the local row, the
 *   baked row, and the live-poll row stay one identity.
 */
import { getApi } from './browserApi'
import { isWebPlatformEnabled } from './featureFlags'
import { documentPathOf, patchThread, readThreads, registerSharePushPerformer } from '../document/session'
import { useShareStore } from '../stores/shareStore'
import type { CommentData } from '../extensions/comments/types'
import type { SharePush } from '../extensions/comments/transactions'
import type { ShareEntry } from '../types'

type PendingOp =
  | { kind: 'thread'; documentId: string; threadId: string }
  | { kind: 'reply'; documentId: string; threadId: string; replyId: string }
  | { kind: 'resolve'; documentId: string; threadId: string }
  | { kind: 'remove'; publicationId: string; shareId: string }

function opKey(op: PendingOp): string {
  if (op.kind === 'reply') return `reply:${op.documentId}:${op.threadId}:${op.replyId}`
  if (op.kind === 'remove') return `remove:${op.publicationId}:${op.shareId}`
  return `${op.kind}:${op.documentId}:${op.threadId}`
}

const inFlight = new Set<string>()
// Thread pushes keep their promise so a concurrent caller can WAIT for the
// in-flight push instead of no-opping past it. The backfill awaits every
// thread push before the caller bakes; if a concurrent on-create push made
// its await resolve instantly (the old Set-only early return), the bake
// could still emit the thread under its desktop id and every viewer reply
// to it would 404. (Addendum review — confirmed by trace.)
const inFlightThreads = new Map<string, Promise<void>>()

// Every in-flight push (thread, reply, resolve) registers here so a content
// bake can wait for ALL of them to assign their shareIds first. A reply
// baked while its push is still in flight lands under its LOCAL id, while
// the live poll returns the same reply under its SERVER id — the viewer then
// shows it twice. `awaitPendingPushes()` before the bake closes that race.
// A push registers synchronously, before its first read, so a drain started
// right after a flush sees it.
const pendingPushes = new Set<Promise<unknown>>()

function track(p: Promise<unknown>): void {
  pendingPushes.add(p)
  void p.finally(() => pendingPushes.delete(p))
}

/**
 * Resolve once no comment push is in flight. A thread push can spawn reply
 * and resolve pushes as it settles (they were queued while it had no server
 * row), so drain in a short loop rather than a single wait; the cap bounds it
 * against a pathological retry storm (queued failures wait for focus, not
 * this drain).
 */
export async function awaitPendingPushes(): Promise<void> {
  for (let i = 0; i < 5 && pendingPushes.size > 0; i++) {
    await Promise.allSettled([...pendingPushes])
  }
}
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

/** Active non-revoked entry for a document, by its path, or null. */
async function entryFor(documentId: string): Promise<ShareEntry | null> {
  const path = documentPathOf(documentId)
  if (!path) return null
  const res = await getApi().shareGetForPath(path)
  return res.ok && res.entries.length > 0 ? res.entries[0] : null
}

async function threadOf(documentId: string, threadId: string): Promise<CommentData | undefined> {
  return (await readThreads(documentId)).find((c) => c.id === threadId)
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
export function pushNewThreadToShare(documentId: string, threadId: string): void {
  void pushThread(documentId, threadId)
}

async function pushThread(documentId: string, threadId: string): Promise<void> {
  if (!isWebPlatformEnabled()) return
  const key = `thread:${documentId}:${threadId}`
  const existing = inFlightThreads.get(key)
  if (existing) return existing

  const run = (async () => {
    try {
      const thread = await threadOf(documentId, threadId)
      if (!thread || thread.shareId || !thread.markedText) return
      if (isRateLimited()) {
        queueOnce({ kind: 'thread', documentId, threadId })
        return
      }
      const entry = await entryFor(documentId)
      if (!entry) return
      // Re-read at send time — a queued retry pushes the current text, and a
      // thread deleted/merged meanwhile must not post.
      const current = await threadOf(documentId, threadId)
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
        queueOnce({ kind: 'thread', documentId, threadId })
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
      // Record the server row id on the local thread — the dedupe invariant.
      await patchThread(documentId, threadId, (c) => (c.shareId ? null : { shareId: res.id }))
      // Replies/resolves written before the server row existed were silent
      // no-ops in their own pushes — release them now.
      const settled = await threadOf(documentId, threadId)
      for (const r of settled?.replies ?? []) {
        if (!r.shareId) pushReplyToShare(documentId, threadId, r.id)
      }
      if (settled?.resolved === true) pushResolveToShare(documentId, threadId)
    } catch {
      queueOnce({ kind: 'thread', documentId, threadId })
    } finally {
      inFlightThreads.delete(key)
    }
  })()
  inFlightThreads.set(key, run)
  track(run)
  return run
}

/**
 * Backfill: push every thread of a document that never got a server row.
 * Threads created BEFORE the document was shared miss the on-create push (no
 * publication existed), bake under their desktop ids, and every viewer reply
 * to them 404s — this is the repair. The content push calls it BEFORE
 * baking, so the artifact always bakes under server ids. Sequential on
 * purpose (the dedupe invariant writes shareIds between pushes); pulled
 * viewer threads already carry a shareId and are untouched.
 */
// Row ids proven to exist in a publication (`${pubId}:${rowId}`) — rows
// never leave a live publication, so a verification holds for the session.
const verifiedRows = new Set<string>()

export async function backfillShareThreads(documentId: string): Promise<boolean> {
  if (!isWebPlatformEnabled() || !documentId) return false
  // A closed rate window means every push below would bounce — wait for the
  // next content push rather than burning the reopening budget.
  if (isRateLimited()) return false
  const entry = await entryFor(documentId)
  if (!entry) return false

  // Conversation migration (revoke → republish): a shareId whose row is not
  // in THIS publication is stale — its row lived in a revoked publication,
  // and revoke deletes reviewer rows server-side. Clear those ids (thread +
  // replies) so the missing-push below re-seeds them, with viewer identity
  // preserved via fromAuthor: false.
  const threads = await readThreads(documentId)
  const unverified = threads.filter(
    (c) => c.shareId && !verifiedRows.has(`${entry.publicationId}:${c.shareId}`)
  )
  if (unverified.length > 0) {
    const res = await getApi().shareComments(entry.publicationId)
    if (res.ok) {
      const live = new Set(res.comments.map((r) => r.id))
      for (const id of live) verifiedRows.add(`${entry.publicationId}:${id}`)
      const stale = unverified.filter((c) => !live.has(c.shareId as string))
      for (const c of stale) {
        await patchThread(documentId, c.id, (current) => ({
          shareId: undefined,
          replies: (current.replies ?? []).map((r) => ({ ...r, shareId: undefined }))
        }))
      }
    }
  }

  const missing = (await readThreads(documentId)).filter((c) => !c.shareId && c.markedText).map((c) => c.id)
  if (missing.length === 0) return false
  for (const id of missing) {
    // A mid-loop 429 closes the window — stop instead of queueing bounces;
    // the remainder re-detects as missing on the next content push.
    if (isRateLimited()) break
    await pushThread(documentId, id)
  }
  const after = await readThreads(documentId)
  for (const c of after) {
    if (c.shareId) verifiedRows.add(`${entry.publicationId}:${c.shareId}`)
  }
  return after.some((c) => missing.indexOf(c.id) !== -1 && c.shareId)
}

/**
 * True when a LOCAL row of the document still needs a server id — baking it
 * now would emit it under its local id, and once the pending push assigns a
 * server id the live poll would surface the same row again (a duplicate in
 * the viewer). Callers check this AFTER flushing the queue and draining
 * in-flight pushes, so what remains is genuinely unresolved.
 *
 * Threads: a pulled/viewer thread always carries a shareId (id === shareId per
 * shareSync), so `markedText && !shareId` reliably means "local + unpushed" —
 * and it catches a thread a rate-limited backfill bailed on before queueing.
 *
 * Replies: a pulled/viewer reply carries NO shareId of its own (it lives under
 * its server row id), so `!shareId` does NOT distinguish it from an unpushed
 * local reply. The pending-ops QUEUE is the reliable signal instead — a pulled
 * reply is never queued; only a local reply awaiting a (re)push is. A queued
 * thread op counts too; resolves are idempotent state, not rows, and never
 * dup, so they don't block.
 */
export async function hasUnsyncedRows(documentId: string): Promise<boolean> {
  for (const c of await readThreads(documentId)) {
    if (c.markedText && !c.shareId) return true
  }
  return pendingOps.some((op) => (op.kind === 'thread' || op.kind === 'reply') && op.documentId === documentId)
}

/**
 * Push a just-written reply on a share-sourced thread. No-op for local-only
 * threads (no shareId) or replies already pushed.
 */
export function pushReplyToShare(documentId: string, threadId: string, replyId: string): void {
  if (!isWebPlatformEnabled()) return
  const key = `reply:${documentId}:${threadId}:${replyId}`
  track((async () => {
    const thread = await threadOf(documentId, threadId)
    if (!thread?.shareId) return
    const reply = (thread.replies ?? []).find((r) => r.id === replyId)
    if (!reply || reply.shareId) return
    if (isRateLimited()) {
      queueOnce({ kind: 'reply', documentId, threadId, replyId })
      return
    }
    // The key is claimed after the first read and before the next await: a
    // concurrent caller for the same reply resumes after this one and finds
    // it claimed, so one push goes out even though the read is asynchronous.
    if (inFlight.has(key)) return
    inFlight.add(key)
    try {
      const entry = await entryFor(documentId)
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
        queueOnce({ kind: 'reply', documentId, threadId, replyId })
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
      // Record the server row id on the local reply — the dedupe invariant.
      await patchThread(documentId, threadId, (c) => ({
        replies: (c.replies ?? []).map((r) => (r.id === replyId && !r.shareId ? { ...r, shareId: res.id } : r))
      }))
    } catch {
      queueOnce({ kind: 'reply', documentId, threadId, replyId })
    } finally {
      inFlight.delete(key)
    }
  })())
}

/**
 * Push the thread's current resolution state. Reads `resolved` from the
 * document's threads at send time, so a queued retry always pushes the
 * latest state.
 */
export function pushResolveToShare(documentId: string, threadId: string): void {
  if (!isWebPlatformEnabled()) return
  const key = `resolve:${documentId}:${threadId}`
  track((async () => {
    const thread = await threadOf(documentId, threadId)
    if (!thread?.shareId) return
    if (isRateLimited()) {
      queueOnce({ kind: 'resolve', documentId, threadId })
      return
    }
    // The key is claimed after the first read, before the next await, as in
    // pushReplyToShare: a concurrent caller resumes later and sees it.
    // Resolve is a TOGGLE, so a concurrent call can't just no-op past an
    // in-flight push: a double-click lands inside the HTTP window, the
    // early-return drops the newer state, and — resolution being author-only —
    // nothing ever pulls the server back into line (#909). Coalesce instead:
    // note the re-request and re-fire once the in-flight push settles; the
    // send-time re-read then pushes whatever the threads say NOW.
    if (inFlight.has(key)) {
      resolveRerun.add(key)
      return
    }
    inFlight.add(key)
    let sentState: boolean | null = null
    try {
      const entry = await entryFor(documentId)
      if (!entry) return
      // Re-read at send time — the source of truth is the local thread.
      const current = await threadOf(documentId, threadId)
      if (!current?.shareId) return
      sentState = current.resolved === true
      const res = await getApi().shareResolveComment(entry.publicationId, current.shareId, sentState)
      if (!res.ok) {
        noteRateLimit(res.code)
        queueOnce({ kind: 'resolve', documentId, threadId })
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
    } catch {
      queueOnce({ kind: 'resolve', documentId, threadId })
    } finally {
      inFlight.delete(key)
      // A toggle arrived mid-flight, or the state changed after we read it —
      // converge on the final local state instead of leaving the server on
      // the stale value.
      const latest = await threadOf(documentId, threadId)
      const changedUnderUs = sentState !== null && latest !== undefined && (latest.resolved === true) !== sentState
      if (resolveRerun.delete(key) || changedUnderUs) {
        pushResolveToShare(documentId, threadId)
      }
    }
  })())
}

/**
 * Take a thread the author deleted in Prose off the shared page too (#903):
 * the gateway removes it with its replies. Called with the thread as it was
 * (the push needs its shareId). Local-only threads (no shareId) never
 * reached the page and are a no-op.
 */
export function pushRemoveToShare(documentId: string, thread: { shareId?: string }): void {
  if (!isWebPlatformEnabled() || !thread.shareId) return
  const shareId = thread.shareId
  // The entry is looked up by the document's own path, pinned now; a
  // document switch during the lookup changes nothing.
  const path = documentPathOf(documentId)
  if (!path) return
  track((async () => {
    const res = await getApi().shareGetForPath(path)
    const entry = res.ok && res.entries.length > 0 ? res.entries[0] : null
    if (entry) sendRemove(entry.publicationId, shareId)
  })())
}

// The removal's target is pinned to the publication it was made against: a
// queued retry can fire after the user switched documents.
function sendRemove(publicationId: string, shareId: string): void {
  const op: PendingOp = { kind: 'remove', publicationId, shareId }
  if (isRateLimited()) {
    queueOnce(op)
    return
  }
  const key = opKey(op)
  if (inFlight.has(key)) return
  inFlight.add(key)

  track((async () => {
    try {
      const res = await getApi().shareRemoveComment(publicationId, shareId)
      if (!res.ok) {
        noteRateLimit(res.code)
        // Gone already (revoked link, or a row the gateway doesn't have):
        // nothing left to remove, so don't retry forever.
        if (res.code !== 'not_found' && res.code !== 'revoked') queueOnce(op)
        reportPushError(res.error, res.code)
        return
      }
      clearPushError()
    } catch {
      queueOnce(op)
    } finally {
      inFlight.delete(key)
    }
  })())
}

/** Retry queued pushes (window focus, or after a successful content push). */
export function flushPendingShareOps(): void {
  if (pendingOps.length === 0 || isRateLimited()) return
  const ops = pendingOps
  pendingOps = []
  for (const op of ops) {
    if (op.kind === 'thread') pushNewThreadToShare(op.documentId, op.threadId)
    else if (op.kind === 'reply') pushReplyToShare(op.documentId, op.threadId, op.replyId)
    else if (op.kind === 'remove') sendRemove(op.publicationId, op.shareId)
    else pushResolveToShare(op.documentId, op.threadId)
  }
}

/**
 * The pushes a comment transition recorded on its plugin state, performed
 * for the document that owns it (document/session.ts hands them over once
 * per transition, #1147).
 */
export function performSharePushes(target: { documentId: string }, pushes: readonly SharePush[]): void {
  for (const push of pushes) {
    switch (push.kind) {
      case 'thread':
        pushNewThreadToShare(target.documentId, push.threadId)
        break
      case 'reply':
        pushReplyToShare(target.documentId, push.threadId, push.replyId)
        break
      case 'resolve':
        pushResolveToShare(target.documentId, push.threadId)
        break
      case 'remove':
        pushRemoveToShare(target.documentId, push.thread)
        break
    }
  }
}

registerSharePushPerformer(performSharePushes)
