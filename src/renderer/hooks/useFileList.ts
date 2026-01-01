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
    togglePanel,
    setPanelOpen,
    setViewMode,
    setRootPath,
    loadFiles,
    selectFile,
    toggleFolder,
    setExpanded
  } = useFileListStore()

  const { settings } = useSettingsStore()
  const recentFiles = settings.recentFiles || []

  // Initialize root path from settings when remarkable is enabled
  useEffect(() => {
    if (settings.remarkable?.enabled && settings.remarkable?.syncDirectory) {
      if (rootPath !== settings.remarkable.syncDirectory) {
        setRootPath(settings.remarkable.syncDirectory)
      }
    }
  }, [settings.remarkable?.enabled, settings.remarkable?.syncDirectory, rootPath, setRootPath])

  return {
    isPanelOpen,
    isLoading,
    viewMode,
    files,
    rootPath,
    expandedFolders,
    selectedPath,
    recentFiles,
    togglePanel,
    setPanelOpen,
    setViewMode,
    setRootPath,
    loadFiles,
    selectFile,
    toggleFolder,
    setExpanded
  }
}
