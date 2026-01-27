import { useCallback, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'

export interface UseGoogleDocsSyncReturn {
  isSyncing: boolean
  error: string | null
  syncResult: { synced: number; skipped: number } | null
  sync: () => Promise<void>
}

export function useGoogleDocsSync(): UseGoogleDocsSyncReturn {
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number } | null>(null)

  // Use a ref to prevent concurrent syncs
  const syncLockRef = useRef(false)

  const settings = useSettingsStore((state) => state.settings)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
  const loadGoogleDocsMetadata = useFileListStore((state) => state.loadGoogleDocsMetadata)

  const sync = useCallback(async () => {
    if (syncLockRef.current) {
      console.log('[Google Docs] Sync already in progress, skipping')
      return
    }
    syncLockRef.current = true

    if (!window.api) {
      syncLockRef.current = false
      setError('Google Docs sync is only available in the desktop app')
      return
    }

    if (!settings.google) {
      syncLockRef.current = false
      setError('Please connect your Google account first')
      return
    }

    setIsSyncing(true)
    useFileListStore.getState().setGoogleSyncing(true)
    setError(null)
    setSyncResult(null)

    try {
      // Ensure the sync directory exists
      let syncDir = settings.google.syncDirectory
      if (!syncDir && window.api.googleEnsureFolder) {
        syncDir = await window.api.googleEnsureFolder()
        setSettings({
          google: {
            ...settings.google,
            syncDirectory: syncDir
          }
        })
        await saveSettings()
      }

      if (!syncDir) {
        setError('Could not determine sync directory')
        return
      }

      // Run sync
      const result = await window.api.googleSyncAll(syncDir)

      if (result.errors.length > 0) {
        console.error('Google Docs sync errors:', result.errors)
        setError(result.errors[0])
      }

      // Update lastSyncedAt
      setSettings({
        google: {
          ...settings.google,
          syncDirectory: syncDir,
          lastSyncedAt: new Date().toISOString()
        }
      })
      await saveSettings()

      setSyncResult({ synced: result.synced, skipped: result.skipped })

      // Refresh the Google Docs metadata
      await loadGoogleDocsMetadata()
    } catch (err) {
      console.error('Google Docs sync failed:', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setIsSyncing(false)
      useFileListStore.getState().setGoogleSyncing(false)
      syncLockRef.current = false
    }
  }, [settings, setSettings, saveSettings, loadGoogleDocsMetadata])

  return {
    isSyncing,
    error,
    syncResult,
    sync
  }
}
