import { useState, useRef, useEffect, useCallback, memo } from 'react'
import type { FileItem } from '../../types'
import { ChevronRight, ChevronDown, FileText, FileType, Folder, FolderOpen, FolderPlus, Loader2, Trash2, Edit3, ExternalLink, Copy, Scissors, ClipboardPaste, FilePlus, Boxes, Star } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '../ui/context-menu'

const EMPTY_PATH_SET: ReadonlySet<string> = new Set()

interface FileTreeProps {
  items: FileItem[]
  /** Set of favorited file paths, subscribed once at the root and threaded down. */
  favoritePaths?: ReadonlySet<string>
  /** Set of project folder paths, subscribed once at the root and threaded down. */
  projectPaths?: ReadonlySet<string>
  expandedFolders: Set<string>
  selectedPath: string | null
  /** All currently selected paths for multi-select. */
  selectedPaths?: ReadonlySet<string>
  loadingFolders?: Set<string>
  renamingPath?: string | null
  clipboardPath?: string | null
  clipboardOperation?: 'copy' | 'cut' | null
  onFileClick: (path: string) => void
  /** Cmd/Ctrl+click: toggle this path in the selection set. */
  onFileToggleSelect?: (path: string) => void
  /** Shift+click: range-select from anchor to this path. */
  onFileRangeSelect?: (path: string) => void
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
  onFileDuplicate?: (path: string) => void
  onFileTrash?: (path: string) => void
  onFileOpen?: (path: string) => void
  onOpenExternally?: (path: string) => void
  onRenameComplete?: (oldPath: string, newName: string) => void
  onRenameCancel?: () => void
  onNewFile?: (dirPath: string) => void
  onNewFolder?: (parentDirPath: string) => void
  onAddProject?: (path: string) => void
  onAddFavorite?: (path: string, isDirectory: boolean) => void
  onRemoveProject?: (path: string) => void
  onRemoveFavorite?: (path: string) => void
  onFileDrop?: (sourcePath: string, targetDirPath: string) => void
  depth?: number
}

export function FileTree({
  items,
  favoritePaths = EMPTY_PATH_SET,
  projectPaths = EMPTY_PATH_SET,
  expandedFolders,
  selectedPath,
  selectedPaths = EMPTY_PATH_SET,
  loadingFolders,
  renamingPath,
  clipboardPath,
  clipboardOperation,
  onFileClick,
  onFileToggleSelect,
  onFileRangeSelect,
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
  onFileDuplicate,
  onFileTrash,
  onFileOpen,
  onOpenExternally,
  onRenameComplete,
  onRenameCancel,
  onNewFile,
  onNewFolder,
  onAddProject,
  onAddFavorite,
  onRemoveProject,
  onRemoveFavorite,
  onFileDrop,
  depth = 0
}: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <FileTreeItem
          key={item.id ?? item.path}
          item={item}
          favoritePaths={favoritePaths}
          projectPaths={projectPaths}
          expandedFolders={expandedFolders}
          selectedPath={selectedPath}
          selectedPaths={selectedPaths}
          loadingFolders={loadingFolders}
          renamingPath={renamingPath}
          clipboardPath={clipboardPath}
          clipboardOperation={clipboardOperation}
          onFileClick={onFileClick}
          onFileToggleSelect={onFileToggleSelect}
          onFileRangeSelect={onFileRangeSelect}
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
          onFileDuplicate={onFileDuplicate}
          onFileTrash={onFileTrash}
          onFileOpen={onFileOpen}
          onOpenExternally={onOpenExternally}
          onRenameComplete={onRenameComplete}
          onRenameCancel={onRenameCancel}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onAddProject={onAddProject}
          onAddFavorite={onAddFavorite}
          onRemoveProject={onRemoveProject}
          onRemoveFavorite={onRemoveFavorite}
          onFileDrop={onFileDrop}
          depth={depth}
        />
      ))}
    </div>
  )
}

interface FileTreeItemProps {
  item: FileItem
  favoritePaths: ReadonlySet<string>
  projectPaths: ReadonlySet<string>
  expandedFolders: Set<string>
  selectedPath: string | null
  selectedPaths: ReadonlySet<string>
  loadingFolders?: Set<string>
  renamingPath?: string | null
  clipboardPath?: string | null
  clipboardOperation?: 'copy' | 'cut' | null
  onFileClick: (path: string) => void
  onFileToggleSelect?: (path: string) => void
  onFileRangeSelect?: (path: string) => void
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
  onFileDuplicate?: (path: string) => void
  onFileTrash?: (path: string) => void
  onFileOpen?: (path: string) => void
  onOpenExternally?: (path: string) => void
  onRenameComplete?: (oldPath: string, newName: string) => void
  onRenameCancel?: () => void
  onNewFile?: (dirPath: string) => void
  onNewFolder?: (parentDirPath: string) => void
  onAddProject?: (path: string) => void
  onAddFavorite?: (path: string, isDirectory: boolean) => void
  onRemoveProject?: (path: string) => void
  onRemoveFavorite?: (path: string) => void
  onFileDrop?: (sourcePath: string, targetDirPath: string) => void
  depth: number
}

const FileTreeItem = memo(function FileTreeItem({
  item,
  favoritePaths,
  projectPaths,
  expandedFolders,
  selectedPath,
  selectedPaths,
  loadingFolders,
  renamingPath,
  clipboardPath,
  clipboardOperation,
  onFileClick,
  onFileToggleSelect,
  onFileRangeSelect,
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
  onFileDuplicate,
  onFileTrash,
  onFileOpen,
  onOpenExternally,
  onRenameComplete,
  onRenameCancel,
  onNewFile,
  onNewFolder,
  onAddProject,
  onAddFavorite,
  onRemoveProject,
  onRemoveFavorite,
  onFileDrop,
  depth
}: FileTreeItemProps) {
  const isExpanded = expandedFolders.has(item.path)
  // Primary selection (for single-file operations) OR part of multi-select set
  const isSelected = selectedPath === item.path || selectedPaths.has(item.path)
  const isLoading = loadingFolders?.has(item.path) ?? false
  const isRenaming = renamingPath === item.path
  const isCut = clipboardOperation === 'cut' && clipboardPath === item.path
  // Denote favorite files in the tree (folders keep their folder icon).
  // favoritePaths is subscribed once at the root and threaded down (no per-item subscription).
  const isFavorite = !item.isDirectory && favoritePaths.has(item.path)
  // For the right-click menu, favorite/project membership applies to folders too
  // (a folder can be a favorite or a project), unlike the file-only icon above.
  // These drive the "Add … / Remove …" toggle so the menu reflects current state.
  const isFavoritePath = favoritePaths.has(item.path)
  const isProjectPath = projectPaths.has(item.path)

  // When this row is part of a multi-selection, the file context menu switches
  // to bulk mode: actions that work on a set (Open, Add to Favorites, Move to
  // Trash) operate on every selected file via the panel handlers, while
  // single-file-only actions (Rename, Copy, Cut, Paste, Show in Finder) are
  // hidden. Copy/Cut on a set await a multi-path clipboard (tracked in #796).
  const isMultiSelected = selectedPaths.size > 1 && selectedPaths.has(item.path)
  const selectionCount = selectedPaths.size

  // Inline rename state
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasRenamingRef = useRef(false)
  // Set when Rename is chosen from the context menu, so the menu's close handler
  // skips Radix's focus-restore to the row — otherwise it steals focus from the
  // just-mounted rename input, whose onBlur then commits a no-op and exits the
  // rename instantly (the right-click-rename-exits-immediately bug).
  const renameFromMenuRef = useRef(false)
  const handleRenameFromMenu = () => {
    renameFromMenuRef.current = true
    onFileRename?.(item.path)
  }
  const handleMenuCloseAutoFocus = (e: Event) => {
    if (renameFromMenuRef.current) {
      e.preventDefault()
      renameFromMenuRef.current = false
    }
  }

  // Drag-and-drop state (for folder drop targets)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Use a custom MIME type to ensure only internal drags are handled
    e.dataTransfer.setData('application/prose-file-path', item.path)
    e.dataTransfer.effectAllowed = 'move'
  }, [item.path])

  const handleDragEnd = useCallback(() => {
    // Reset drag-over state in case drag was cancelled (e.g. Escape key)
    dragCounterRef.current = 0
    setIsDragOver(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!item.isDirectory) return
    if (e.dataTransfer.types.includes('application/prose-file-path')) {
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
    // Only accept internal drags from within this app
    const sourcePath = e.dataTransfer.getData('application/prose-file-path')
    if (sourcePath && sourcePath !== item.path) {
      onFileDrop?.(sourcePath, item.path)
    }
  }, [item.isDirectory, item.path, onFileDrop])

  // Listen for global dragend to clear highlight when drag is cancelled (e.g. Escape key)
  useEffect(() => {
    if (!item.isDirectory) return
    const handleGlobalDragEnd = () => {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
    document.addEventListener('dragend', handleGlobalDragEnd)
    return () => document.removeEventListener('dragend', handleGlobalDragEnd)
  }, [item.isDirectory])

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
      // Folders keep their full name; files strip the markdown extension for display
      const nameWithoutExt = item.isDirectory
        ? item.name
        : item.name.replace(/\.(md|markdown|txt)$/, '')
      setRenameValue(nameWithoutExt)
      // Wait for Radix context menu close animation before focusing
      requestAnimationFrame(() => {
        setTimeout(() => {
          const input = inputRef.current
          if (!input) return
          // Save the parent scroll position before select() can move it
          const viewport = input.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null
          const savedScrollTop = viewport?.scrollTop ?? 0
          input.focus({ preventScroll: true })
          input.select()
          // select() moves the cursor to end — reset just the input's own scroll,
          // then restore the panel's scroll so the view stays where the user was.
          input.scrollLeft = 0
          if (viewport) viewport.scrollTop = savedScrollTop
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

  const handleClick = (e: React.MouseEvent) => {
    if (isRenaming) return
    if (item.isDirectory) {
      onFolderToggle(item.path)
      return
    }
    // Non-markdown files are not openable in the editor — clicks are inert
    if (item.isNonMarkdown) return
    // Multi-select modifiers (files only — folders always just toggle expand)
    if ((e.metaKey || e.ctrlKey) && onFileToggleSelect) {
      e.preventDefault()
      onFileToggleSelect(item.path)
      return
    }
    if (e.shiftKey && onFileRangeSelect) {
      e.preventDefault()
      onFileRangeSelect(item.path)
      return
    }
    onFileClick(item.path)
  }

  const handleDoubleClick = () => {
    if (item.isDirectory && onFolderDoubleClick) {
      onFolderDoubleClick(item.path)
    } else if (!item.isDirectory && !item.isNonMarkdown && onFileDoubleClick) {
      onFileDoubleClick(item.path)
    }
  }

  // Remove .md extension for display
  const displayName = item.isDirectory
    ? item.name
    : item.isNonMarkdown
      ? item.name  // show full filename including extension for non-markdown files
      : item.name.replace(/\.(md|markdown|txt)$/, '')

  // Show chevron only if folder has or may have children
  const showChevron = item.isDirectory && (item.children?.length || item.hasChildren)

  const buttonElement = (
    <div
      className={cn("group flex items-center", !item.isDirectory && onFileLinkClick && "relative")}
    >
      <button
        ref={buttonRef}
        draggable={!item.isDirectory}
        onDragStart={!item.isDirectory ? handleDragStart : undefined}
        onDragEnd={!item.isDirectory ? handleDragEnd : undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-left transition-colors outline-none',
          // Non-markdown files are visible but greyed — not openable in the editor
          item.isNonMarkdown
            ? 'text-muted-foreground/50 hover:bg-accent/50 cursor-default'
            : 'hover:bg-accent hover:text-accent-foreground',
          isSelected && !item.isNonMarkdown && 'bg-accent text-accent-foreground',
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
            ) : isProjectPath ? (
              // Project folders get the established project icon (Boxes), mirroring
              // how favorited files swap their file icon for a star.
              <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            {isFavorite ? (
              <Star className="h-4 w-4 shrink-0 fill-current text-muted-foreground" />
            ) : item.name.endsWith('.txt') ? (
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
    <ContextMenuContent onCloseAutoFocus={handleMenuCloseAutoFocus}>
      {onFileOpen && (
        <ContextMenuItem onClick={() => onFileOpen?.(item.path)}>
          <FileText className="h-4 w-4 mr-2" />
          {isMultiSelected ? `Open ${selectionCount} Files` : 'Open'}
        </ContextMenuItem>
      )}
      {!isMultiSelected && onFileRename && (
        <ContextMenuItem onClick={handleRenameFromMenu}>
          <Edit3 className="h-4 w-4 mr-2" />
          Rename
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!isMultiSelected && onFileCopy && (
        <ContextMenuItem onClick={() => onFileCopy?.(item.path)}>
          <Copy className="h-4 w-4 mr-2" />
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!isMultiSelected && onFileCut && (
        <ContextMenuItem onClick={() => onFileCut?.(item.path)}>
          <Scissors className="h-4 w-4 mr-2" />
          Cut
          <ContextMenuShortcut>⌘X</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!isMultiSelected && onFilePaste && (
        <ContextMenuItem onClick={() => onFilePaste?.()} disabled={!clipboardPath}>
          <ClipboardPaste className="h-4 w-4 mr-2" />
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {!isMultiSelected && onFileDuplicate && (
        <ContextMenuItem onClick={() => onFileDuplicate?.(item.path)}>
          <Copy className="h-4 w-4 mr-2" />
          Duplicate
        </ContextMenuItem>
      )}
      {!isMultiSelected && onFileShowInFolder && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onFileShowInFolder?.(item.path)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Show in Finder
          </ContextMenuItem>
        </>
      )}
      {onAddFavorite && (
        <>
          <ContextMenuSeparator />
          {isFavoritePath && !isMultiSelected && onRemoveFavorite ? (
            <ContextMenuItem onClick={() => onRemoveFavorite?.(item.path)}>
              <Star className="h-4 w-4 mr-2 fill-current" />
              Remove from Favorites
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => onAddFavorite?.(item.path, false)}>
              <Star className="h-4 w-4 mr-2" />
              {isMultiSelected ? `Add ${selectionCount} to Favorites` : 'Add to Favorites'}
            </ContextMenuItem>
          )}
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
            {isMultiSelected ? `Move ${selectionCount} to Trash` : 'Move to Trash'}
            <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )

  const folderContextMenu = (
    <ContextMenuContent onCloseAutoFocus={handleMenuCloseAutoFocus}>
      {onNewFile && (
        <ContextMenuItem onClick={() => onNewFile?.(item.path)}>
          <FilePlus className="h-4 w-4 mr-2" />
          New File
          <ContextMenuShortcut>⌘N</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onNewFolder && (
        <ContextMenuItem onClick={() => onNewFolder(item.path)}>
          <FolderPlus className="h-4 w-4 mr-2" />
          New Folder
          <ContextMenuShortcut>⇧⌘N</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onFileRename && (
        <ContextMenuItem onClick={handleRenameFromMenu}>
          <Edit3 className="h-4 w-4 mr-2" />
          Rename
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {onFilePaste && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onFilePaste(item.path)} disabled={!clipboardPath}>
            <ClipboardPaste className="h-4 w-4 mr-2" />
            Paste
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
      {onFileShowInFolder && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onFileShowInFolder?.(item.path)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Show in Finder
          </ContextMenuItem>
        </>
      )}
      {(onAddProject || onAddFavorite) && <ContextMenuSeparator />}
      {onAddProject && (
        isProjectPath && onRemoveProject ? (
          <ContextMenuItem onClick={() => onRemoveProject?.(item.path)}>
            <Boxes className="h-4 w-4 mr-2" />
            Remove from Projects
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => onAddProject?.(item.path)}>
            <Boxes className="h-4 w-4 mr-2" />
            Add as Project
          </ContextMenuItem>
        )
      )}
      {onAddFavorite && (
        isFavoritePath && onRemoveFavorite ? (
          <ContextMenuItem onClick={() => onRemoveFavorite?.(item.path)}>
            <Star className="h-4 w-4 mr-2 fill-amber-400 text-amber-400" />
            Remove from Favorites
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => onAddFavorite?.(item.path, true)}>
            <Star className="h-4 w-4 mr-2" />
            Add to Favorites
          </ContextMenuItem>
        )
      )}
    </ContextMenuContent>
  )

  // Context menu for non-markdown files (greyed rows — not editable in Prose)
  const nonMarkdownContextMenu = (
    <ContextMenuContent>
      {onFileShowInFolder && (
        <ContextMenuItem onClick={() => onFileShowInFolder(item.path)}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Show in Finder
        </ContextMenuItem>
      )}
      {onOpenExternally && (
        <ContextMenuItem onClick={() => onOpenExternally(item.path)}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Open Externally
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  )

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {buttonElement}
        </ContextMenuTrigger>
        {item.isDirectory ? folderContextMenu : item.isNonMarkdown ? nonMarkdownContextMenu : fileContextMenu}
      </ContextMenu>

      {item.isDirectory && isExpanded && item.children && (
        <FileTree
          items={item.children}
          favoritePaths={favoritePaths}
          projectPaths={projectPaths}
          expandedFolders={expandedFolders}
          selectedPath={selectedPath}
          selectedPaths={selectedPaths}
          loadingFolders={loadingFolders}
          renamingPath={renamingPath}
          clipboardPath={clipboardPath}
          clipboardOperation={clipboardOperation}
          onFileClick={onFileClick}
          onFileToggleSelect={onFileToggleSelect}
          onFileRangeSelect={onFileRangeSelect}
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
          onFileDuplicate={onFileDuplicate}
          onFileTrash={onFileTrash}
          onFileOpen={onFileOpen}
          onOpenExternally={onOpenExternally}
          onRenameComplete={onRenameComplete}
          onRenameCancel={onRenameCancel}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onAddProject={onAddProject}
          onAddFavorite={onAddFavorite}
          onRemoveProject={onRemoveProject}
          onRemoveFavorite={onRemoveFavorite}
          onFileDrop={onFileDrop}
          depth={depth + 1}
        />
      )}
    </div>
  )
})
