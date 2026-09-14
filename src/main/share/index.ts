/**
 * share/index.ts — main-process orchestration for the share service (#768):
 * gateway client + local sync metadata, shaped for the `share:*` IPC handlers.
 *
 * Scope note: this is the PUBLISH half (one-way). The bidirectional pull/merge
 * engine (re-anchoring reviewer comments into the editor's comment store) is
 * #769 — `fetchAllComments` here is a read-only view that deliberately does
 * NOT advance the sync cursor.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getSettingsDir } from '../paths'
import * as client from './client'
import {
  type ShareSyncEntry,
  getShareEntriesByPath,
  getShareEntry,
  listShareEntries,
  patchShareEntry,
  recordShareAck,
  upsertShareEntry,
  updateShareLocalPath,
} from './metadata'

export const DEFAULT_GATEWAY_URL = 'https://prose-gateway.onrender.com'

// Every request to the gateway carries the safeStorage session cookie, and
// settings.json is renderer-writable — an arbitrary gatewayUrl would let a
// compromised renderer point the session (and published document HTML) at
// any host (#907). Allowlist what the dogfood flow actually uses: any
// https:// origin under our domains, plus loopback for local gateway dev.
// There is deliberately no settings UI for this field; hand-edits outside
// the allowlist fall back to the default.
function isAllowedGatewayUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.username || u.password) return false
    const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol === 'http:') return loopback
    if (u.protocol !== 'https:') return false
    return (
      loopback ||
      u.hostname === 'prose-gateway.onrender.com' ||
      u.hostname === 'prose.solo.ist' ||
      u.hostname.endsWith('.prose.solo.ist') ||
      u.hostname.endsWith('.solo.ist')
    )
  } catch {
    return false
  }
}

/** Gateway origin from settings (webPlatform.gatewayUrl), else the default. */
export async function getShareConfig(): Promise<client.ShareClientConfig> {
  try {
    const raw = await readFile(join(getSettingsDir(), 'settings.json'), 'utf-8')
    const settings = JSON.parse(raw) as { webPlatform?: { gatewayUrl?: string } }
    const url = settings.webPlatform?.gatewayUrl
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      if (isAllowedGatewayUrl(url)) return { baseUrl: url }
      console.warn(`[share] gatewayUrl ${url} is outside the allowlist — using the default gateway`)
    }
  } catch {
    // Missing/malformed settings → default
  }
  return { baseUrl: DEFAULT_GATEWAY_URL }
}

export type ShareResult<T> = { ok: true } & T | { ok: false; error: string; code?: string }

function asError(err: unknown): { ok: false; error: string; code?: string } {
  if (err instanceof client.ShareClientError) {
    return { ok: false, error: err.message, code: err.code }
  }
  const message = err instanceof Error ? err.message : 'Unknown error'
  // Network-level failures (gateway down/unreachable) read better than raw fetch errors.
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/.test(message)) {
    return { ok: false, error: 'Cannot reach the gateway. Is it running?', code: 'unreachable' }
  }
  return { ok: false, error: message }
}

export async function authStatus(): Promise<ShareResult<{ signedIn: boolean; email?: string; gatewayUrl: string }>> {
  const config = await getShareConfig()
  try {
    const status = await client.checkSession(config)
    return { ok: true, ...status, gatewayUrl: config.baseUrl }
  } catch (err) {
    return asError(err)
  }
}

export async function requestSignIn(email: string): Promise<ShareResult<object>> {
  try {
    await client.requestSignIn(await getShareConfig(), email)
    return { ok: true }
  } catch (err) {
    return asError(err)
  }
}

export async function completeSignIn(magicUrl: string): Promise<ShareResult<{ email?: string }>> {
  const config = await getShareConfig()
  try {
    await client.completeSignIn(config, magicUrl)
    const status = await client.checkSession(config)
    return { ok: true, email: status.email }
  } catch (err) {
    return asError(err)
  }
}

export async function signOut(): Promise<ShareResult<object>> {
  await client.signOut()
  return { ok: true }
}

export async function publish(args: {
  title: string
  html: string
  localPath: string
  documentId: string
}): Promise<ShareResult<{ entry: ShareSyncEntry }>> {
  const config = await getShareConfig()
  try {
    const result = await client.publishArtifact(config, args.title, args.html)
    const entry: ShareSyncEntry = {
      publicationId: result.publicationId,
      shareUrl: result.shareUrl,
      localPath: args.localPath,
      documentId: args.documentId,
      title: args.title,
      publishRev: result.publishRev,
      revCount: result.revCount,
      publishedAt: new Date().toISOString(),
      lastPulledAt: null,
      lastCommentCursor: null,
      revokedAt: null,
      syncMode: 'auto',
    }
    await upsertShareEntry(entry)
    return { ok: true, entry }
  } catch (err) {
    return asError(err)
  }
}

export async function republish(args: {
  publicationId: string
  title: string
  html: string
}): Promise<ShareResult<{ entry: ShareSyncEntry }>> {
  const config = await getShareConfig()
  try {
    const result = await client.republishArtifact(config, args.publicationId, args.title, args.html)
    const entry = await patchShareEntry(args.publicationId, {
      title: args.title,
      publishRev: result.publishRev,
      revCount: result.revCount,
    })
    if (!entry) return { ok: false, error: 'No local record of this share.' }
    return { ok: true, entry }
  } catch (err) {
    return asError(err)
  }
}

export async function revoke(publicationId: string): Promise<ShareResult<object>> {
  const config = await getShareConfig()
  try {
    await client.revokePublication(config, publicationId)
    await patchShareEntry(publicationId, { revokedAt: new Date().toISOString() })
    return { ok: true }
  } catch (err) {
    return asError(err)
  }
}

export async function list(): Promise<ShareResult<{ entries: ShareSyncEntry[] }>> {
  return { ok: true, entries: await listShareEntries() }
}

export async function getForPath(localPath: string): Promise<ShareResult<{ entries: ShareSyncEntry[] }>> {
  return { ok: true, entries: await getShareEntriesByPath(localPath) }
}

/**
 * Fetch the COMPLETE comment set by walking the gateway's 500-row pages
 * (since = last page's createdAt cursor; gte + id-dedupe handles the
 * boundary). createdAt is immutable and deletes are tombstones, so a
 * createdAt walk enumerates every row exactly once — a single capped page
 * is NOT the complete set, and treating it as one made the backfill judge
 * rows past the cap "stale", duplicating live rows and resurrecting
 * tombstones (#906).
 */
async function fetchCompleteComments(
  config: client.ShareClientConfig,
  publicationId: string
): Promise<{ comments: client.PulledShareComment[]; nextCursor: string | null }> {
  const seen = new Set<string>()
  const all: client.PulledShareComment[] = []
  let since: string | null = null
  let cursor: string | null = null
  // Hard stop at 40 pages (20k rows) — far past any Phase-0 conversation.
  for (let page = 0; page < 40; page++) {
    const { comments, nextCursor } = await client.fetchComments(config, publicationId, since)
    let added = 0
    for (const c of comments) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        all.push(c)
        added++
      }
    }
    cursor = nextCursor ?? cursor
    if (comments.length < 500 || !nextCursor) break
    if (nextCursor === since && added === 0) {
      // >500 rows in one millisecond — the documented KNOWN LIMIT on the
      // route. Surface it; a compound cursor is the eventual fix.
      console.warn(`[share] pull for ${publicationId} stalled at a same-millisecond page boundary — set may be truncated`)
      break
    }
    since = nextCursor
  }
  return { comments: all, nextCursor: cursor }
}

/** Read-only comment view for the ShareDialog list. Does NOT advance the sync cursor. */
export async function fetchAllComments(
  publicationId: string
): Promise<ShareResult<{ comments: client.PulledShareComment[] }>> {
  const config = await getShareConfig()
  const entry = await getShareEntry(publicationId)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  try {
    const { comments } = await fetchCompleteComments(config, publicationId)
    return { ok: true, comments }
  } catch (err) {
    return asError(err)
  }
}

/**
 * Sync pull (#769): the COMPLETE comment set, deliberately cursor-less —
 * same rationale as the viewer poll. The gateway's `since` filters on
 * createdAt, and edits/tombstones don't bump createdAt, so a sync cursor
 * would permanently hide revisions of rows older than it (#905). The
 * renderer merge dedupes by id, applyRevisions adopts edits/deletions, and
 * the seenRowIds ledger (recorded via the ack) keeps author-deleted rows
 * from resurrecting out of the full set.
 */
export async function pullComments(
  publicationId: string
): Promise<ShareResult<{ comments: client.PulledShareComment[]; nextCursor: string | null }>> {
  const config = await getShareConfig()
  const entry = await getShareEntry(publicationId)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  try {
    const { comments, nextCursor } = await fetchCompleteComments(config, publicationId)
    return { ok: true, comments, nextCursor }
  } catch (err) {
    return asError(err)
  }
}

/**
 * Second phase of the sync pull: the renderer persisted the merge — record
 * lastPulledAt, the (informational) cursor, and the pulled row ids into the
 * seenRowIds ledger. The ordering is the safety property: ids land here
 * only AFTER the merge persisted, so a crashed merge re-pulls its rows.
 */
export async function ackCommentCursor(
  publicationId: string,
  cursor: string,
  seenRowIds: string[] = []
): Promise<ShareResult<object>> {
  const entry = await recordShareAck(publicationId, cursor, seenRowIds)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  return { ok: true }
}

/** Switch a publication's content sync mode (#769). */
export async function setSyncMode(
  publicationId: string,
  mode: string
): Promise<ShareResult<{ entry: ShareSyncEntry }>> {
  if (mode !== 'auto' && mode !== 'publish') {
    return { ok: false, error: 'Invalid sync mode.' }
  }
  const entry = await patchShareEntry(publicationId, { syncMode: mode })
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  return { ok: true, entry }
}

/** Push a new author comment thread into the live conversation (#769). */
export async function createComment(
  publicationId: string,
  args: { markedText: string; occurrenceIndex: number; text: string; authorName?: string; fromAuthor?: boolean }
): Promise<ShareResult<{ id: string; createdAt: string }>> {
  const config = await getShareConfig()
  const entry = await getShareEntry(publicationId)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  try {
    const result = await client.postAuthorComment(config, publicationId, args)
    return { ok: true, ...result }
  } catch (err) {
    return asError(err)
  }
}

/** Push an author reply into the live conversation (#769). */
export async function replyToComment(
  publicationId: string,
  commentId: string,
  text: string,
  authorName?: string,
  fromAuthor?: boolean
): Promise<ShareResult<{ id: string; createdAt: string }>> {
  const config = await getShareConfig()
  const entry = await getShareEntry(publicationId)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  try {
    const result = await client.postAuthorReply(config, publicationId, commentId, text, authorName, fromAuthor)
    return { ok: true, ...result }
  } catch (err) {
    return asError(err)
  }
}

/** Push author-controlled resolution state (#769). */
export async function resolveComment(
  publicationId: string,
  commentId: string,
  resolved: boolean
): Promise<ShareResult<object>> {
  const config = await getShareConfig()
  const entry = await getShareEntry(publicationId)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  try {
    await client.setCommentResolved(config, publicationId, commentId, resolved)
    return { ok: true }
  } catch (err) {
    return asError(err)
  }
}

export async function renamedLocalPath(
  oldPath: string,
  newPath: string,
  newDocumentId: string
): Promise<ShareResult<{ touched: number }>> {
  const touched = await updateShareLocalPath(oldPath, newPath, newDocumentId)
  return { ok: true, touched }
}
