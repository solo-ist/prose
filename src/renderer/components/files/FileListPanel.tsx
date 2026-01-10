import { useMemo, useState } from 'react'
import { useFileList } from '../../hooks/useFileList'
import { useEditor } from '../../hooks/useEditor'
import { useRemarkableSync } from '../../hooks/useRemarkableSync'
import { useSettingsStore } from '../../stores/settingsStore'
import { FileTree } from './FileTree'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../ui/context-menu'
import { History, RefreshCw, Loader2, Cloud, Plus, FileText, BookOpen, Check, CloudOff, ChevronUp, Folder, Download, Trash2 } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { cn } from '../../lib/utils'
import type { RemarkableNotebookMetadata, RemarkableCloudNotebook } from '../../types'

export function FileListPanel() {
  const {
    files,
    rootPath,
    isLoading,
    viewMode,
    expandedFolders,
    selectedPath,
    recentFiles,
    notebookMetadata,
    cloudNotebooks,
    syncState,
    loadFiles,
    loadNotebooks,
    selectFile,
    toggleFolder,
    setViewMode,
    navigateToParent,
    toggleNotebookSync,
    syncDirectory,
    deviceToken
  } = useFileList()

  const { openFileFromPath } = useEditor()
  const { isSyncing, sync, error: syncError } = useRemarkableSync()
  const { setDialogOpen } = useSettings()
  const remarkableEnabled = useSettingsStore((state) => state.settings.remarkable?.enabled)

  const handleFileClick = async (path: string) => {
    selectFile(path)
    await openFileFromPath(path)
  }

  const handleRefresh = () => {
    loadFiles()
  }

  // Get folder name from path for display
  const folderName = rootPath?.split('/').pop() || 'Cloud'

  // Get filename from path for recent files display
  const getFileName = (path: string) => path.split('/').pop() || path

  // Organize cloud notebooks into a hierarchical structure with sync status
  const organizedNotebooks = useMemo(() => {
    // If we have cloud notebooks, use those (they represent all notebooks)
    // Otherwise fall back to local metadata
    const sourceNotebooks = cloudNotebooks.length > 0
      ? cloudNotebooks
      : notebookMetadata?.notebooks
        ? Object.values(notebookMetadata.notebooks)
        : []

    const folders: (RemarkableCloudNotebook | RemarkableNotebookMetadata)[] = []
    const items: (RemarkableCloudNotebook | RemarkableNotebookMetadata)[] = []

    for (const item of sourceNotebooks) {
      if (item.type === 'folder') {
        folders.push(item)
      } else {
        items.push(item)
      }
    }

    // Sort alphabetically
    folders.sort((a, b) => a.name.localeCompare(b.name))
    items.sort((a, b) => a.name.localeCompare(b.name))

    return { folders, notebooks: items }
  }, [cloudNotebooks, notebookMetadata])

  // Check if a notebook is synced
  const isNotebookSynced = (notebookId: string): boolean => {
    if (!syncState) return true // If no sync state, assume all synced (legacy behavior)
    return syncState.selectedNotebooks.includes(notebookId)
  }

  // Get notebook ID from either cloud notebook or metadata
  const getNotebookId = (notebook: RemarkableCloudNotebook | RemarkableNotebookMetadata): string => {
    return 'id' in notebook ? notebook.id : notebook.hash
  }

  // Handle right-click sync toggle
  const handleToggleSync = (notebookId: string) => {
    if (syncDirectory) {
      toggleNotebookSync(notebookId, syncDirectory)
    }
  }

  const handleNotebookClick = async (notebook: RemarkableNotebookMetadata) => {
    // If markdown is available, open it; otherwise show the raw file
    const pathToOpen = notebook.markdownPath || notebook.localPath
    if (pathToOpen) {
      selectFile(pathToOpen)
      await openFileFromPath(pathToOpen)
    }
  }

  const handleNotebookRefresh = () => {
    if (syncDirectory) {
      loadNotebooks(syncDirectory)
    }
  }

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium truncate" title={viewMode === 'folder' ? rootPath || undefined : undefined}>
            {viewMode === 'recent' ? 'Recent' : viewMode === 'notebooks' ? 'Notebooks' : folderName}
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
                onClick={() => setViewMode('folder')}
                aria-label="Files"
              >
                <Folder className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Files</TooltipContent>
          </Tooltip>
          {remarkableEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", viewMode === 'notebooks' && "bg-muted")}
                  onClick={() => setViewMode('notebooks')}
                  aria-label="reMarkable notebooks"
                >
                  <BookOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>reMarkable notebooks</TooltipContent>
            </Tooltip>
          )}

          {/* View-specific actions */}
          {viewMode === 'folder' && rootPath && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={remarkableEnabled ? sync : handleRefresh}
                  disabled={isLoading || isSyncing}
                  aria-label={remarkableEnabled ? "Sync" : "Refresh"}
                >
                  {isLoading || isSyncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{remarkableEnabled ? "Sync" : "Refresh"}</TooltipContent>
            </Tooltip>
          )}
          {viewMode === 'notebooks' && remarkableEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={sync}
                  disabled={isLoading || isSyncing}
                  aria-label="Sync from reMarkable"
                >
                  {isLoading || isSyncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sync from reMarkable</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

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
                <button
                  key={path}
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
              ))}
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
          ) : organizedNotebooks.notebooks.length === 0 && organizedNotebooks.folders.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No notebooks found.
            </div>
          ) : (
            <div className="p-2">
              {/* Folders first */}
              {organizedNotebooks.folders.map((folder) => {
                const folderId = getNotebookId(folder)
                return (
                  <div
                    key={folderId}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground"
                  >
                    <Folder className="h-4 w-4 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </div>
                )
              })}
              {/* Notebooks with sync status */}
              {organizedNotebooks.notebooks.map((notebook) => {
                const notebookId = getNotebookId(notebook)
                const isSynced = isNotebookSynced(notebookId)
                const localMeta = notebookMetadata?.notebooks
                  ? Object.values(notebookMetadata.notebooks).find(
                      n => n.hash === ('hash' in notebook ? notebook.hash : notebookId)
                    )
                  : null
                const hasMarkdown = !!localMeta?.markdownPath
                const pathToUse = localMeta?.markdownPath || localMeta?.localPath

                return (
                  <ContextMenu key={notebookId}>
                    <ContextMenuTrigger asChild>
                      <button
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                          selectedPath === pathToUse && "bg-muted",
                          !isSynced && "opacity-50"
                        )}
                        onClick={() => {
                          if (localMeta && hasMarkdown) {
                            handleNotebookClick(localMeta)
                          }
                        }}
                        title={
                          !isSynced
                            ? `${notebook.name} (not synced - right-click to sync)`
                            : hasMarkdown
                              ? `${notebook.name} (converted to markdown)`
                              : `${notebook.name} (synced, not converted)`
                        }
                        disabled={!isSynced || !hasMarkdown}
                      >
                        {isSynced ? (
                          hasMarkdown ? (
                            <Check className="h-4 w-4 shrink-0 text-green-500" />
                          ) : (
                            <Cloud className="h-4 w-4 shrink-0 text-blue-500" />
                          )
                        ) : (
                          <CloudOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate flex-1">{notebook.name}</span>
                        {notebook.fileType && (
                          <span className="text-xs text-muted-foreground">
                            {notebook.fileType}
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
                )
              })}
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
            <div className="p-2">
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
                  onFileClick={handleFileClick}
                  onFolderToggle={toggleFolder}
                />
              )}
            </div>
          )
        )}
      </ScrollArea>
    </div>
  )
}
