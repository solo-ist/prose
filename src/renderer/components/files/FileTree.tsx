import { useState, useRef, useEffect, useCallback } from 'react'
import type { FileItem } from '../../types'
import { ChevronRight, ChevronDown, FileText, FileType, Folder, FolderOpen, Loader2, Trash2, Edit3, ExternalLink, Copy, Scissors, ClipboardPaste, FilePlus } from 'lucide-react'
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
  clipboardOperation?: 'copy' | 'cut' | null
  onFileClick: (path: string) => void
  onFolderToggle: (path: string) => void
  onFolderDoubleClick?: (path: string) => void
  onFileDoubleClick?: (path: string) => void
  onFileDelete?: (path: string) => void
  onFileRename?: (path: string) => void
  onFileShowInFolder?: (path: string) => void
  onFileLinkClick?: (path: string) => void
  onFileCopy?: (path: string) => void
  onFileCut?: (path: string) => void
  onFilePaste?: (targetDir?: string) => void
  onFileTrash?: (path: string) => void
  onFileOpen?: (path: string) => void
  onRenameComplete?: (oldPath: string, newName: string) => void
  onRenameCancel?: () => void
  onNewFile?: (dirPath: string) => void
  onFileDrop?: (sourcePath: string, targetDirPath: string) => void
  depth?: number
}

export function FileTree({
  items,
  expandedFolders,
  selectedPath,
  loadingFolders,
  renamingPath,
  clipboardPath,
  clipboardOperation,
  onFileClick,
  onFolderToggle,
  onFolderDoubleClick,
  onFileDoubleClick,
  onFileDelete,
  onFileRename,
  onFileShowInFolder,
  onFileLinkClick,
  onFileCopy,
  onFileCut,
  onFilePaste,
  onFileTrash,
  onFileOpen,
  onRenameComplete,
  onRenameCancel,
  onNewFile,
  onFileDrop,
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
          clipboardOperation={clipboardOperation}
          onFileClick={onFileClick}
          onFolderToggle={onFolderToggle}
          onFolderDoubleClick={onFolderDoubleClick}
          onFileDoubleClick={onFileDoubleClick}
          onFileDelete={onFileDelete}
          onFileRename={onFileRename}
          onFileShowInFolder={onFileShowInFolder}
          onFileLinkClick={onFileLinkClick}
          onFileCopy={onFileCopy}
          onFileCut={onFileCut}
          onFilePaste={onFilePaste}
          onFileTrash={onFileTrash}
          onFileOpen={onFileOpen}
          onRenameComplete={onRenameComplete}
          onRenameCancel={onRenameCancel}
          onNewFile={onNewFile}
          onFileDrop={onFileDrop}
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
  clipboardOperation?: 'copy' | 'cut' | null
  onFileClick: (path: string) => void
  onFolderToggle: (path: string) => void
  onFolderDoubleClick?: (path: string) => void
  onFileDoubleClick?: (path: string) => void
  onFileDelete?: (path: string) => void
  onFileRename?: (path: string) => void
  onFileShowInFolder?: (path: string) => void
  onFileLinkClick?: (path: string) => void
  onFileCopy?: (path: string) => void
  onFileCut?: (path: string) => void
  onFilePaste?: (targetDir?: string) => void
  onFileTrash?: (path: string) => void
  onFileOpen?: (path: string) => void
  onRenameComplete?: (oldPath: string, newName: string) => void
  onRenameCancel?: () => void
  onNewFile?: (dirPath: string) => void
  onFileDrop?: (sourcePath: string, targetDirPath: string) => void
  depth: number
}

function FileTreeItem({
  item,
  expandedFolders,
  selectedPath,
  loadingFolders,
  renamingPath,
  clipboardPath,
  clipboardOperation,
  onFileClick,
  onFolderToggle,
  onFolderDoubleClick,
  onFileDoubleClick,
  onFileDelete,
  onFileRename,
  onFileShowInFolder,
  onFileLinkClick,
  onFileCopy,
  onFileCut,
  onFilePaste,
  onFileTrash,
  onFileOpen,
  onRenameComplete,
  onRenameCancel,
  onNewFile,
  onFileDrop,
  depth
}: FileTreeItemProps) {
  const isExpanded = expandedFolders.has(item.path)
  const isSelected = selectedPath === item.path
  const isLoading = loadingFolders?.has(item.path) ?? false
  const isRenaming = renamingPath === item.path
  const isCut = clipboardOperation === 'cut' && clipboardPath === item.path

  // Inline rename state
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasRenamingRef = useRef(false)

  // Drag-and-drop state (for folder drop targets)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', item.path)
    e.dataTransfer.effectAllowed = 'move'
  }, [item.path])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!item.isDirectory) return
    if (e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [item.isDirectory])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!item.isDirectory) return
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragOver(true)
  }, [item.isDirectory])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!item.isDirectory) return
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragOver(false)
  }, [item.isDirectory])

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!item.isDirectory) return
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)
    const sourcePath = e.dataTransfer.getData('text/plain')
    if (sourcePath && sourcePath !== item.path) {
      onFileDrop?.(sourcePath, item.path)
    }
  }, [item.isDirectory, item.path, onFileDrop])

  // Refocus the button (and thus the explorer container) after rename ends
  useEffect(() => {
    if (!isRenaming && wasRenamingRef.current) {
      requestAnimationFrame(() => {
        buttonRef.current?.focus({ preventScroll: true })
      })
    }
    wasRenamingRef.current = isRenaming
  }, [isRenaming])

  useEffect(() => {
    if (isRenaming) {
      const nameWithoutExt = item.name.replace(/\.(md|markdown|txt)$/, '')
      setRenameValue(nameWithoutExt)
      // Wait for Radix context menu close animation before focusing
      requestAnimationFrame(() => {
        setTimeout(() => {
          const input = inputRef.current
          if (!input) return
          input.focus({ preventScroll: true })
          input.select()
          // Reset scroll caused by select() showing cursor at end
          input.scrollLeft = 0
          // Also reset parent scroll container if it shifted
          input.closest('[data-radix-scroll-area-viewport]')?.scrollTo(0, 0)
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
    <div
      className={cn("group flex items-center", !item.isDirectory && onFileLinkClick && "relative")}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        ref={buttonRef}
        draggable={!item.isDirectory}
        onDragStart={!item.isDirectory ? handleDragStart : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-left transition-colors outline-none',
          'hover:bg-accent hover:text-accent-foreground',
          isSelected && 'bg-accent text-accent-foreground',
          isCut && 'opacity-50',
          isDragOver && 'ring-1 ring-primary bg-primary/10'
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
            {isDragOver ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            {item.name.endsWith('.txt') ? (
              <FileType className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
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
            className="flex-1 min-w-0 bg-transparent text-sm leading-5 outline-none border-none p-0 m-0 h-5 text-foreground selection:bg-accent-foreground/20"
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
      {onFileRename && (
        <ContextMenuItem onClick={() => onFileRename(item.path)}>
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
      {onFileCut && (
        <ContextMenuItem onClick={() => onFileCut(item.path)}>
          <Scissors className="h-4 w-4 mr-2" />
          Cut
          <ContextMenuShortcut>⌘X</ContextMenuShortcut>
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
        <ContextMenuItem onClick={() => onFilePaste(item.path)} disabled={!clipboardPath}>
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
          clipboardOperation={clipboardOperation}
          onFileClick={onFileClick}
          onFolderToggle={onFolderToggle}
          onFolderDoubleClick={onFolderDoubleClick}
          onFileDoubleClick={onFileDoubleClick}
          onFileDelete={onFileDelete}
          onFileRename={onFileRename}
          onFileShowInFolder={onFileShowInFolder}
          onFileLinkClick={onFileLinkClick}
          onFileCopy={onFileCopy}
          onFileCut={onFileCut}
          onFilePaste={onFilePaste}
          onFileTrash={onFileTrash}
          onFileOpen={onFileOpen}
          onRenameComplete={onRenameComplete}
          onRenameCancel={onRenameCancel}
          onNewFile={onNewFile}
          onFileDrop={onFileDrop}
          depth={depth + 1}
        />
      )}
    </div>
  )
}
