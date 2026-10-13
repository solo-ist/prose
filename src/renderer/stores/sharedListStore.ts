/**
 * sharedListStore (#1036, #1037) — every share this desktop knows about, for
 * the explorer's "Shared" view and the ◎ indicator on shared rows in the
 * folder tree. FileListPanel owns the refresh wiring (view entry, share-state
 * changes, in-list revoke).
 *
 * Two phases per refresh:
 *  1. Local: `shareList()` — share-sync.json, revoked tombstones included, so
 *     "previously shared" is never lost. Renders immediately.
 *  2. Gateway: `shareListRemote()` — the signed-in account's own list. Main
 *     adopts server-side revocations into the local file first (so a share
 *     revoked from another machine or profile stops reading as live), and
 *     the rows the device has no entry for surface as "not on this device".
 *     Signed out / no grant → silently local-only; unreachable → local-only
 *     with a note.
 *
 * Entries carry `shareUrl` (a capability token): consumers must never render
 * or log it beyond the explicit copy/open actions.
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { getApi } from '../lib/browserApi'
import { isWebPlatformEnabled } from '../lib/featureFlags'
import type { ShareEntry, SharePublicationSummary } from '../types'

const EMPTY_PATH_SET: ReadonlySet<string> = new Set()

export type RemoteStatus = 'idle' | 'ok' | 'signed-out' | 'error'

// A session problem (or no share_publish grant) is a normal local-only
// state, not an error to surface — the gateway simply has nothing for us.
const SILENT_REMOTE_CODES = new Set(['no_session', 'origin_mismatch', 'Unauthorized', 'forbidden'])

interface SharedListState {
  /** Every local entry, newest first, revoked tombstones included. */
  entries: ShareEntry[]
  /** Origin of the gateway the app currently points at (null if unknown). */
  activeOrigin: string | null
  /** localPaths that no longer exist on disk (delete/trash leave entries behind). */
  missingPaths: ReadonlySet<string>
  /**
   * localPaths with a live (non-revoked) share on ANY gateway origin. This is
   * deliberately broader than share:getForPath's origin scoping: the link is
   * live even when the active gateway can't manage it, and the tree indicator
   * answers "is anything live for this file". Local-only by design — the
   * gateway reconcile only ever narrows it by tombstoning local entries.
   */
  sharedPaths: ReadonlySet<string>
  isLoading: boolean
  loadedOnce: boolean

  /** Gateway rows keyed by publicationId (the active account's, any state). */
  remoteById: Record<string, SharePublicationSummary>
  /** Gateway rows with no entry on this device. */
  remoteOnly: SharePublicationSummary[]
  remoteStatus: RemoteStatus
  remoteError: string | null

  refresh: () => Promise<void>
}

// Overlapping refreshes (view entry racing a publish) resolve out of order;
// only the newest request may write.
let requestSeq = 0

function livePaths(entries: ShareEntry[]): ReadonlySet<string> {
  return new Set(entries.filter((e) => !e.revokedAt).map((e) => e.localPath))
}

/** Same shape as pruneMissingRecentFiles. Browser mode has no real fileExists — nothing is missing there. */
async function probeMissing(entries: ShareEntry[]): Promise<ReadonlySet<string>> {
  const missing = new Set<string>()
  if (!window.api?.fileExists) return missing
  const api = getApi()
  const uniquePaths = [...new Set(entries.map((e) => e.localPath))]
  await Promise.all(
    uniquePaths.map(async (path) => {
      try {
        if (!(await api.fileExists(path))) missing.add(path)
      } catch {
        missing.add(path)
      }
    })
  )
  return missing
}

export const useSharedListStore = create<SharedListState>()(
  subscribeWithSelector((set) => ({
    entries: [],
    activeOrigin: null,
    missingPaths: EMPTY_PATH_SET,
    sharedPaths: EMPTY_PATH_SET,
    isLoading: false,
    loadedOnce: false,
    remoteById: {},
    remoteOnly: [],
    remoteStatus: 'idle',
    remoteError: null,

    refresh: async () => {
      if (!isWebPlatformEnabled()) {
        set({
          entries: [], activeOrigin: null, missingPaths: EMPTY_PATH_SET, sharedPaths: EMPTY_PATH_SET,
          isLoading: false, remoteById: {}, remoteOnly: [], remoteStatus: 'idle', remoteError: null,
        })
        return
      }
      const seq = ++requestSeq
      set({ isLoading: true })
      try {
        const api = getApi()

        // Phase 1 — this device's list, rendered as soon as it's in.
        const local = await api.shareList()
        if (seq !== requestSeq) return
        if (!local.ok) {
          console.error('[sharedListStore] shareList failed:', local.error)
          set({ isLoading: false, loadedOnce: true })
          return
        }
        let entries = local.entries
        const missing = await probeMissing(entries)
        if (seq !== requestSeq) return
        set({
          entries, activeOrigin: local.activeOrigin, missingPaths: missing, sharedPaths: livePaths(entries),
          isLoading: false, loadedOnce: true,
        })

        // Phase 2 — the gateway's list for the signed-in account (#1037).
        const remote = await api.shareListRemote()
        if (seq !== requestSeq) return
        if (!remote.ok) {
          const silent = !!remote.code && SILENT_REMOTE_CODES.has(remote.code)
          set({
            remoteById: {}, remoteOnly: [],
            remoteStatus: silent ? 'signed-out' : 'error',
            remoteError: silent ? null : remote.error,
          })
          return
        }
        // Main tombstoned local entries the server revoked — re-read so the
        // rows (and the tree indicator) reflect it in this same refresh.
        if (remote.adoptedRevocations > 0) {
          const again = await api.shareList()
          if (seq !== requestSeq) return
          if (again.ok) {
            entries = again.entries
            set({ entries, sharedPaths: livePaths(entries) })
          }
        }
        const localIds = new Set(entries.map((e) => e.publicationId))
        const remoteById: Record<string, SharePublicationSummary> = {}
        const remoteOnly: SharePublicationSummary[] = []
        for (const p of remote.publications) {
          remoteById[p.publicationId] = p
          if (!localIds.has(p.publicationId)) remoteOnly.push(p)
        }
        set({ remoteById, remoteOnly, remoteStatus: 'ok', remoteError: null })
      } catch (err) {
        console.error('[sharedListStore] refresh failed:', err)
        if (seq === requestSeq) set({ isLoading: false, loadedOnce: true })
      }
    },
  }))
)
