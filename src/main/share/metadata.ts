/**
 * share/metadata.ts — per-share sync metadata (#768), modeled on the Google
 * sync metadata pattern (main/google/sync.ts). Persisted to
 * `<userData>/share-sync.json`.
 *
 * SECURITY: the raw capability token and the gateway session are NEVER in
 * this file — they live in credentialStore (safeStorage). This JSON is safe
 * to include in diagnostics.
 */
import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export interface ShareSyncEntry {
  publicationId: string
  /** The full share URL (contains the capability token — display/copy only; the token half is also in credentialStore). */
  shareUrl: string
  localPath: string
  documentId: string
  title: string
  publishRev: string
  revCount: number
  publishedAt: string
  lastPulledAt: string | null
  lastCommentCursor: string | null
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
  await writeFile(metadataPath(), JSON.stringify(meta, null, 2), 'utf-8')
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

export async function upsertShareEntry(entry: ShareSyncEntry): Promise<void> {
  const meta = await load()
  meta.shares[entry.publicationId] = entry
  await save(meta)
}

export async function patchShareEntry(
  publicationId: string,
  patch: Partial<ShareSyncEntry>
): Promise<ShareSyncEntry | null> {
  const meta = await load()
  const existing = meta.shares[publicationId]
  if (!existing) return null
  const updated = { ...existing, ...patch }
  meta.shares[publicationId] = updated
  await save(meta)
  return updated
}

/** Rename/move hook: keep share entries pointing at the document's new path. */
export async function updateShareLocalPath(
  oldPath: string,
  newPath: string,
  newDocumentId: string
): Promise<number> {
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
}
