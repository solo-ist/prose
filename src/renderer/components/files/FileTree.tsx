import type { FileItem } from '../../types'
import { ChevronRight, ChevronDown, FileText, Folder } from 'lucide-react'
import { cn } from '../../lib/utils'

interface FileTreeProps {
  items: FileItem[]
  expandedFolders: Set<string>
  selectedPath: string | null
  onFileClick: (path: string) => void
  onFolderToggle: (path: string) => void
  depth?: number
}

export function FileTree({
  items,
  expandedFolders,
  selectedPath,
  onFileClick,
  onFolderToggle,
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
          onFileClick={onFileClick}
          onFolderToggle={onFolderToggle}
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
  onFileClick: (path: string) => void
  onFolderToggle: (path: string) => void
  depth: number
}

function FileTreeItem({
  item,
  expandedFolders,
  selectedPath,
  onFileClick,
  onFolderToggle,
  depth
}: FileTreeItemProps) {
  const isExpanded = expandedFolders.has(item.path)
  const isSelected = selectedPath === item.path

  const handleClick = () => {
    if (item.isDirectory) {
      onFolderToggle(item.path)
    } else {
      onFileClick(item.path)
    }
  }

  // Remove .md extension for display
  const displayName = item.isDirectory
    ? item.name
    : item.name.replace(/\.(md|markdown|txt)$/, '')

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-left transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isSelected && !item.isDirectory && 'bg-accent text-accent-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={item.path}
      >
        {item.isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        ) : (
          <>
            <span className="w-3.5" /> {/* Spacer for alignment */}
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{displayName}</span>
      </button>

      {item.isDirectory && isExpanded && item.children && (
        <FileTree
          items={item.children}
          expandedFolders={expandedFolders}
          selectedPath={selectedPath}
          onFileClick={onFileClick}
          onFolderToggle={onFolderToggle}
          depth={depth + 1}
        />
      )}
    </div>
  )
}
