import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

export function useSettings() {
  const {
    settings,
    isLoaded,
    isDialogOpen,
    isShortcutsDialogOpen,
    setSettings,
    loadSettings,
    saveSettings,
    setDialogOpen,
    setShortcutsDialogOpen,
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
    isShortcutsDialogOpen,
    setSettings,
    saveSettings,
    setDialogOpen,
    setShortcutsDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig
  }
}
