import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { History, Cloud, Plus, FileText, BookOpen, CloudOff, ChevronUp, Folder, FolderOpen, Download, Trash2, FilePlus } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { cn } from '../../lib/utils'
import { getApi } from '../../lib/browserApi'
import type { RemarkableNotebookMetadata, RemarkableCloudNotebook } from '../../types'

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
    syncDirectory,
    deviceToken
  } = useFileList()

  const { openFileFromPath } = useEditor()
  const { isSyncing, sync, error: syncError } = useRemarkableSync()
  const { setDialogOpen } = useSettings()
  const remarkableEnabled = useSettingsStore((state) => state.settings.remarkable?.enabled)

  // Dialog state for file operations
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameFilePath, setRenameFilePath] = useState<string | null>(null)
  const [renameFileName, setRenameFileName] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteFilePath, setDeleteFilePath] = useState<string | null>(null)

  const api = getApi()

  // Auto-sync when switching to notebooks view
  useEffect(() => {
    if (viewMode === 'notebooks' && remarkableEnabled && !isSyncing) {
      sync().catch((err) => {
        console.error('[FileListPanel] Auto-sync failed:', err)
      })
    }
  }, [viewMode, remarkableEnabled]) // Intentionally exclude sync and isSyncing to only trigger on view change

  const handleFileClick = async (path: string) => {
    selectFile(path)
    await openFileFromPath(path)
  }

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

  const handleNotebookClick = async (notebook: RemarkableNotebookMetadata) => {
    // If markdown is available, open it
    if (notebook.markdownPath && syncDirectory) {
      const fullPath = `${syncDirectory}/${notebook.markdownPath}`
      selectFile(fullPath)
      await openFileFromPath(fullPath)
    }
  }

  // File operation handlers
  const handleNewFile = () => {
    setNewFileName('')
    setNewFileDialogOpen(true)
  }

  const handleCreateNewFile = async () => {
    if (!newFileName.trim() || !rootPath) return

    try {
      const fileName = newFileName.endsWith('.md') ? newFileName : `${newFileName}.md`
      const fullPath = await api.saveToFolder(rootPath, fileName, '')
      setNewFileDialogOpen(false)
      setNewFileName('')

      // Refresh file list and open the new file
      await loadFiles()
      selectFile(fullPath)
      await openFileFromPath(fullPath)
    } catch (error) {
      console.error('Error creating file:', error)
    }
  }

  const handleFileDelete = (path: string) => {
    setDeleteFilePath(path)
    setDeleteConfirmOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!deleteFilePath) return

    try {
      await api.deleteFile(deleteFilePath)
      setDeleteConfirmOpen(false)
      setDeleteFilePath(null)

      // Refresh file list
      await loadFiles()
    } catch (error) {
      console.error('Error deleting file:', error)
    }
  }

  const handleFileRename = (path: string) => {
    const fileName = path.split('/').pop() || ''
    const nameWithoutExt = fileName.replace(/\.(md|markdown|txt)$/, '')
    setRenameFilePath(path)
    setRenameFileName(nameWithoutExt)
    setRenameDialogOpen(true)
  }

  const handleConfirmRename = async () => {
    if (!renameFilePath || !renameFileName.trim()) return

    try {
      const dir = renameFilePath.substring(0, renameFilePath.lastIndexOf('/'))
      const oldExt = renameFilePath.match(/\.(md|markdown|txt)$/)?.[0] || '.md'
      const newName = renameFileName.endsWith(oldExt) ? renameFileName : `${renameFileName}${oldExt}`
      const newPath = `${dir}/${newName}`

      await api.renameFile(renameFilePath, newPath)
      setRenameDialogOpen(false)
      setRenameFilePath(null)
      setRenameFileName('')

      // Refresh file list and select the renamed file
      await loadFiles()
      selectFile(newPath)
    } catch (error) {
      console.error('Error renaming file:', error)
    }
  }

  const handleFileShowInFolder = async (path: string) => {
    try {
      await api.showInFolder(path)
    } catch (error) {
      console.error('Error showing file in folder:', error)
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
        const hasMarkdown = !!localMeta?.markdownPath
        const fullMarkdownPath = (localMeta?.markdownPath && syncDirectory)
          ? `${syncDirectory}/${localMeta.markdownPath}`
          : null

        return (
          <div key={notebookId} style={{ paddingLeft: depth > 0 ? '1rem' : 0 }}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                    fullMarkdownPath && selectedPath === fullMarkdownPath && "bg-muted",
                    !isSynced && "opacity-30"
                  )}
                  onClick={() => {
                    if (localMeta && hasMarkdown) {
                      handleNotebookClick(localMeta)
                    }
                  }}
                  title={
                    !isSynced
                      ? `${item.name} (not synced - right-click to sync)`
                      : hasMarkdown
                        ? `${item.name} (converted to markdown)`
                        : `${item.name} (synced, not converted)`
                  }
                  disabled={!isSynced || !hasMarkdown}
                >
                  {isSynced ? (
                    hasMarkdown ? (
                      <Cloud className="h-4 w-4 shrink-0 text-foreground" />
                    ) : (
                      <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
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
      {(isLoading || isSyncing) && (
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
          ) : allNotebooks.length === 0 && itemsByParent.size === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No notebooks found.
            </div>
          ) : (
            <div className="p-2">
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
                <div className="p-2 flex-1">
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
                      onFileClick={handleFileClick}
                      onFolderToggle={toggleFolder}
                      onFolderDoubleClick={setRootPath}
                      onFileDelete={handleFileDelete}
                      onFileRename={handleFileRename}
                      onFileShowInFolder={handleFileShowInFolder}
                    />
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={handleNewFile}>
                  <FilePlus className="h-4 w-4 mr-2" />
                  New file
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        )}
      </ScrollArea>

      {/* New File Dialog */}
      <Dialog open={newFileDialogOpen} onOpenChange={setNewFileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
            <DialogDescription>
              Create a new markdown file in {rootPath}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="filename">File name</Label>
              <Input
                id="filename"
                placeholder="untitled.md"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateNewFile()
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateNewFile} disabled={!newFileName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename File Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>
              Enter a new name for the file
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rename">File name</Label>
              <Input
                id="rename"
                value={renameFileName}
                onChange={(e) => setRenameFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmRename()
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRename} disabled={!renameFileName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this file? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <code className="text-sm bg-muted px-2 py-1 rounded">
              {deleteFilePath?.split('/').pop()}
            </code>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
