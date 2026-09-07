/**
 * shareStore — share state for the ACTIVE document (#769): the publication
 * entry, content-push status, and the status-icon popover. Refreshed on
 * document/tab switches by useShareContentSync (lib/shareContentSync).
 *
 * The status model backs the pinned share icon: content follows the sync
 * mode (auto | publish); the conversation is always live. `shareDirty` is
 * view-state for the active document only — it resets on document switch and
 * app relaunch (documented D6 limitation; a missed push is retried on the
 * next save/focus anyway).
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { getApi } from '../lib/browserApi'
import { isWebPlatformEnabled } from '../lib/featureFlags'
import { useEditorStore } from './editorStore'
import { useCommentStore, countOpenThreads } from '../extensions/comments/store'
import type { ShareEntry } from '../types'

export type ShareStatus = 'synced' | 'dirty' | 'syncing' | 'error' | 'offline'

interface ShareState {
  /** Active publication for the current document; null → icon absent. */
  entry: ShareEntry | null
  /** A content push is in flight right now. */
  pushing: boolean
  /** Content changed (saved) since the last successful push. */
  shareDirty: boolean
  lastError: string | null
  lastErrorCode: string | null
  lastPushAt: number
  popoverOpen: boolean
  /**
   * Reviewer comments synced in since the user last looked (popover opened
   * or Comment Review entered). Drives the breathing badge on the ◎ icon.
   */
  unseenComments: number

  refreshForActiveDocument: () => Promise<void>
  applyEntry: (entry: ShareEntry | null) => void
  setSyncMode: (mode: 'auto' | 'publish') => Promise<void>
  markShareDirty: () => void
  clearShareDirty: () => void
  setPushing: (pushing: boolean) => void
  setError: (message: string | null, code?: string | null) => void
  setPopoverOpen: (open: boolean) => void
  addUnseenComments: (n: number) => void
  clearUnseenComments: () => void
}

/** The single state → icon/status-line mapping. */
export function deriveShareStatus(s: {
  pushing: boolean
  shareDirty: boolean
  lastError: string | null
  lastErrorCode: string | null
  entry: ShareEntry | null
}): ShareStatus {
  if (s.pushing) return 'syncing'
  if (s.lastErrorCode === 'unreachable') return 'offline'
  if (s.lastError) return 'error'
  if (s.shareDirty && s.entry?.syncMode === 'publish') return 'dirty'
  return 'synced'
}

/** Open-thread count for the popover's Conversation row — the #830 predicate. */
export function openThreadCount(): number {
  return countOpenThreads(useCommentStore.getState().pendingComments)
}

export const useShareStore = create<ShareState>()(
  subscribeWithSelector((set, get) => ({
    entry: null,
    pushing: false,
    shareDirty: false,
    lastError: null,
    lastErrorCode: null,
    lastPushAt: 0,
    popoverOpen: false,
    unseenComments: 0,

    refreshForActiveDocument: async () => {
      if (!isWebPlatformEnabled()) {
        set({ entry: null, popoverOpen: false })
        return
      }
      const path = useEditorStore.getState().document.path
      if (!path) {
        set({ entry: null, popoverOpen: false })
        return
      }
      const res = await getApi().shareGetForPath(path)
      const entry = res.ok && res.entries.length > 0 ? res.entries[0] : null
      // Guard against a doc switch racing the lookup.
      if (useEditorStore.getState().document.path !== path) return
      set({ entry })
    },

    applyEntry: (entry) => {
      set({ entry, ...(entry ? {} : { popoverOpen: false }) })
    },

    setSyncMode: async (mode) => {
      const entry = get().entry
      if (!entry) return
      const res = await getApi().shareSetSyncMode(entry.publicationId, mode)
      if (res.ok) {
        set({ entry: res.entry, lastError: null, lastErrorCode: null })
      } else {
        set({ lastError: res.error, lastErrorCode: res.code ?? null })
      }
    },

    markShareDirty: () => set({ shareDirty: true }),
    clearShareDirty: () => set({ shareDirty: false }),
    setPushing: (pushing) => set({ pushing }),
    setError: (message, code = null) => set({ lastError: message, lastErrorCode: code }),
    setPopoverOpen: (open) => set({ popoverOpen: open }),
    addUnseenComments: (n) => set((s) => ({ unseenComments: s.unseenComments + n })),
    clearUnseenComments: () => set({ unseenComments: 0 }),
  }))
)
