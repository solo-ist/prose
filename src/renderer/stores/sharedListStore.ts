/**
 * sharedListStore (#1036) — every share this desktop knows about, for the
 * explorer's "Shared" view and the ◎ indicator on shared rows in the folder
 * tree. One `shareList()` IPC feeds both consumers; FileListPanel owns the
 * refresh wiring (view entry, share-state changes, in-list revoke).
 *
 * Source: the local share-sync.json only — revoked tombstones included, so
 * "previously shared" is never lost. Reconciling with the gateway's own list
 * is #1037. Entries carry `shareUrl` (a capability token): consumers must
 * never render or log it beyond the explicit copy/open actions.
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { getApi } from '../lib/browserApi'
import { isWebPlatformEnabled } from '../lib/featureFlags'
import type { ShareEntry } from '../types'

const EMPTY_PATH_SET: ReadonlySet<string> = new Set()

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
   * answers "is anything live for this file". Don't narrow it in #1037.
   */
  sharedPaths: ReadonlySet<string>
  isLoading: boolean
  loadedOnce: boolean
  refresh: () => Promise<void>
}

// Overlapping refreshes (view entry racing a publish) resolve out of order;
// only the newest request may write.
let requestSeq = 0

export const useSharedListStore = create<SharedListState>()(
  subscribeWithSelector((set) => ({
    entries: [],
    activeOrigin: null,
    missingPaths: EMPTY_PATH_SET,
    sharedPaths: EMPTY_PATH_SET,
    isLoading: false,
    loadedOnce: false,

    refresh: async () => {
      if (!isWebPlatformEnabled()) {
        set({ entries: [], activeOrigin: null, missingPaths: EMPTY_PATH_SET, sharedPaths: EMPTY_PATH_SET, isLoading: false })
        return
      }
      const seq = ++requestSeq
      set({ isLoading: true })
      try {
        const api = getApi()
        const res = await api.shareList()
        if (seq !== requestSeq) return
        if (!res.ok) {
          console.error('[sharedListStore] shareList failed:', res.error)
          set({ isLoading: false, loadedOnce: true })
          return
        }
        const { entries, activeOrigin } = res

        // Probe unique paths for existence (same shape as pruneMissingRecentFiles).
        // Browser mode has no real fileExists — treat nothing as missing there.
        const missing = new Set<string>()
        if (window.api?.fileExists) {
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
          if (seq !== requestSeq) return
        }

        const sharedPaths = new Set(entries.filter((e) => !e.revokedAt).map((e) => e.localPath))
        set({ entries, activeOrigin, missingPaths: missing, sharedPaths, isLoading: false, loadedOnce: true })
      } catch (err) {
        console.error('[sharedListStore] refresh failed:', err)
        if (seq === requestSeq) set({ isLoading: false, loadedOnce: true })
      }
    },
  }))
)
