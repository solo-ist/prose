import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

export function useSettings() {
  const {
    settings,
    isLoaded,
    isDialogOpen,
    isShortcutsDialogOpen,
    isAboutDialogOpen,
    setSettings,
    loadSettings,
    saveSettings,
    setDialogOpen,
    setShortcutsDialogOpen,
    setAboutDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory
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
    isAboutDialogOpen,
    setSettings,
    saveSettings,
    setDialogOpen,
    setShortcutsDialogOpen,
    setAboutDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory
  }
}
