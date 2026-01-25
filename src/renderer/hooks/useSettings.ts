import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

export function useSettings() {
  const {
    settings,
    isLoaded,
    isDialogOpen,
    isShortcutsDialogOpen,
    isAboutDialogOpen,
    dialogTab,
    effectiveTheme,
    autosaveActive,
    setSettings,
    loadSettings,
    saveSettings,
    setDialogOpen,
    setDialogTab,
    setShortcutsDialogOpen,
    setAboutDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setFileAssociationConfig,
    setAutosaveConfig,
    toggleAutosaveActive
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
    dialogTab,
    effectiveTheme,
    autosaveActive,
    setSettings,
    saveSettings,
    setDialogOpen,
    setDialogTab,
    setShortcutsDialogOpen,
    setAboutDialogOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setFileAssociationConfig,
    setAutosaveConfig,
    toggleAutosaveActive
  }
}
