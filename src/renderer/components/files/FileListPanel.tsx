import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useFileList } from '../../hooks/useFileList'
import { useEditor } from '../../hooks/useEditor'
import { useTabs } from '../../hooks/useTabs'
import { useSummaryStore } from '../../stores/summaryStore'
import { useRemarkableSync } from '../../hooks/useRemarkableSync'
import { useGoogleDocsSync } from '../../hooks/useGoogleDocsSync'
import { useExplorerActions } from '../../hooks/useExplorerActions'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEditorStore } from '../../stores/editorStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useTabStore } from '../../stores/tabStore'
import { FileTree } from './FileTree'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '../ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { History, Cloud, Plus, FileText, BookOpen, CloudOff, ChevronUp, Folder, FolderOpen, Download, Trash2, FilePlus, ClipboardPaste, ExternalLink, X, Globe, Edit3 } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { cn } from '../../lib/utils'
import { getApi } from '../../lib/browserApi'
import type { RemarkableNotebookMetadata, RemarkableCloudNotebook, GoogleDocEntry } from '../../types'

export function FileListPanel() {
  const {
    files,
    rootPath,
    isLoading,
    viewMode,
    expandedFolders,
    selectedPath,
    loadingFolders,
    recentFiles,
    notebookMetadata,
    cloudNotebooks,
    syncState,
    selectFile,
    toggleFolder,
    setViewMode,
    setRootPath,
    navigateToParent,
    toggleNotebookSync,
    loadFiles,
    loadGoogleDocsMetadata,
    googleDocsMetadata,
    syncDirectory,
    deviceToken,
    removeRecentFile
  } = useFileList()

  const { openFileFromPath } = useEditor()
  const { openFileInTab, openFileInPreviewTab, forceCloseTab } = useTabs()
  const { isSyncing, sync, error: syncError } = useRemarkableSync()
  const { isSyncing: isGoogleSyncing, sync: googleSync, error: googleSyncError } = useGoogleDocsSync()
  const { setDialogOpen } = useSettings()
  const remarkableEnabled = useSettingsStore((state) => state.settings.remarkable?.enabled)
  const googleConnected = useSettingsStore((state) => !!state.settings.google)
  const googleSyncDirectory = useSettingsStore((state) => state.settings.google?.syncDirectory)

  // Explorer panel ref for scoped keyboard shortcuts
  const containerRef = useRef<HTMLDivElement>(null)
  const renamingPath = useFileListStore((s) => s.renamingPath)
  const setRenamingPath = useFileListStore((s) => s.setRenamingPath)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{
    path: string
    fileName: string
    linkedNotebookId: string | null
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // New file dialog state
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameFilePath, setRenameFilePath] = useState<string | null>(null)
  const [renameFileName, setRenameFileName] = useState('')

  // Error state for user feedback
  const [operationError, setOperationError] = useState<string | null>(null)

  const api = getApi()

  // Handle file delete request (opens confirmation dialog) — must be before useExplorerActions
  const handleFileDeleteRequest = async (path: string) => {
    const fileName = path.split('/').pop() || path

    // Check if file is linked to a reMarkable notebook
    let linkedNotebookId: string | null = null
    if (syncDirectory && window.api?.remarkableFindNotebookByFilePath) {
      linkedNotebookId = await window.api.remarkableFindNotebookByFilePath(path, syncDirectory)
    }

    setDeleteTarget({ path, fileName, linkedNotebookId })
  }

  // New file dialog state (context-aware: stores target directory)
  const [newFileTargetDir, setNewFileTargetDir] = useState<string | null>(null)

  // Context-aware new file handler
  const handleNewFileInDir = useCallback((targetDir: string) => {
    setNewFileTargetDir(targetDir)
    setNewFileName('')
    setOperationError(null)
    setNewFileDialogOpen(true)
  }, [])

  // Explorer actions hook (keyboard shortcuts + operations)
  const { copySelected, pasteFile, clipboardPath } = useExplorerActions({
    containerRef,
    onNewFile: handleNewFileInDir,
    onFileOpen: async (path) => {
      selectFile(path)
      const shouldDescribe = await openFileInPreviewTab(path)
      if (shouldDescribe) {
        const { document } = useEditorStore.getState()
        useSummaryStore.getState().generateSummary(document.documentId, document.content)
      }
    },
    onFilePreview: async (path) => {
      const shouldDescribe = await openFileInPreviewTab(path)
      if (shouldDescribe) {
        const { document } = useEditorStore.getState()
        useSummaryStore.getState().generateSummary(document.documentId, document.content)
      }
    },
    onFileTrash: handleFileDeleteRequest,
    closeTab: forceCloseTab
  })

  // Confirm and execute file deletion
  const handleConfirmDelete = async () => {
    if (!deleteTarget || !window.api) return

    setIsDeleting(true)
    try {
      // If linked to a notebook, clear the markdown path first
      if (deleteTarget.linkedNotebookId && syncDirectory) {
        await window.api.remarkableClearNotebookMarkdownPath(
          deleteTarget.linkedNotebookId,
          syncDirectory
        )
      }

      // Move to trash (recoverable)
      await window.api.trashFile(deleteTarget.path)

      // If this file is tracked in Google Docs metadata, remove its entry
      if (googleDocsMetadata && window.api.googleRemoveSyncMetadataEntry) {
        const trackedEntry = Object.values(googleDocsMetadata.documents).find(
          (e) => e.localPath === deleteTarget.path
        )
        if (trackedEntry) {
          await window.api.googleRemoveSyncMetadataEntry(trackedEntry.googleDocId)
          await loadGoogleDocsMetadata()
        }
      }

      // Close the tab if the trashed file was open (full close flow)
      const tab = useTabStore.getState().getTabByPath(deleteTarget.path)
      if (tab) {
        await forceCloseTab(tab.id)
      }

      // Refresh file list
      await loadFiles()

      // Close dialog
      setDeleteTarget(null)
    } catch (error) {
      console.error('Failed to delete file:', error)
      setOperationError('Failed to delete file. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  // New file handlers
  const handleNewFile = () => {
    setNewFileTargetDir(rootPath)
    setNewFileName('')
    setOperationError(null)
    setNewFileDialogOpen(true)
  }

  const handleCreateNewFile = async () => {
    const targetDir = newFileTargetDir || rootPath
    if (!newFileName.trim() || !targetDir) return

    setOperationError(null)
    try {
      const fileName = newFileName.endsWith('.md') ? newFileName : `${newFileName}.md`
      const fullPath = `${targetDir}/${fileName}`

      // Check if file already exists
      const exists = await api.fileExists(fullPath)
      if (exists) {
        setOperationError(`A file named "${fileName}" already exists.`)
        return
      }

      const savedPath = await api.saveToFolder(targetDir, fileName, '')
      setNewFileDialogOpen(false)
      setNewFileName('')
      setNewFileTargetDir(null)

      // Refresh file list and open the new file
      await loadFiles()
      selectFile(savedPath)
      await openFileFromPath(savedPath)
    } catch (error) {
      console.error('Error creating file:', error)
      setOperationError('Failed to create file. Please try again.')
    }
  }

  // Inline rename handler (for file tree) — triggers inline edit via store
  const handleFileRenameInline = useCallback((path: string) => {
    selectFile(path)
    setRenamingPath(path)
  }, [selectFile, setRenamingPath])

  // Inline rename complete handler
  const handleRenameComplete = useCallback(async (oldPath: string, newName: string) => {
    setRenamingPath(null)
    if (!newName.trim()) return

    try {
      const dir = oldPath.substring(0, oldPath.lastIndexOf('/'))
      const oldExt = oldPath.match(/\.(md|markdown|txt)$/)?.[0] || '.md'
      const finalName = newName.endsWith(oldExt) ? newName : `${newName}${oldExt}`
      const newPath = `${dir}/${finalName}`

      // Same name? No-op
      if (newPath === oldPath) return

      // Check conflict
      const exists = await api.fileExists(newPath)
      if (exists) {
        console.error(`File "${finalName}" already exists`)
        return
      }

      await api.renameFile(oldPath, newPath)

      // Tab sync: update tab if file was open
      const tab = useTabStore.getState().getTabByPath(oldPath)
      if (tab) {
        const newTitle = finalName.replace(/\.(md|markdown|txt)$/, '')
        useTabStore.getState().updateTab(tab.id, { path: newPath, title: newTitle })
      }

      // If this file is tracked in Google Docs metadata, update its localPath
      if (googleDocsMetadata && window.api?.googleUpdateSyncMetadataEntry) {
        const trackedEntry = Object.values(googleDocsMetadata.documents).find(
          (e) => e.localPath === oldPath
        )
        if (trackedEntry) {
          const newTitle = finalName.replace(/\.(md|markdown|txt)$/, '')
          await window.api.googleUpdateSyncMetadataEntry({
            ...trackedEntry,
            localPath: newPath,
            title: newTitle
          })
          await loadGoogleDocsMetadata()
        }
      }

      // Refresh file list and select the renamed file
      await loadFiles()
      selectFile(newPath)
    } catch (error) {
      console.error('Error renaming file:', error)
    }
  }, [api, googleDocsMetadata, loadGoogleDocsMetadata, loadFiles, selectFile, setRenamingPath])

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null)
  }, [setRenamingPath])

  // Dialog-based rename (for Google Docs view where inline isn't available)
  const handleFileRename = (path: string) => {
    const fileName = path.split('/').pop() || ''
    const nameWithoutExt = fileName.replace(/\.(md|markdown|txt)$/, '')
    setRenameFilePath(path)
    setRenameFileName(nameWithoutExt)
    setOperationError(null)
    setRenameDialogOpen(true)
  }

  const handleConfirmRename = async () => {
    if (!renameFilePath || !renameFileName.trim()) return

    setOperationError(null)
    try {
      const dir = renameFilePath.substring(0, renameFilePath.lastIndexOf('/'))
      const oldExt = renameFilePath.match(/\.(md|markdown|txt)$/)?.[0] || '.md'
      const newName = renameFileName.endsWith(oldExt) ? renameFileName : `${renameFileName}${oldExt}`
      const newPath = `${dir}/${newName}`

      if (newPath !== renameFilePath) {
        const exists = await api.fileExists(newPath)
        if (exists) {
          setOperationError(`A file named "${newName}" already exists.`)
          return
        }
      }

      await api.renameFile(renameFilePath, newPath)

      // Tab sync
      const tab = useTabStore.getState().getTabByPath(renameFilePath)
      if (tab) {
        const newTitle = newName.replace(/\.(md|markdown|txt)$/, '')
        useTabStore.getState().updateTab(tab.id, { path: newPath, title: newTitle })
      }

      if (googleDocsMetadata && window.api?.googleUpdateSyncMetadataEntry) {
        const trackedEntry = Object.values(googleDocsMetadata.documents).find(
          (e) => e.localPath === renameFilePath
        )
        if (trackedEntry) {
          const newTitle = newName.replace(/\.(md|markdown|txt)$/, '')
          await window.api.googleUpdateSyncMetadataEntry({
            ...trackedEntry,
            localPath: newPath,
            title: newTitle
          })
          await loadGoogleDocsMetadata()
        }
      }

      setRenameDialogOpen(false)
      setRenameFilePath(null)
      setRenameFileName('')

      await loadFiles()
      selectFile(newPath)
    } catch (error) {
      console.error('Error renaming file:', error)
      setOperationError('Failed to rename file. Please try again.')
    }
  }

  // Show in folder handler
  const handleFileShowInFolder = async (path: string) => {
    try {
      await api.showInFolder(path)
    } catch (error) {
      console.error('Error showing file in folder:', error)
    }
  }

  // Auto-sync when switching to notebooks view
  useEffect(() => {
    if (viewMode === 'notebooks' && remarkableEnabled && !isSyncing) {
      sync().catch((err) => {
        console.error('[FileListPanel] Auto-sync failed:', err)
      })
    }
  }, [viewMode, remarkableEnabled]) // Intentionally exclude sync and isSyncing to only trigger on view change

  // Load metadata and auto-sync when switching to Google Docs view
  useEffect(() => {
    if (viewMode === 'googledocs' && googleConnected) {
      // Load metadata first for instant display
      loadGoogleDocsMetadata()
      // Then trigger a background sync (if not already syncing)
      if (!isGoogleSyncing) {
        googleSync().catch((err) => {
          console.error('[FileListPanel] Google Docs auto-sync failed:', err)
        })
      }
    }
  }, [viewMode, googleConnected]) // Intentionally exclude googleSync and isGoogleSyncing to only trigger on view change

  const handleFileClick = async (path: string) => {
    selectFile(path)
    const shouldDescribe = await openFileInPreviewTab(path)
    if (shouldDescribe) {
      const { document } = useEditorStore.getState()
      useSummaryStore.getState().generateSummary(document.documentId, document.content)
    }
  }

  const handleFileDoubleClick = async (path: string) => {
    selectFile(path)
    const shouldDescribe = await openFileInTab(path)
    if (shouldDescribe) {
      const { document } = useEditorStore.getState()
      useSummaryStore.getState().generateSummary(document.documentId, document.content)
    }
  }

  // Google Docs: open file in tab (avoids rootPath race condition)
  const handleGoogleDocClick = useCallback(async (path: string) => {
    selectFile(path)
    await openFileInTab(path)
  }, [selectFile, openFileInTab])

  // Google Docs: open the linked Google Doc in the browser (using metadata)
  const googleEmail = useSettingsStore((state) => state.settings.google?.email)
  const handleGoogleDocLinkClick = useCallback((entry: GoogleDocEntry) => {
    const authParam = googleEmail ? `?authuser=${encodeURIComponent(googleEmail)}` : ''
    window.open(`${entry.webViewLink}${authParam}`, '_blank')
  }, [googleEmail])

  // Google Docs: remove a stale entry from metadata
  const handleRemoveGoogleDocEntry = useCallback(async (googleDocId: string) => {
    if (!window.api?.googleRemoveSyncMetadataEntry) return
    await window.api.googleRemoveSyncMetadataEntry(googleDocId)
    await loadGoogleDocsMetadata()
  }, [loadGoogleDocsMetadata])

  // Get folder name from path for display
  const folderName = rootPath?.split('/').pop() || 'Cloud'

  // Get filename from path for recent files display
  const getFileName = (path: string) => path.split('/').pop() || path

  // Extend type to include id for metadata notebooks
  type NotebookWithId = (RemarkableCloudNotebook | RemarkableNotebookMetadata) & { id: string }

  // Organize cloud notebooks by parent for hierarchical display
  const { itemsByParent, allNotebooks } = useMemo(() => {
    // If we have cloud notebooks, use those (they represent all notebooks)
    // Otherwise fall back to local metadata, adding the ID from the record key
    const sourceNotebooks: NotebookWithId[] = cloudNotebooks.length > 0
      ? cloudNotebooks
      : notebookMetadata?.notebooks
        ? Object.entries(notebookMetadata.notebooks).map(([id, notebook]) => ({ ...notebook, id }))
        : []

    const byParent = new Map<string | null, NotebookWithId[]>()
    const notebooks: NotebookWithId[] = []

    for (const item of sourceNotebooks) {
      const parent = item.parent
      if (!byParent.has(parent)) {
        byParent.set(parent, [])
      }
      byParent.get(parent)!.push(item)

      if (item.type === 'notebook') {
        notebooks.push(item)
      }
    }

    return { itemsByParent: byParent, allNotebooks: notebooks }
  }, [cloudNotebooks, notebookMetadata])

  // Check if a notebook is synced
  const isNotebookSynced = (notebookId: string): boolean => {
    if (!syncState) return true // If no sync state, assume all synced (legacy behavior)
    return syncState.selectedNotebooks.includes(notebookId)
  }

  // Get notebook ID - all notebooks now have id included
  const getNotebookId = (notebook: NotebookWithId): string => {
    return notebook.id
  }

  // Handle right-click sync toggle
  const handleToggleSync = (notebookId: string) => {
    if (syncDirectory) {
      toggleNotebookSync(notebookId, syncDirectory)
    }
  }

  // Check if a folder has any synced notebooks inside it (recursively)
  const isFolderSynced = (folderId: string): boolean => {
    if (!syncState) return true // Legacy behavior

    // Recursively check all descendants
    const checkDescendants = (parentId: string): boolean => {
      const children = itemsByParent.get(parentId) || []
      for (const child of children) {
        if (child.type === 'notebook') {
          if (syncState.selectedNotebooks.includes(child.id)) {
            return true
          }
        } else if (child.type === 'folder') {
          if (checkDescendants(child.id)) {
            return true
          }
        }
      }
      return false
    }

    return checkDescendants(folderId)
  }

  const handleNotebookClick = async (notebook: RemarkableNotebookMetadata, notebookId: string) => {
    if (!syncDirectory || !window.api) return

    // ALWAYS open OCR in read-only mode from Notebooks panel
    // Even if editable version exists, show the cloud state here
    // The File Explorer is where users edit their files
    if (notebook.ocrPath) {
      const ocrFullPath = await window.api.remarkableGetOCRPath(notebookId, syncDirectory)
      if (ocrFullPath) {
        selectFile(ocrFullPath)
        // Set read-only mode with notebook ID for later transform
        useEditorStore.getState().setRemarkableReadOnly(true, notebookId)
        // Pass true for isRemarkableOCR so openFileFromPath doesn't clear read-only state
        const shouldDescribe = await openFileFromPath(ocrFullPath, true)
        if (shouldDescribe) {
          const { document } = useEditorStore.getState()
          useSummaryStore.getState().generateSummary(document.documentId, document.content)
        }
      }
    }
  }

  // Recursive function to render notebook tree
  const renderNotebookItems = (parentId: string | null, depth: number): ReactNode => {
    const children = itemsByParent.get(parentId) || []
    if (children.length === 0) return null

    // Sort: folders first, then alphabetically
    const sorted = [...children].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return sorted.map(item => {
      if (item.type === 'folder') {
        const folderId = getNotebookId(item)
        const hasSyncedContent = isFolderSynced(folderId)
        const hasDescendants = itemsByParent.has(item.id)
        if (!hasDescendants) return null

        return (
          <div key={folderId} className="space-y-0.5" style={{ paddingLeft: depth > 0 ? '1rem' : 0 }}>
            <div
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                hasSyncedContent ? "text-foreground" : "text-muted-foreground opacity-30"
              )}
              title={hasSyncedContent ? item.name : `${item.name} (no synced notebooks)`}
            >
              {hasSyncedContent ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{item.name}</span>
            </div>
            {renderNotebookItems(item.id, depth + 1)}
          </div>
        )
      } else {
        const notebookId = getNotebookId(item)
        const isSynced = isNotebookSynced(notebookId)
        const localMeta = notebookMetadata?.notebooks?.[notebookId] ?? null
        const hasOCR = !!localMeta?.ocrPath
        const hasEditable = !!localMeta?.markdownPath
        const isClickable = hasOCR || hasEditable
        // For selection highlighting, check both editable path and OCR path
        const fullEditablePath = (localMeta?.markdownPath && syncDirectory)
          ? `${syncDirectory}/${localMeta.markdownPath}`
          : null

        return (
          <div key={notebookId} style={{ paddingLeft: depth > 0 ? '1rem' : 0 }}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                    fullEditablePath && selectedPath === fullEditablePath && "bg-muted",
                    !isSynced && "opacity-30"
                  )}
                  onClick={() => {
                    if (localMeta && isClickable) {
                      handleNotebookClick(localMeta, notebookId)
                    }
                  }}
                  title={
                    !isSynced
                      ? `${item.name} (not synced - right-click to sync)`
                      : hasEditable
                        ? `${item.name} (editable)`
                        : hasOCR
                          ? `${item.name} (read-only OCR - click to view)`
                          : `${item.name} (synced, processing OCR...)`
                  }
                  disabled={!isSynced || !isClickable}
                >
                  {isSynced ? (
                    hasEditable ? (
                      <Cloud className="h-4 w-4 shrink-0 text-foreground" />
                    ) : hasOCR ? (
                      <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Cloud className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                    )
                  ) : (
                    <CloudOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate flex-1">{item.name}</span>
                  {item.fileType && (
                    <span className="text-xs text-muted-foreground">
                      {item.fileType}
                    </span>
                  )}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {isSynced ? (
                  <ContextMenuItem onClick={() => handleToggleSync(notebookId)}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove from sync
                  </ContextMenuItem>
                ) : (
                  <ContextMenuItem onClick={() => handleToggleSync(notebookId)}>
                    <Download className="h-4 w-4 mr-2" />
                    Add to sync
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          </div>
        )
      }
    })
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-muted/20" tabIndex={-1}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium truncate" title={viewMode === 'folder' ? rootPath || undefined : undefined}>
            {viewMode === 'recent' ? 'Recent' : viewMode === 'notebooks' ? 'Notebooks' : viewMode === 'googledocs' ? 'Google Docs' : folderName}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {/* View toggle buttons */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", viewMode === 'recent' && "bg-muted")}
                onClick={() => setViewMode('recent')}
                aria-label="Recent files"
              >
                <History className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recent files</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", viewMode === 'folder' && "bg-muted")}
                onClick={() => {
                  if (viewMode === 'folder') {
                    loadFiles()
                  } else {
                    setViewMode('folder')
                  }
                }}
                aria-label="Files"
              >
                <Folder className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Files</TooltipContent>
          </Tooltip>
          {googleConnected && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", viewMode === 'googledocs' && "bg-muted")}
                  onClick={() => {
                    if (viewMode === 'googledocs') {
                      googleSync().catch((err) => {
                        console.error('[FileListPanel] Manual Google sync failed:', err)
                      })
                    } else {
                      setViewMode('googledocs')
                    }
                  }}
                  aria-label="Google Docs"
                >
                  <Globe className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Google Docs</TooltipContent>
            </Tooltip>
          )}
          {remarkableEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", viewMode === 'notebooks' && "bg-muted")}
                  onClick={() => {
                    console.log('[FileListPanel] notebooks button clicked, current viewMode:', viewMode)
                    if (viewMode === 'notebooks') {
                      sync().catch((err) => {
                        console.error('[FileListPanel] Manual sync failed:', err)
                      })
                    } else {
                      setViewMode('notebooks')
                    }
                  }}
                  aria-label="reMarkable notebooks"
                >
                  <BookOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>reMarkable notebooks</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Loading bar */}
      {(isLoading || isSyncing || isGoogleSyncing) && (
        <div className="h-0.5 w-full overflow-hidden bg-muted/50">
          <div className="h-full w-1/3 animate-loading-bar bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500" />
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        {viewMode === 'recent' ? (
          // Recent files view
          recentFiles.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No recent files.
            </div>
          ) : (
            <div className="p-2">
              {recentFiles.map((path) => (
                <ContextMenu key={path}>
                  <ContextMenuTrigger asChild>
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                        selectedPath === path && "bg-muted"
                      )}
                      onClick={() => handleFileClick(path)}
                      title={path}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{getFileName(path)}</span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => removeRecentFile(path)}>
                      <X className="h-4 w-4 mr-2" />
                      Clear
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleFileShowInFolder(path)}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open in Finder
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )
        ) : viewMode === 'googledocs' ? (
          // Google Docs view — flat list from sync metadata
          !googleConnected ? (
            <div className="flex h-full flex-col p-4">
              <p className="text-sm text-muted-foreground">
                Connect your Google account to sync documents.
              </p>
              <Button
                variant="ghost"
                className="mt-6 w-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                onClick={() => setDialogOpen(true, 'account')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : !googleDocsMetadata || Object.keys(googleDocsMetadata.documents).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {isLoading || isGoogleSyncing ? 'Syncing Google Docs...' : googleSyncError ? (
                <span className="text-red-500">{googleSyncError}</span>
              ) : 'No Google Docs found. Sync or import documents first.'}
            </div>
          ) : (
            <div className={cn(
              "p-2",
              isGoogleSyncing && "opacity-50 pointer-events-none"
            )}>
              {Object.values(googleDocsMetadata.documents)
                .sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())
                .map((entry) => {
                  const isMissing = entry.status === 'missing'
                  return (
                    <ContextMenu key={entry.googleDocId}>
                      <ContextMenuTrigger asChild>
                        <div className={cn("group flex items-center relative")}>
                          <button
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                              selectedPath === entry.localPath && "bg-muted",
                              isMissing && "opacity-50"
                            )}
                            onClick={() => {
                              if (!isMissing) {
                                handleGoogleDocClick(entry.localPath)
                              }
                            }}
                            title={isMissing ? `${entry.localPath} (file missing)` : entry.localPath}
                            disabled={isMissing}
                          >
                            <FileText className={cn(
                              "h-4 w-4 shrink-0",
                              isMissing ? "text-muted-foreground/50" : "text-muted-foreground"
                            )} />
                            <span className="truncate flex-1">{entry.title}</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleGoogleDocLinkClick(entry)
                            }}
                            className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                            title="Open in Google Docs"
                          >
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        {isMissing ? (
                          <ContextMenuItem onClick={() => handleRemoveGoogleDocEntry(entry.googleDocId)}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove from tracking
                          </ContextMenuItem>
                        ) : (
                          <>
                            <ContextMenuItem onClick={() => handleFileRename(entry.localPath)}>
                              <Edit3 className="h-4 w-4 mr-2" />
                              Rename
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => handleFileShowInFolder(entry.localPath)}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Show in Folder
                            </ContextMenuItem>
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleFileDeleteRequest(entry.localPath)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </ContextMenuItem>
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
            </div>
          )
        ) : viewMode === 'notebooks' ? (
          // Notebooks view (reMarkable)
          !remarkableEnabled ? (
            <div className="flex h-full flex-col p-4">
              <p className="text-sm text-muted-foreground">
                Connect your reMarkable to sync notebooks.
              </p>
              <Button
                variant="ghost"
                className="mt-6 w-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                onClick={() => setDialogOpen(true, 'integrations')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : !notebookMetadata ? (
            <div className="p-4 text-sm text-muted-foreground">
              {isLoading ? 'Loading notebooks...' : syncError ? (
                <span className="text-red-500">{syncError}</span>
              ) : 'No notebooks synced yet. Click sync to download.'}
            </div>
          ) : allNotebooks.length === 0 && itemsByParent.size === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No notebooks found.
            </div>
          ) : (
            <div className={cn(
              "p-2",
              isSyncing && "opacity-50 pointer-events-none"
            )}>
              {renderNotebookItems(null, 0)}
            </div>
          )
        ) : (
          // Folder view
          !rootPath ? (
            <div className="flex h-full flex-col p-4">
              <p className="text-sm text-muted-foreground">
                No folder configured. Set up in Settings → Integrations.
              </p>
              <Button
                variant="ghost"
                className="mt-6 w-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                onClick={() => setDialogOpen(true, 'integrations')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="p-2 min-h-full">
                  {/* Parent directory navigation */}
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 text-muted-foreground mb-1"
                    onClick={navigateToParent}
                    title="Go to parent folder"
                  >
                    <ChevronUp className="h-4 w-4 shrink-0" />
                    <span className="truncate">..</span>
                  </button>
                  {files.length === 0 && !isLoading ? (
                    <div className="px-2 py-4 text-sm text-muted-foreground">
                      No markdown files found.
                    </div>
                  ) : (
                    <FileTree
                      items={files}
                      expandedFolders={expandedFolders}
                      selectedPath={selectedPath}
                      loadingFolders={loadingFolders}
                      renamingPath={renamingPath}
                      clipboardPath={clipboardPath}
                      onFileClick={handleFileClick}
                      onFileDoubleClick={handleFileDoubleClick}
                      onFolderToggle={toggleFolder}
                      onFolderDoubleClick={setRootPath}
                      onFileTrash={handleFileDeleteRequest}
                      onFileRename={handleFileRenameInline}
                      onFileShowInFolder={handleFileShowInFolder}
                      onFileCopy={(path: string) => useFileListStore.getState().setClipboardPath(path)}
                      onFilePaste={pasteFile}
                      onFileOpen={handleFileDoubleClick}
                      onRenameComplete={handleRenameComplete}
                      onRenameCancel={handleRenameCancel}
                      onNewFile={handleNewFileInDir}
                    />
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={handleNewFile}>
                  <FilePlus className="h-4 w-4 mr-2" />
                  New File
                  <ContextMenuShortcut>⌘N</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => pasteFile()} disabled={!clipboardPath}>
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Paste
                  <ContextMenuShortcut>⌘V</ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        )}
      </ScrollArea>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Trash?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.linkedNotebookId ? (
                <>
                  This will move <strong>{deleteTarget?.fileName}</strong> to the Trash and unlink it from its reMarkable notebook.
                  The original OCR content will be preserved and you can re-create an editable version later.
                </>
              ) : (
                <>
                  Are you sure you want to move <strong>{deleteTarget?.fileName}</strong> to the Trash?
                  You can restore it from the Trash if needed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Moving...' : 'Move to Trash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New File Dialog */}
      <Dialog open={newFileDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setNewFileDialogOpen(false)
          setOperationError(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
            <DialogDescription>
              Create a new markdown file in the current folder.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-filename">File name</Label>
              <Input
                id="new-filename"
                placeholder="untitled.md"
                value={newFileName}
                onChange={(e) => {
                  setNewFileName(e.target.value)
                  setOperationError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateNewFile()
                  }
                }}
                autoFocus
              />
              {operationError && (
                <p className="text-sm text-destructive">{operationError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewFileDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateNewFile} disabled={!newFileName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename File Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setRenameDialogOpen(false)
          setOperationError(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>
              Enter a new name for the file.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename-filename">File name</Label>
              <Input
                id="rename-filename"
                value={renameFileName}
                onChange={(e) => {
                  setRenameFileName(e.target.value)
                  setOperationError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmRename()
                  }
                }}
                autoFocus
              />
              {operationError && (
                <p className="text-sm text-destructive">{operationError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRename} disabled={!renameFileName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
