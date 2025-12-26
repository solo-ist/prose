import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

export function useSettings() {
  const {
    settings,
    isLoaded,
    isDialogOpen,
    setSettings,
    loadSettings,
    saveSettings,
    setDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig
  } = useSettingsStore()

  useEffect(() => {
    if (!isLoaded) {
      loadSettings()
    }
  }, [isLoaded, loadSettings])

  return {
    settings,
    isLoaded,
    isDialogOpen,
    setSettings,
    saveSettings,
    setDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig
  }
}
