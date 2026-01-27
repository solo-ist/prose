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
    loadingFolders,
    notebookMetadata,
    cloudNotebooks,
    syncState,
    googleDocsMetadata,
    togglePanel,
    setPanelOpen,
    setViewMode,
    setRootPath,
    initializeDefaultPath,
    navigateToParent,
    loadFiles,
    loadGoogleDocsMetadata,
    loadNotebooks,
    loadCloudNotebooks,
    toggleNotebookSync,
    selectFile,
    toggleFolder,
    setExpanded,
    revealAndSelectPath
  } = useFileListStore()

  const { settings, removeRecentFile } = useSettingsStore()
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

  // Load local notebook metadata when in notebooks view (no cloud API calls)
  useEffect(() => {
    if (viewMode === 'notebooks' && settings.remarkable?.enabled && syncDirectory) {
      loadNotebooks(syncDirectory)
    }
  }, [viewMode, settings.remarkable?.enabled, syncDirectory, loadNotebooks])

  // Auto-refresh files when switching to folder view
  useEffect(() => {
    if (viewMode === 'folder' && rootPath) {
      loadFiles()
    }
  }, [viewMode, rootPath, loadFiles])

  // Sync file selection across views - when document path changes or switching to folder view,
  // reveal and select the file if it's within the current rootPath
  // Wait for files to be loaded before trying to reveal
  useEffect(() => {
    if (viewMode === 'folder' && documentPath && rootPath && files.length > 0) {
      revealAndSelectPath(documentPath)
    }
  }, [viewMode, documentPath, rootPath, files.length, revealAndSelectPath])

  return {
    isPanelOpen,
    isLoading,
    viewMode,
    files,
    rootPath,
    expandedFolders,
    selectedPath,
    loadingFolders,
    notebookMetadata,
    cloudNotebooks,
    syncState,
    googleDocsMetadata,
    recentFiles,
    syncDirectory,
    deviceToken: settings.remarkable?.deviceToken,
    togglePanel,
    setPanelOpen,
    setViewMode,
    setRootPath,
    navigateToParent,
    loadFiles,
    loadGoogleDocsMetadata,
    loadNotebooks,
    loadCloudNotebooks,
    toggleNotebookSync,
    selectFile,
    toggleFolder,
    setExpanded,
    revealAndSelectPath,
    removeRecentFile
  }
}
