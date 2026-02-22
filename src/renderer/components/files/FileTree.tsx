import { useState, useRef, useEffect } from 'react'
import type { FileItem } from '../../types'
import { ChevronRight, ChevronDown, FileText, Folder, Loader2, Trash2, Edit3, ExternalLink, Copy, ClipboardPaste, FilePlus } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '../ui/context-menu'

interface FileTreeProps {
  items: FileItem[]
  expandedFolders: Set<string>
  selectedPath: string | null
  loadingFolders?: Set<string>
  renamingPath?: string | null
  clipboardPath?: string | null
  onFileClick: (path: string) => void
  onFolderToggle: (path: string) => void
  onFolderDoubleClick?: (path: string) => void
  onFileDoubleClick?: (path: string) => void
  onFileDelete?: (path: string) => void
  onFileRename?: (path: string) => void
  onFileShowInFolder?: (path: string) => void
  onFileLinkClick?: (path: string) => void
  onFileCopy?: (path: string) => void
  onFilePaste?: () => void
  onFileTrash?: (path: string) => void
  onFileOpen?: (path: string) => void
  onRenameComplete?: (oldPath: string, newName: string) => void
  onRenameCancel?: () => void
  onNewFile?: (dirPath: string) => void
  depth?: number
}

export function FileTree({
  items,
  expandedFolders,
  selectedPath,
  loadingFolders,
  renamingPath,
  clipboardPath,
  onFileClick,
  onFolderToggle,
  onFolderDoubleClick,
  onFileDoubleClick,
  onFileDelete,
  onFileRename,
  onFileShowInFolder,
  onFileLinkClick,
  onFileCopy,
  onFilePaste,
  onFileTrash,
  onFileOpen,
  onRenameComplete,
  onRenameCancel,
  onNewFile,
  depth = 0
}: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <FileTreeItem
          key={item.path}
          item={item}
          expandedFolders={expandedFolders}
          selectedPath={selectedPath}
          loadingFolders={loadingFolders}
          renamingPath={renamingPath}
          clipboardPath={clipboardPath}
          onFileClick={onFileClick}
          onFolderToggle={onFolderToggle}
          onFolderDoubleClick={onFolderDoubleClick}
          onFileDoubleClick={onFileDoubleClick}
          onFileDelete={onFileDelete}
          onFileRename={onFileRename}
          onFileShowInFolder={onFileShowInFolder}
          onFileLinkClick={onFileLinkClick}
          onFileCopy={onFileCopy}
          onFilePaste={onFilePaste}
          onFileTrash={onFileTrash}
          onFileOpen={onFileOpen}
          onRenameComplete={onRenameComplete}
          onRenameCancel={onRenameCancel}
          onNewFile={onNewFile}
          depth={depth}
        />
      ))}
    </div>
  )
}

interface FileTreeItemProps {
  item: FileItem
  expandedFolders: Set<string>
  selectedPath: string | null
  loadingFolders?: Set<string>
  renamingPath?: string | null
  clipboardPath?: string | null
  onFileClick: (path: string) => void
  onFolderToggle: (path: string) => void
  onFolderDoubleClick?: (path: string) => void
  onFileDoubleClick?: (path: string) => void
  onFileDelete?: (path: string) => void
  onFileRename?: (path: string) => void
  onFileShowInFolder?: (path: string) => void
  onFileLinkClick?: (path: string) => void
  onFileCopy?: (path: string) => void
  onFilePaste?: () => void
  onFileTrash?: (path: string) => void
  onFileOpen?: (path: string) => void
  onRenameComplete?: (oldPath: string, newName: string) => void
  onRenameCancel?: () => void
  onNewFile?: (dirPath: string) => void
  depth: number
}

function FileTreeItem({
  item,
  expandedFolders,
  selectedPath,
  loadingFolders,
  renamingPath,
  clipboardPath,
  onFileClick,
  onFolderToggle,
  onFolderDoubleClick,
  onFileDoubleClick,
  onFileDelete,
  onFileRename,
  onFileShowInFolder,
  onFileLinkClick,
  onFileCopy,
  onFilePaste,
  onFileTrash,
  onFileOpen,
  onRenameComplete,
  onRenameCancel,
  onNewFile,
  depth
}: FileTreeItemProps) {
  const isExpanded = expandedFolders.has(item.path)
  const isSelected = selectedPath === item.path
  const isLoading = loadingFolders?.has(item.path) ?? false
  const isRenaming = renamingPath === item.path

  // Inline rename state
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) {
      const nameWithoutExt = item.name.replace(/\.(md|markdown|txt)$/, '')
      setRenameValue(nameWithoutExt)
      // Wait for Radix context menu close animation before focusing
      requestAnimationFrame(() => {
        setTimeout(() => {
          inputRef.current?.focus()
          inputRef.current?.select()
        }, 50)
      })
    }
  }, [isRenaming, item.name])

  const handleRenameSubmit = () => {
    if (!renameValue.trim() || !onRenameComplete) return
    onRenameComplete(item.path, renameValue.trim())
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onRenameCancel?.()
    }
    // Stop all key events from bubbling during rename
    e.stopPropagation()
  }

  const handleClick = () => {
    if (isRenaming) return
    if (item.isDirectory) {
      onFolderToggle(item.path)
    } else {
      onFileClick(item.path)
    }
  }

  const handleDoubleClick = () => {
    if (item.isDirectory && onFolderDoubleClick) {
      onFolderDoubleClick(item.path)
    } else if (!item.isDirectory && onFileDoubleClick) {
      onFileDoubleClick(item.path)
    }
  }

  // Remove .md extension for display
  const displayName = item.isDirectory
    ? item.name
    : item.name.replace(/\.(md|markdown|txt)$/, '')

  // Show chevron only if folder has or may have children
  const showChevron = item.isDirectory && (item.children?.length || item.hasChildren)

  const buttonElement = (
    <div className={cn("group flex items-center", !item.isDirectory && onFileLinkClick && "relative")}>
      <button
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-left transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isSelected && 'bg-accent text-accent-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={item.path}
      >
        {item.isDirectory ? (
          <>
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin" />
            ) : showChevron ? (
              isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-3.5" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none border-none p-0 text-foreground selection:bg-accent-foreground/20"
          />
        ) : (
          <span className="truncate flex-1 min-w-0">{displayName}</span>
        )}
      </button>
      {!item.isDirectory && onFileLinkClick && !isRenaming && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onFileLinkClick(item.path)
          }}
          className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
          title="Open in Google Docs"
        >
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </button>
      )}
    </div>
  )

  const fileContextMenu = (
    <ContextMenuContent>
      {onFileOpen && (
        <ContextMenuItem onClick={() => onFileOpen(item.path)}>
          <FileText className="h-4 w-4 mr-2" />
          Open
        </ContextMenuItem>
      )}
      {(onFileRename || onRenameComplete) && (
        <ContextMenuItem onClick={() => onFileRename ? onFileRename(item.path) : onRenameComplete?.(item.path, '')}>
          <Edit3 className="h-4 w-4 mr-2" />
          Rename
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onFileCopy && (
        <ContextMenuItem onClick={() => onFileCopy(item.path)}>
          <Copy className="h-4 w-4 mr-2" />
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onFilePaste && (
        <ContextMenuItem onClick={() => onFilePaste()} disabled={!clipboardPath}>
          <ClipboardPaste className="h-4 w-4 mr-2" />
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onFileShowInFolder && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onFileShowInFolder(item.path)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Show in Finder
          </ContextMenuItem>
        </>
      )}
      {(onFileTrash || onFileDelete) && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onFileTrash ? onFileTrash(item.path) : onFileDelete?.(item.path)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Move to Trash
            <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )

  const folderContextMenu = (
    <ContextMenuContent>
      {onNewFile && (
        <ContextMenuItem onClick={() => onNewFile(item.path)}>
          <FilePlus className="h-4 w-4 mr-2" />
          New File
          <ContextMenuShortcut>⌘N</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onFilePaste && (
        <ContextMenuItem onClick={() => onFilePaste()} disabled={!clipboardPath}>
          <ClipboardPaste className="h-4 w-4 mr-2" />
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onFileShowInFolder && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onFileShowInFolder(item.path)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Show in Finder
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {buttonElement}
        </ContextMenuTrigger>
        {item.isDirectory ? folderContextMenu : fileContextMenu}
      </ContextMenu>

      {item.isDirectory && isExpanded && item.children && (
        <FileTree
          items={item.children}
          expandedFolders={expandedFolders}
          selectedPath={selectedPath}
          loadingFolders={loadingFolders}
          renamingPath={renamingPath}
          clipboardPath={clipboardPath}
          onFileClick={onFileClick}
          onFolderToggle={onFolderToggle}
          onFolderDoubleClick={onFolderDoubleClick}
          onFileDoubleClick={onFileDoubleClick}
          onFileDelete={onFileDelete}
          onFileRename={onFileRename}
          onFileShowInFolder={onFileShowInFolder}
          onFileLinkClick={onFileLinkClick}
          onFileCopy={onFileCopy}
          onFilePaste={onFilePaste}
          onFileTrash={onFileTrash}
          onFileOpen={onFileOpen}
          onRenameComplete={onRenameComplete}
          onRenameCancel={onRenameCancel}
          onNewFile={onNewFile}
          depth={depth + 1}
        />
      )}
    </div>
  )
}
