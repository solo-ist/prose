import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

export function useSettings() {
  const {
    settings,
    isLoaded,
    isDialogOpen,
    isShortcutsDialogOpen,
    isAboutDialogOpen,
    isModelPickerOpen,
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
    setModelPickerOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setGoogleConfig,
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
    isModelPickerOpen,
    dialogTab,
    effectiveTheme,
    autosaveActive,
    setSettings,
    saveSettings,
    setDialogOpen,
    setDialogTab,
    setShortcutsDialogOpen,
    setAboutDialogOpen,
    setModelPickerOpen,
    setTheme,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setGoogleConfig,
    setFileAssociationConfig,
    setAutosaveConfig,
    toggleAutosaveActive
  }
}
