/**
 * share/index.ts — main-process orchestration for the share service (#768):
 * gateway client + local sync metadata, shaped for the `share:*` IPC handlers.
 *
 * Scope note: this is the PUBLISH half (one-way). The bidirectional pull/merge
 * engine (re-anchoring reviewer comments into the editor's comment store) is
 * #769 — `fetchAllComments` here is a read-only view that deliberately does
 * NOT advance the sync cursor.
 */
import { randomBytes, timingSafeEqual } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getSettingsDir } from '../paths'
import * as client from './client'
import {
  type ShareSyncEntry,
  documentIdFromPath,
  getShareEntriesByPath,
  getShareEntry,
  listShareEntries,
  patchShareEntry,
  recordShareAck,
  upsertShareEntry,
  updateShareLocalPath,
} from './metadata'

export { documentIdFromPath }

export const DEFAULT_GATEWAY_URL = 'https://api.prose.solo.ist'

// Every request to the gateway carries the safeStorage session cookie, and
// settings.json is renderer-writable — an arbitrary gatewayUrl would let a
// compromised renderer point the session (and published document HTML) at
// any host (#907). Only the production API host is allowed over https, plus
// loopback for local gateway dev. The share hosts (*.share.prose.solo.ist)
// serve published pages, never the API, so they are deliberately excluded.
// There is deliberately no settings UI for this field; hand-edits outside
// the allowlist fall back to the default.
function isAllowedGatewayUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.username || u.password) return false
    const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol === 'http:') return loopback
    if (u.protocol !== 'https:') return false
    return loopback || u.hostname === 'api.prose.solo.ist'
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

/** The signed-in user's standing in the sharing beta (#1018). */
export async function access(): Promise<ShareResult<client.ShareAccess>> {
  const config = await getShareConfig()
  try {
    return { ok: true, ...(await client.fetchAccess(config)) }
  } catch (err) {
    return asError(err)
  }
}

/** Ask to join the sharing beta (#1018). */
export async function requestAccess(): Promise<ShareResult<client.ShareAccess>> {
  const config = await getShareConfig()
  try {
    return { ok: true, ...(await client.requestAccess(config)) }
  } catch (err) {
    return asError(err)
  }
}

/**
 * The sign-in this desktop is waiting on (#964). The email is recorded HERE,
 * at request time, and is the only one a code is ever submitted with — the
 * renderer supplies just the digits. A code only signs in the address it was
 * mailed to, so a code from someone else's inbox (pasted in by mistake or by
 * social engineering) can't sign this desktop into their account. That
 * replaces the renderer-side login-CSRF guard the magic-link flow needed.
 * Bound to the gateway origin it was requested from; lives as long as a code.
 * `state` is the nonce the email's "Open in Prose" link carries back
 * (completeSignInFromLink).
 */
interface PendingSignIn {
  email: string
  origin: string
  state: string
  expiresAt: number
}
const PENDING_SIGN_IN_TTL_MS = 10 * 60 * 1000
let pendingSignIn: PendingSignIn | null = null

export async function requestSignIn(email: string): Promise<ShareResult<object>> {
  const config = await getShareConfig()
  const normalized = email.trim().toLowerCase()
  const state = randomBytes(16).toString('base64url')
  try {
    await client.requestSignIn(config, normalized, state)
    pendingSignIn = {
      email: normalized,
      origin: new URL(config.baseUrl).origin,
      state,
      expiresAt: Date.now() + PENDING_SIGN_IN_TTL_MS,
    }
    return { ok: true }
  } catch (err) {
    return asError(err)
  }
}

export async function completeSignIn(code: string): Promise<ShareResult<{ email?: string }>> {
  const digits = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(digits)) {
    return { ok: false, error: 'Enter the 6-digit code from the email.', code: 'invalid_code' }
  }
  const config = await getShareConfig()
  const pending = pendingSignIn
  if (!pending || pending.origin !== new URL(config.baseUrl).origin) {
    return { ok: false, error: 'Send a sign-in code first.', code: 'no_pending' }
  }
  if (pending.expiresAt < Date.now()) {
    return { ok: false, error: 'That code has expired. Send a new one.', code: 'OTP_EXPIRED' }
  }
  try {
    await client.completeSignIn(config, pending.email, digits)
    const status = await client.checkSession(config)
    // Defense in depth: the session must belong to the address we asked for.
    if (!status.signedIn || status.email?.toLowerCase() !== pending.email) {
      await client.signOut(config)
      return { ok: false, error: 'Sign-in returned a different account. Send a new code.', code: 'session_mismatch' }
    }
    pendingSignIn = null
    return { ok: true, email: status.email }
  } catch (err) {
    return asError(err)
  }
}

/**
 * Complete sign-in from the email's prose://auth deep link (#964). Returns
 * null — the link is ignored, nothing is sent — unless this desktop is
 * waiting on a sign-in whose state matches. Without that check, any web page
 * or message could fire a crafted link at Prose.
 */
export async function completeSignInFromLink(
  code: string,
  state: string
): Promise<ShareResult<{ email?: string }> | null> {
  const pending = pendingSignIn
  if (!pending || pending.expiresAt < Date.now()) return null
  const expected = Buffer.from(pending.state)
  const given = Buffer.from(state)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return completeSignIn(code)
}

export async function signOut(): Promise<ShareResult<object>> {
  await client.signOut(await getShareConfig())
  return { ok: true }
}

/**
 * Share entries are bound to the gateway that minted them (audit M-02):
 * operating on a publication id against a DIFFERENT gateway silently
 * targets the wrong service — worst on revoke, where a 404 used to read as
 * success while the original link stayed live. Legacy entries (no recorded
 * origin) are tolerated and adopt the current origin on their next patch.
 */
function entryOriginError(entry: ShareSyncEntry, config: client.ShareClientConfig): { ok: false; error: string; code: string } | null {
  if (!entry.gatewayOrigin) return null
  try {
    if (entry.gatewayOrigin === new URL(config.baseUrl).origin) return null
  } catch {
    return null
  }
  return {
    ok: false,
    error: `This share lives on ${entry.gatewayOrigin} — switch the gateway back to manage it.`,
    code: 'wrong_gateway',
  }
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
      gatewayOrigin: new URL(config.baseUrl).origin,
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
  const existing = await getShareEntry(args.publicationId)
  if (existing) {
    const mismatch = entryOriginError(existing, config)
    if (mismatch) return mismatch
  }
  // Extract the raw token from the stored shareUrl. The capability token is
  // the last path segment of /s/<token>; it lives nowhere but the shareUrl
  // itself. The server no longer accepts or echoes it — we only need it here
  // to reconstruct the canonical URL from the shareOrigin the server returns.
  const tokenMatch = existing?.shareUrl?.match(/\/s\/([^/?#]+)/)
  const rawToken = tokenMatch ? tokenMatch[1] : undefined
  try {
    const result = await client.republishArtifact(config, args.publicationId, args.title, args.html)
    const patch: Partial<ShareSyncEntry> = {
      title: args.title,
      publishRev: result.publishRev,
      revCount: result.revCount,
    }
    // If the server returned a shareOrigin (e.g. the first re-bake after
    // SHARE_SUBDOMAINS is enabled), reconstruct the canonical shareUrl so the
    // ◎ popover copies the new label-subdomain link. Only update if it differs
    // from what is already stored.
    if (result.shareOrigin && rawToken) {
      const canonical = `${result.shareOrigin}/s/${rawToken}`
      if (canonical !== existing?.shareUrl) patch.shareUrl = canonical
    }
    const entry = await patchShareEntry(args.publicationId, patch)
    if (!entry) return { ok: false, error: 'No local record of this share.' }
    return { ok: true, entry }
  } catch (err) {
    return asError(err)
  }
}

export async function revoke(publicationId: string): Promise<ShareResult<object>> {
  const config = await getShareConfig()
  const existing = await getShareEntry(publicationId)
  if (existing) {
    const mismatch = entryOriginError(existing, config)
    if (mismatch) return mismatch
  }
  try {
    await client.revokePublication(config, publicationId)
    await patchShareEntry(publicationId, { revokedAt: new Date().toISOString() })
    return { ok: true }
  } catch (err) {
    return asError(err)
  }
}

/**
 * Every local share entry (revoked tombstones included, newest first) plus
 * the active gateway origin, so the explorer's Shared view (#1036) can flag
 * entries minted elsewhere without re-deriving the allowlist logic here.
 */
export async function list(): Promise<
  ShareResult<{ entries: ShareSyncEntry[]; activeOrigin: string | null }>
> {
  const entries = await listShareEntries()
  let activeOrigin: string | null = null
  try {
    activeOrigin = new URL((await getShareConfig()).baseUrl).origin
  } catch {
    // Malformed baseUrl — the renderer treats every entry as current.
  }
  return { ok: true, entries, activeOrigin }
}

/**
 * Reconcile with the gateway's own list (#1037). Two outcomes:
 *
 * 1. A local LIVE entry on the active origin that the server says is revoked
 *    becomes a local tombstone — server truth for revocation, persisted so
 *    the next offline launch is right too (the dev/installed profile split
 *    and "revoked from another machine" both land here).
 * 2. The full server list goes back so the renderer can show publications
 *    this device has no entry for ("not on this device").
 *
 * Deliberately NOT adopted: a local live entry the server doesn't list. That
 * means hard-deleted — or signed in as a different account on the same
 * gateway — and tombstoning on either guess would be wrong. The renderer
 * flags it; nothing is written.
 */
export async function listRemote(): Promise<
  ShareResult<{ publications: client.PublicationSummary[]; origin: string; adoptedRevocations: number }>
> {
  const config = await getShareConfig()
  try {
    const publications = await client.listPublications(config)
    const origin = new URL(config.baseUrl).origin
    const byId = new Map(publications.map((p) => [p.publicationId, p]))
    let adoptedRevocations = 0
    for (const entry of await listShareEntries()) {
      if (entry.revokedAt) continue
      if (entry.gatewayOrigin && entry.gatewayOrigin !== origin) continue
      const remote = byId.get(entry.publicationId)
      if (remote?.revokedAt) {
        await patchShareEntry(entry.publicationId, { revokedAt: remote.revokedAt })
        adoptedRevocations++
      }
    }
    return { ok: true, publications, origin, adoptedRevocations }
  } catch (err) {
    return asError(err)
  }
}

/**
 * Look up non-revoked share entries for a local path, scoped to the active
 * gateway origin (M-02 / deterministic lookup fix):
 *
 * 1. Entries are sorted newest-first (getShareEntriesByPath).
 * 2. Entries whose gatewayOrigin matches the active gateway are returned.
 * 3. If no origin-matching entries exist, legacy entries (no gatewayOrigin)
 *    are returned as a fallback so pre-origin-field publications keep working.
 *
 * This prevents a stale localhost entry from shadowing a production entry
 * (or vice versa) and causing every operation to fail with wrong_gateway.
 */
export async function getForPath(localPath: string): Promise<ShareResult<{ entries: ShareSyncEntry[] }>> {
  const all = await getShareEntriesByPath(localPath)
  const config = await getShareConfig()
  let activeOrigin: string | null = null
  try {
    activeOrigin = new URL(config.baseUrl).origin
  } catch {
    // Malformed baseUrl — skip origin filtering
  }
  if (!activeOrigin) return { ok: true, entries: all }

  const matching = all.filter((e) => e.gatewayOrigin === activeOrigin)
  if (matching.length > 0) return { ok: true, entries: matching }

  // Fall back to legacy entries (no gatewayOrigin recorded) when no
  // origin-matching entries exist.
  const legacy = all.filter((e) => !e.gatewayOrigin)
  return { ok: true, entries: legacy }
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
): Promise<{ comments: client.PulledShareComment[]; nextCursor: string | null; complete: boolean }> {
  const seen = new Set<string>()
  const all: client.PulledShareComment[] = []
  let since: string | null = null
  let cursor: string | null = null
  let complete = false
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
    if (comments.length < 500 || !nextCursor) {
      complete = true
      break
    }
    if (nextCursor === since && added === 0) {
      // >500 rows in one millisecond — the documented KNOWN LIMIT on the
      // route. Surface it; a compound cursor is the eventual fix.
      console.warn(`[share] pull for ${publicationId} stalled at a same-millisecond page boundary — set may be truncated`)
      break
    }
    since = nextCursor
  }
  return { comments: all, nextCursor: cursor, complete }
}

/**
 * Row ids from the last COMPLETE sync pull per publication, for pruning the
 * seenRowIds ledger. The ledger only matters for ids the server still
 * returns, and a vanished id never comes back (revoke hard-deletes, re-seeds
 * mint fresh ids), so the ack trims it to this set instead of letting it grow
 * with every comment ever seen. Kept in main, not taken from the renderer's
 * ack, and only set when the pull was complete: pruning against a truncated
 * pull would drop live ids and let author-deleted threads resurrect.
 */
const lastCompletePullIds = new Map<string, Set<string>>()

/** Read-only comment view for the ShareDialog list. Does NOT advance the sync cursor. */
export async function fetchAllComments(
  publicationId: string
): Promise<ShareResult<{ comments: client.PulledShareComment[] }>> {
  const config = await getShareConfig()
  const entry = await getShareEntry(publicationId)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  const mismatch = entryOriginError(entry, config)
  if (mismatch) return mismatch
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
  const mismatch = entryOriginError(entry, config)
  if (mismatch) return mismatch
  try {
    const { comments, nextCursor, complete } = await fetchCompleteComments(config, publicationId)
    if (complete) lastCompletePullIds.set(publicationId, new Set(comments.map((c) => c.id)))
    else lastCompletePullIds.delete(publicationId)
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
  const entry = await recordShareAck(publicationId, cursor, seenRowIds, lastCompletePullIds.get(publicationId))
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
  const originMismatch = entryOriginError(entry, config)
  if (originMismatch) return originMismatch
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
  const originMismatch = entryOriginError(entry, config)
  if (originMismatch) return originMismatch
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
  const originMismatch = entryOriginError(entry, config)
  if (originMismatch) return originMismatch
  try {
    await client.setCommentResolved(config, publicationId, commentId, resolved)
    return { ok: true }
  } catch (err) {
    return asError(err)
  }
}

/** Author removal (#903): take a comment off the shared page. */
export async function removeComment(publicationId: string, commentId: string): Promise<ShareResult<object>> {
  const config = await getShareConfig()
  const entry = await getShareEntry(publicationId)
  if (!entry) return { ok: false, error: 'No local record of this share.' }
  const originMismatch = entryOriginError(entry, config)
  if (originMismatch) return originMismatch
  try {
    await client.removeComment(config, publicationId, commentId)
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
