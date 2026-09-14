/**
 * share/metadata.ts — per-share sync metadata (#768), modeled on the Google
 * sync metadata pattern (main/google/sync.ts). Persisted to
 * `<userData>/share-sync.json`.
 *
 * SECURITY: the gateway SESSION is never in this file — it lives in
 * credentialStore (safeStorage). However, each entry's `shareUrl` embeds the
 * raw capability token: treat this file like a password store. Do NOT
 * include it in diagnostics or bug reports without redacting the
 * /s/<token> path segment of every shareUrl.
 */
import { app } from 'electron'
import { chmod, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export interface ShareSyncEntry {
  publicationId: string
  /**
   * The full share URL. It embeds the raw capability token and THIS FILE is
   * its only store on disk (nothing shareUrl-related lives in
   * credentialStore — only the gateway session does). Hence the 0600 perms
   * and the redaction rule in the header. (#912)
   */
  shareUrl: string
  localPath: string
  documentId: string
  title: string
  publishRev: string
  revCount: number
  publishedAt: string
  lastPulledAt: string | null
  lastCommentCursor: string | null
  /**
   * Server row ids this desktop has merged at least once (#905 follow-up).
   * Pulls are cursor-less, so without this ledger a row the author deleted
   * locally would re-appear as "new" on every poll — a seen row that is
   * absent from the local store was deliberately removed and stays dead.
   * Recorded only after a successful merge persist (the ack), so a crashed
   * merge can never mark a row seen before it actually landed.
   */
  seenRowIds?: string[]
  revokedAt: string | null
  /**
   * Content sync mode (#769): 'auto' pushes the artifact in the background on
   * save; 'publish' freezes content until an explicit "Share latest updates".
   * The conversation (comments) is live in both modes.
   */
  syncMode: 'auto' | 'publish'
}

interface ShareSyncMetadata {
  version: 1
  /** Keyed by publicationId. */
  shares: Record<string, ShareSyncEntry>
}

function metadataPath(): string {
  return join(app.getPath('userData'), 'share-sync.json')
}

async function load(): Promise<ShareSyncMetadata> {
  try {
    const raw = await readFile(metadataPath(), 'utf-8')
    const parsed = JSON.parse(raw) as ShareSyncMetadata
    if (parsed?.version === 1 && parsed.shares) {
      // Shape drift tolerance: entries written before syncMode existed
      // default to 'auto' (the contract's default for new shares too).
      for (const entry of Object.values(parsed.shares)) {
        if (entry.syncMode !== 'auto' && entry.syncMode !== 'publish') entry.syncMode = 'auto'
      }
      return parsed
    }
  } catch {
    // Missing or malformed → fresh store
  }
  return { version: 1, shares: {} }
}

async function save(meta: ShareSyncMetadata): Promise<void> {
  // Owner-only perms to match the file's password-store posture (shareUrls
  // embed capability tokens). mode applies only on create, so chmod covers
  // files that already existed (PR #901 round 11).
  await writeFile(metadataPath(), JSON.stringify(meta, null, 2), { encoding: 'utf-8', mode: 0o600 })
  await chmod(metadataPath(), 0o600).catch(() => {})
}

// Every read-modify-write cycle serializes through this chain: two
// concurrent IPC handlers (a cursor ack racing a publish, a rename racing a
// pull) would otherwise interleave load/save and the later save would
// silently drop the earlier one's change (PR #901 round 9).
let writeChain: Promise<unknown> = Promise.resolve()

function serialized<T>(op: () => Promise<T>): Promise<T> {
  const next = writeChain.then(op, op)
  writeChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

export async function listShareEntries(): Promise<ShareSyncEntry[]> {
  const meta = await load()
  return Object.values(meta.shares).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export async function getShareEntry(publicationId: string): Promise<ShareSyncEntry | null> {
  const meta = await load()
  return meta.shares[publicationId] ?? null
}

export async function getShareEntriesByPath(localPath: string): Promise<ShareSyncEntry[]> {
  const meta = await load()
  return Object.values(meta.shares).filter((s) => s.localPath === localPath && !s.revokedAt)
}

export function upsertShareEntry(entry: ShareSyncEntry): Promise<void> {
  return serialized(async () => {
    const meta = await load()
    meta.shares[entry.publicationId] = entry
    await save(meta)
  })
}

export function patchShareEntry(
  publicationId: string,
  patch: Partial<ShareSyncEntry>
): Promise<ShareSyncEntry | null> {
  return serialized(async () => {
    const meta = await load()
    const existing = meta.shares[publicationId]
    if (!existing) return null
    const updated = { ...existing, ...patch }
    meta.shares[publicationId] = updated
    await save(meta)
    return updated
  })
}

/**
 * The sync ack: cursor + lastPulledAt + the seen-row ledger, merged in ONE
 * serialized read-modify-write so two racing acks can't drop each other's
 * ids (a plain patch would overwrite the array wholesale).
 */
export function recordShareAck(
  publicationId: string,
  cursor: string,
  rowIds: string[]
): Promise<ShareSyncEntry | null> {
  return serialized(async () => {
    const meta = await load()
    const existing = meta.shares[publicationId]
    if (!existing) return null
    const seen = new Set(existing.seenRowIds ?? [])
    for (const id of rowIds) seen.add(id)
    const updated: ShareSyncEntry = {
      ...existing,
      lastCommentCursor: cursor,
      lastPulledAt: new Date().toISOString(),
      seenRowIds: [...seen],
    }
    meta.shares[publicationId] = updated
    await save(meta)
    return updated
  })
}

/** Rename/move hook: keep share entries pointing at the document's new path. */
export function updateShareLocalPath(
  oldPath: string,
  newPath: string,
  newDocumentId: string
): Promise<number> {
  return serialized(async () => {
    const meta = await load()
    let touched = 0
    for (const entry of Object.values(meta.shares)) {
      if (entry.localPath === oldPath) {
        entry.localPath = newPath
        entry.documentId = newDocumentId
        touched++
      }
    }
    if (touched > 0) await save(meta)
    return touched
  })
}
