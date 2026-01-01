import { useFileList } from '../../hooks/useFileList'
import { useEditor } from '../../hooks/useEditor'
import { useRemarkableSync } from '../../hooks/useRemarkableSync'
import { useSettingsStore } from '../../stores/settingsStore'
import { FileTree } from './FileTree'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { FolderOpen, RefreshCw, Loader2, Cloud, Plus } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'

export function FileListPanel() {
  const {
    files,
    rootPath,
    isLoading,
    expandedFolders,
    selectedPath,
    loadFiles,
    selectFile,
    toggleFolder
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
  const folderName = rootPath?.split('/').pop() || 'Files'

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium truncate" title={rootPath || undefined}>
            {folderName}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {remarkableEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={sync}
                  disabled={isSyncing}
                  aria-label="Sync from reMarkable"
                >
                  {isSyncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Cloud className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cloud Sync</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRefresh}
                disabled={isLoading || !rootPath}
                aria-label="Refresh files"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh files</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* File Tree */}
      <ScrollArea className="flex-1">
        {!rootPath ? (
          <div className="flex h-full flex-col p-4">
            <p className="text-sm text-muted-foreground">
              No folder configured. Set up in Settings → Integrations.
            </p>
            <Button
              variant="ghost"
              className="mt-6 w-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
              onClick={() => setDialogOpen(true)}
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
        )}
      </ScrollArea>
    </div>
  )
}
