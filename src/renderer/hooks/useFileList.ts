import { useEffect } from 'react'
import { useFileListStore } from '../stores/fileListStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'

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
  const documentPath = useEditorStore((state) => state.document.path)

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

  // Sync file selection across views - when document path changes or switching to folder view,
  // reveal and select the file if it's within the current rootPath
  useEffect(() => {
    if (viewMode === 'folder' && documentPath && rootPath) {
      revealAndSelectPath(documentPath)
    }
  }, [viewMode, documentPath, rootPath, revealAndSelectPath])

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
