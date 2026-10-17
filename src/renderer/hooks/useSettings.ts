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
    isAIConsentDialogOpen,
    dialogTab,
    effectiveTheme,
    effectiveColor,
    autosaveActive,
    setSettings,
    loadSettings,
    saveSettings,
    setDialogOpen,
    setDialogTab,
    setShortcutsDialogOpen,
    setAboutDialogOpen,
    setModelPickerOpen,
    setAppearance,
    markMigrationToastShown,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setFileAssociationConfig,
    setAutosaveConfig,
    toggleAutosaveActive,
    setAIConsent,
    setAIConsentDialogOpen
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
    isAIConsentDialogOpen,
    dialogTab,
    effectiveTheme,
    effectiveColor,
    autosaveActive,
    setSettings,
    saveSettings,
    setDialogOpen,
    setDialogTab,
    setShortcutsDialogOpen,
    setAboutDialogOpen,
    setModelPickerOpen,
    setAppearance,
    markMigrationToastShown,
    setLLMConfig,
    setEditorConfig,
    setRecoveryConfig,
    setDefaultSaveDirectory,
    setRemarkableConfig,
    setFileAssociationConfig,
    setAutosaveConfig,
    toggleAutosaveActive,
    setAIConsent,
    setAIConsentDialogOpen
  }
}
