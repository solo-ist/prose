import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'
import type { SyncProgress } from '../stores/fileListStore'
import { subscribeRemarkableProgress } from '../lib/remarkableBridge'

export type { SyncProgress }

// Module-level debounce for loadNotebooks calls fired off the notebook-done
// progress event. Without this, a sync of N notebooks fires N disk reads of
// sync-metadata.json, and each useRemarkableSync caller (FileListPanel +
// RemarkableIntegration) further multiplies that. The debounce coalesces
// rapid notebook-done events into one trailing read; removeSyncingNotebook
// stays immediate so the spinner clears promptly.
let loadNotebooksDebounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingLoadNotebooksDir: string | null = null
function scheduleLoadNotebooks(syncDir: string, loadFn: (dir: string) => void | Promise<void>): void {
  pendingLoadNotebooksDir = syncDir
  if (loadNotebooksDebounceTimer) clearTimeout(loadNotebooksDebounceTimer)
  loadNotebooksDebounceTimer = setTimeout(() => {
    loadNotebooksDebounceTimer = null
    const dir = pendingLoadNotebooksDir
    pendingLoadNotebooksDir = null
    if (dir) void loadFn(dir)
  }, 200)
}

export interface UseRemarkableSyncReturn {
  isSyncing: boolean
  lastSyncedAt: string | null
  error: string | null
  syncResult: { synced: number; skipped: number } | null
  progress: SyncProgress | null
  sync: () => Promise<void>
  cancel: () => Promise<void>
}

export function useRemarkableSync(): UseRemarkableSyncReturn {
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number } | null>(null)

  // Use a ref to prevent concurrent syncs (avoids stale closure issues)
  const syncLockRef = useRef(false)

  const settings = useSettingsStore((state) => state.settings)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
  const loadFiles = useFileListStore((state) => state.loadFiles)
  const loadNotebooks = useFileListStore((state) => state.loadNotebooks)
  const addSyncingNotebook = useFileListStore((state) => state.addSyncingNotebook)
  const removeSyncingNotebook = useFileListStore((state) => state.removeSyncingNotebook)
  const clearSyncingNotebooks = useFileListStore((state) => state.clearSyncingNotebooks)
  const loadCloudNotebooks = useFileListStore((state) => state.loadCloudNotebooks)
  const setRemarkableSyncActive = useFileListStore((state) => state.setRemarkableSyncActive)
  const setRemarkableSyncProgress = useFileListStore((state) => state.setRemarkableSyncProgress)
  const setRemarkableSyncError = useFileListStore((state) => state.setRemarkableSyncError)

  const isSyncing = useFileListStore((state) => state.remarkableSyncActive)
  const progress = useFileListStore((state) => state.remarkableSyncProgress)
  const error = useFileListStore((state) => state.remarkableSyncError)

  const remarkableSettings = settings.remarkable
  const lastSyncedAt = remarkableSettings?.lastSyncedAt ?? null
  const syncDir = remarkableSettings?.syncDirectory

  // Ref to avoid stale closure on syncDir in the progress subscription
  const syncDirRef = useRef(syncDir)
  syncDirRef.current = syncDir

  // Subscribe to sync progress events via the eager-init bridge. The bridge
  // owns the single window.api.onRemarkableSyncProgress IPC subscription;
  // each hook caller just attaches a local listener. Multiple components
  // can mount this hook safely without double-firing IPC events.
  useEffect(() => {
    return subscribeRemarkableProgress((update) => {
      setRemarkableSyncProgress(update)
      if (update.notebookId) {
        if (update.phase === 'downloading' || update.phase === 'ocr') {
          addSyncingNotebook(update.notebookId)
        } else if (update.phase === 'notebook-done') {
          removeSyncingNotebook(update.notebookId)
          // Reload metadata so just-completed notebooks become interactive.
          // Debounced (200ms trailing) to coalesce bursts during a multi-
          // notebook sync — see scheduleLoadNotebooks above.
          if (syncDirRef.current) scheduleLoadNotebooks(syncDirRef.current, loadNotebooks)
        }
      }
    })
  // Zustand actions (addSyncingNotebook, removeSyncingNotebook, etc.) are referentially
  // stable — intentionally subscribing once. syncDir uses a ref to avoid stale closure.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sync = useCallback(async () => {
    // Check ref-based lock to prevent concurrent syncs
    if (syncLockRef.current) {
      console.log('[reMarkable] Sync already in progress, skipping')
      return
    }
    syncLockRef.current = true

    if (!window.api) {
      syncLockRef.current = false
      setRemarkableSyncError('reMarkable sync is only available in the desktop app')
      return
    }

    if (!remarkableSettings?.enabled) {
      syncLockRef.current = false
      setRemarkableSyncError('reMarkable sync is not enabled')
      return
    }

    if (!remarkableSettings.deviceToken) {
      syncLockRef.current = false
      setRemarkableSyncError('Please connect your reMarkable device in Settings')
      return
    }

    if (!remarkableSettings.syncDirectory) {
      syncLockRef.current = false
      setRemarkableSyncError('Please set a sync directory in Settings')
      return
    }

    setRemarkableSyncActive(true)
    setRemarkableSyncError(null)
    setSyncResult(null)
    setRemarkableSyncProgress(null)

    // Kick off the cloud notebook list fetch in parallel with the sync so the
    // file explorer tree populates as soon as the listing returns, instead of
    // waiting for every notebook to finish downloading. The post-sync call at
    // the bottom of this try block still runs to catch any structural changes
    // that happened during sync (folder moves, etc.).
    //
    // Race note: the post-sync fetch and this eager fetch could theoretically
    // land out of order, so `loadCloudNotebooks` must tolerate the later call
    // winning. In practice the eager fetch returns almost immediately (just a
    // cloud list) and the post-sync fetch happens much later, so collision is
    // unlikely. The side-effect (populating the tree) is idempotent either way.
    loadCloudNotebooks(remarkableSettings.deviceToken, remarkableSettings.syncDirectory)
      .catch((err) => console.warn('[reMarkable] Eager cloud list fetch failed:', err))

    try {
      const result = await window.api.remarkableSync(
        remarkableSettings.deviceToken,
        remarkableSettings.syncDirectory
      )

      // Check for sync errors
      if (result.errors.length > 0) {
        console.error('reMarkable sync errors:', result.errors)
        setRemarkableSyncError(result.errors[0])
      }

      // Update lastSyncedAt in settings
      setSettings({
        remarkable: {
          ...remarkableSettings,
          lastSyncedAt: result.syncedAt
        }
      })
      await saveSettings()

      setSyncResult({ synced: result.synced, skipped: result.skipped })

      // Refresh the file list, notebooks, and cloud notebook tree (folder structure may have changed)
      await loadFiles()
      await loadNotebooks(remarkableSettings.syncDirectory)
      await loadCloudNotebooks(remarkableSettings.deviceToken, remarkableSettings.syncDirectory)
    } catch (err) {
      console.error('reMarkable sync failed:', err)
      setRemarkableSyncError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setRemarkableSyncActive(false)
      setRemarkableSyncProgress(null)
      clearSyncingNotebooks()
      syncLockRef.current = false
    }
  }, [remarkableSettings, setSettings, saveSettings, loadFiles, loadNotebooks, loadCloudNotebooks, setRemarkableSyncActive, setRemarkableSyncProgress, setRemarkableSyncError, clearSyncingNotebooks])

  const cancel = useCallback(async () => {
    if (!window.api?.remarkableCancelSync) return
    try {
      await window.api.remarkableCancelSync()
    } catch (err) {
      console.warn('[reMarkable] cancelSync failed:', err)
    }
  }, [])

  return {
    isSyncing,
    lastSyncedAt,
    error,
    syncResult,
    progress,
    sync,
    cancel
  }
}
