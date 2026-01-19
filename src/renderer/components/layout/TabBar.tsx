import { useState, useRef, useEffect, type MouseEvent, type KeyboardEvent } from 'react'
import { Reorder } from 'framer-motion'
import { X, FileText } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { Input } from '../ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../ui/tooltip'

interface TabBarProps {
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabCloseOthers: (tabId: string) => void
  onTabCloseAll: () => void
  onTabRename: (tabId: string, newTitle: string) => Promise<string | null>
  onNewFileSave: (title: string) => Promise<boolean>
}

export function TabBar({ onTabClick, onTabClose, onTabCloseOthers, onTabCloseAll, onTabRename, onNewFileSave }: TabBarProps) {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const setTabOrder = useTabStore((state) => state.setTabOrder)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Editing state
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editedTitle, setEditedTitle] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameCancelledRef = useRef(false)

  const handleMiddleClick = (e: MouseEvent, tabId: string) => {
    // Middle mouse button
    if (e.button === 1) {
      e.preventDefault()
      onTabClose(tabId)
    }
  }

  const handleCloseClick = (e: MouseEvent, tabId: string) => {
    e.stopPropagation()
    onTabClose(tabId)
  }

  const handleDoubleClick = (tab: Tab) => {
    // For untitled files, start with empty title; for existing files, extract filename without extension
    const fileName = tab.path
      ? tab.path.split('/').pop()?.replace(/\.[^.]+$/, '') || ''
      : ''
    setEditedTitle(fileName)
    setEditingTabId(tab.id)
    setRenameError(null)
    renameCancelledRef.current = false
  }

  const handleKeyDown = async (e: KeyboardEvent, tab: Tab) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      await handleRename(tab)
    } else if (e.key === 'Escape') {
      renameCancelledRef.current = true
      setEditingTabId(null)
    }
  }

  const handleRename = async (tab: Tab) => {
    // Skip if rename was cancelled (Escape pressed)
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      return
    }
    const trimmed = editedTitle.trim()
    if (trimmed) {
      let success: boolean
      if (tab.path) {
        // Rename existing file
        const result = await onTabRename(tab.id, trimmed)
        success = result !== null
      } else {
        // Save new file with title
        success = await onNewFileSave(trimmed)
      }
      if (!success) {
        // Operation failed - show error and keep input open
        setRenameError(tab.path ? 'Could not rename file' : 'Could not save file')
        return
      }
    }
    setEditingTabId(null)
    setRenameError(null)
  }

  const handleShowInFolder = (e: MouseEvent, path: string) => {
    e.stopPropagation()
    window.api?.showInFolder(path)
  }

  if (tabs.length === 0) {
    return null
  }

  return (
    <Reorder.Group
      ref={scrollContainerRef}
      axis="x"
      values={tabs}
      onReorder={setTabOrder}
      className="flex items-center gap-0.5"
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          isEditing={editingTabId === tab.id}
          editedTitle={editedTitle}
          hasError={editingTabId === tab.id && renameError !== null}
          onClick={() => onTabClick(tab.id)}
          onMiddleClick={(e) => handleMiddleClick(e, tab.id)}
          onClose={(e) => handleCloseClick(e, tab.id)}
          onCloseOthers={() => onTabCloseOthers(tab.id)}
          onCloseAll={onTabCloseAll}
          onDoubleClick={() => handleDoubleClick(tab)}
          onEditChange={(value) => {
            setEditedTitle(value)
            setRenameError(null) // Clear error on edit
          }}
          onEditKeyDown={(e) => handleKeyDown(e, tab)}
          onEditBlur={() => handleRename(tab)}
          onShowInFolder={(e) => tab.path && handleShowInFolder(e, tab.path)}
        />
      ))}
    </Reorder.Group>
  )
}

interface TabItemProps {
  tab: Tab
  isActive: boolean
  isEditing: boolean
  editedTitle: string
  hasError: boolean
  onClick: () => void
  onMiddleClick: (e: MouseEvent) => void
  onClose: (e: MouseEvent) => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onDoubleClick: () => void
  onEditChange: (value: string) => void
  onEditKeyDown: (e: KeyboardEvent) => void
  onEditBlur: () => void
  onShowInFolder: (e: MouseEvent) => void
}

function TabItem({
  tab,
  isActive,
  isEditing,
  editedTitle,
  hasError,
  onClick,
  onMiddleClick,
  onClose,
  onCloseOthers,
  onCloseAll,
  onDoubleClick,
  onEditChange,
  onEditKeyDown,
  onEditBlur,
  onShowInFolder
}: TabItemProps) {
  const tabs = useTabStore((state) => state.tabs)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Extract file extension if path exists
  const lastDot = tab.path ? tab.path.lastIndexOf('.') : -1
  const extension = lastDot > 0 ? tab.path!.substring(lastDot) : ''

  return (
    <Reorder.Item
      value={tab}
      className="shrink-0"
      whileDrag={{ scale: 1.02, opacity: 0.8 }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onClick}
                onMouseDown={onMiddleClick}
                className={cn(
                  'group flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors min-w-0',
                  'hover:bg-accent/50',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {tab.path ? (
                  <button
                    onClick={onShowInFolder}
                    className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
                    title="Open in Finder"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 opacity-40" />
                )}
                {isEditing ? (
                  <Input
                    ref={inputRef}
                    value={editedTitle}
                    onChange={(e) => onEditChange(e.target.value)}
                    onKeyDown={onEditKeyDown}
                    onBlur={onEditBlur}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      'h-5 w-[120px] text-xs px-1 py-0',
                      hasError && 'border-destructive focus-visible:ring-destructive'
                    )}
                  />
                ) : (
                  <span
                    className="truncate w-[120px]"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onDoubleClick()
                    }}
                  >
                    {tab.title}
                    <span className="text-muted-foreground">{extension}</span>
                  </span>
                )}
                {tab.isDirty && (
                  <span className="text-muted-foreground shrink-0">*</span>
                )}
                <button
                  onClick={onClose}
                  className={cn(
                    'ml-1 p-0.5 rounded hover:bg-accent shrink-0',
                    'opacity-0 group-hover:opacity-100 transition-opacity',
                    isActive && 'opacity-100'
                  )}
                  aria-label="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              </button>
            </TooltipTrigger>
            {tab.path && (
              <TooltipContent side="bottom" className="max-w-md">
                <p className="text-xs break-all">{tab.path}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onClose}>
            Close
          </ContextMenuItem>
          <ContextMenuItem
            onClick={onCloseOthers}
            disabled={tabs.length <= 1}
          >
            Close Others
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onCloseAll}>
            Close All
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </Reorder.Item>
  )
}
