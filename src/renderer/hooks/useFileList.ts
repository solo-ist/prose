import { useEffect } from 'react'
import { useFileListStore } from '../stores/fileListStore'
import { useSettingsStore } from '../stores/settingsStore'

export function useFileList() {
  const {
    isPanelOpen,
    isLoading,
    viewMode,
    files,
    rootPath,
    expandedFolders,
    selectedPath,
    notebookMetadata,
    cloudNotebooks,
    syncState,
    togglePanel,
    setPanelOpen,
    setViewMode,
    setRootPath,
    initializeDefaultPath,
    navigateToParent,
    loadFiles,
    loadNotebooks,
    loadCloudNotebooks,
    toggleNotebookSync,
    selectFile,
    toggleFolder,
    setExpanded,
    revealAndSelectPath
  } = useFileListStore()

  const { settings } = useSettingsStore()
  const recentFiles = settings.recentFiles || []
  const syncDirectory = settings.remarkable?.syncDirectory

  // Initialize default path on first launch only
  useEffect(() => {
    // Only initialize if no rootPath is set yet
    if (!rootPath) {
      if (settings.remarkable?.enabled && syncDirectory) {
        // If remarkable is enabled, start at sync directory
        setRootPath(syncDirectory)
      } else {
        // Otherwise, initialize to ~/Documents
        initializeDefaultPath()
      }
    }
  }, [settings.remarkable?.enabled, syncDirectory, rootPath, setRootPath, initializeDefaultPath])

  // Load notebook metadata and cloud notebooks when in notebooks view
  useEffect(() => {
    if (viewMode === 'notebooks' && settings.remarkable?.enabled && syncDirectory) {
      loadNotebooks(syncDirectory)
      // Also load cloud notebooks if we have a device token
      if (settings.remarkable.deviceToken) {
        loadCloudNotebooks(settings.remarkable.deviceToken, syncDirectory)
      }
    }
  }, [viewMode, settings.remarkable?.enabled, settings.remarkable?.deviceToken, syncDirectory, loadNotebooks, loadCloudNotebooks])

  return {
    isPanelOpen,
    isLoading,
    viewMode,
    files,
    rootPath,
    expandedFolders,
    selectedPath,
    notebookMetadata,
    cloudNotebooks,
    syncState,
    recentFiles,
    syncDirectory,
    deviceToken: settings.remarkable?.deviceToken,
    togglePanel,
    setPanelOpen,
    setViewMode,
    setRootPath,
    navigateToParent,
    loadFiles,
    loadNotebooks,
    loadCloudNotebooks,
    toggleNotebookSync,
    selectFile,
    toggleFolder,
    setExpanded,
    revealAndSelectPath
  }
}
