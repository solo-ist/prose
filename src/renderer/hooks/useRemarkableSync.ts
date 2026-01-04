import { useCallback, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'

export interface UseRemarkableSyncReturn {
  isSyncing: boolean
  lastSyncedAt: string | null
  error: string | null
  syncResult: { synced: number; skipped: number } | null
  sync: () => Promise<void>
}

export function useRemarkableSync(): UseRemarkableSyncReturn {
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number } | null>(null)

  const settings = useSettingsStore((state) => state.settings)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
  const loadFiles = useFileListStore((state) => state.loadFiles)

  const remarkableSettings = settings.remarkable
  const lastSyncedAt = remarkableSettings?.lastSyncedAt ?? null

  const sync = useCallback(async () => {
    if (!window.api) {
      setError('reMarkable sync is only available in the desktop app')
      return
    }

    if (!remarkableSettings?.enabled) {
      setError('reMarkable sync is not enabled')
      return
    }

    if (!remarkableSettings.deviceToken) {
      setError('Please connect your reMarkable device in Settings')
      return
    }

    if (!remarkableSettings.syncDirectory) {
      setError('Please set a sync directory in Settings')
      return
    }

    setIsSyncing(true)
    setError(null)
    setSyncResult(null)

    try {
      const result = await window.api.remarkableSync(
        remarkableSettings.deviceToken,
        remarkableSettings.syncDirectory
      )

      // Check for sync errors
      if (result.errors.length > 0) {
        console.error('reMarkable sync errors:', result.errors)
        setError(result.errors[0])
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

      // Refresh the file list
      await loadFiles()
    } catch (err) {
      console.error('reMarkable sync failed:', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }, [remarkableSettings, setSettings, saveSettings, loadFiles])

  return {
    isSyncing,
    lastSyncedAt,
    error,
    syncResult,
    sync
  }
}
