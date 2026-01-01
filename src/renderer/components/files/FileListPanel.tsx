import { useFileList } from '../../hooks/useFileList'
import { useEditor } from '../../hooks/useEditor'
import { useRemarkableSync } from '../../hooks/useRemarkableSync'
import { useSettingsStore } from '../../stores/settingsStore'
import { FileTree } from './FileTree'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { History, RefreshCw, Loader2, Cloud, Plus, FileText } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { cn } from '../../lib/utils'

export function FileListPanel() {
  const {
    files,
    rootPath,
    isLoading,
    viewMode,
    expandedFolders,
    selectedPath,
    recentFiles,
    loadFiles,
    selectFile,
    toggleFolder,
    setViewMode
  } = useFileList()

  const { openFileFromPath } = useEditor()
  const { isSyncing, sync } = useRemarkableSync()
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

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium truncate" title={viewMode === 'folder' ? rootPath || undefined : undefined}>
            {viewMode === 'recent' ? 'Recent' : folderName}
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
                aria-label="Cloud files"
              >
                <Cloud className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cloud files</TooltipContent>
          </Tooltip>

          {/* Folder view actions */}
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
          ) : files.length === 0 && !isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">
              No markdown files found.
            </div>
          ) : (
            <div className="p-2">
              <FileTree
                items={files}
                expandedFolders={expandedFolders}
                selectedPath={selectedPath}
                onFileClick={handleFileClick}
                onFolderToggle={toggleFolder}
              />
            </div>
          )
        )}
      </ScrollArea>
    </div>
  )
}
