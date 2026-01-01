import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'

export interface UseRemarkableSyncReturn {
  isSyncing: boolean
  lastSyncedAt: string | null
  error: string | null
  sync: () => Promise<void>
}

export function useRemarkableSync(): UseRemarkableSyncReturn {
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

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

    if (!remarkableSettings.lambdaUrl || !remarkableSettings.apiKey || !remarkableSettings.syncDirectory) {
      setError('Please configure all reMarkable settings')
      return
    }

    setIsSyncing(true)
    setError(null)

    try {
      const response = await window.api.remarkableSync({
        lambdaUrl: remarkableSettings.lambdaUrl,
        apiKey: remarkableSettings.apiKey,
        syncDirectory: remarkableSettings.syncDirectory
      })

      // Update lastSyncedAt in settings
      setSettings({
        remarkable: {
          ...remarkableSettings,
          lastSyncedAt: response.syncedAt
        }
      })
      await saveSettings()

      // Refresh the file list
      await loadFiles()
    } catch (err) {
      console.error('reMarkable sync failed:', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }, [remarkableSettings, setSettings, saveSettings, loadFiles])

  // Setup polling
  useEffect(() => {
    if (!remarkableSettings?.enabled || !remarkableSettings.pollIntervalMinutes) {
      // Clear existing interval if settings changed
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      return
    }

    const pollIntervalMs = remarkableSettings.pollIntervalMinutes * 60 * 1000

    // Check if we should sync on mount (if last sync was more than pollInterval ago)
    if (remarkableSettings.lambdaUrl && remarkableSettings.apiKey && remarkableSettings.syncDirectory) {
      const lastSync = remarkableSettings.lastSyncedAt
        ? new Date(remarkableSettings.lastSyncedAt).getTime()
        : 0
      const now = Date.now()

      if (now - lastSync > pollIntervalMs) {
        // Sync is due
        sync()
      }
    }

    // Setup polling interval
    pollIntervalRef.current = setInterval(() => {
      if (!isSyncing) {
        sync()
      }
    }, pollIntervalMs)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [
    remarkableSettings?.enabled,
    remarkableSettings?.pollIntervalMinutes,
    remarkableSettings?.lambdaUrl,
    remarkableSettings?.apiKey,
    remarkableSettings?.syncDirectory,
    remarkableSettings?.lastSyncedAt,
    sync,
    isSyncing
  ])

  return {
    isSyncing,
    lastSyncedAt,
    error,
    sync
  }
}
