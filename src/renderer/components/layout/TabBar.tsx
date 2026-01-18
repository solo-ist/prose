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
}

export function TabBar({ onTabClick, onTabClose, onTabCloseOthers, onTabCloseAll, onTabRename }: TabBarProps) {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const setTabOrder = useTabStore((state) => state.setTabOrder)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Editing state
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editedTitle, setEditedTitle] = useState('')

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
    if (!tab.path) return // Can't rename untitled files
    const fileName = tab.path.split('/').pop()?.replace(/\.[^.]+$/, '') || ''
    setEditedTitle(fileName)
    setEditingTabId(tab.id)
  }

  const handleKeyDown = async (e: KeyboardEvent, tab: Tab) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      await handleRename(tab)
    } else if (e.key === 'Escape') {
      setEditingTabId(null)
    }
  }

  const handleRename = async (tab: Tab) => {
    if (editedTitle.trim() && tab.path) {
      await onTabRename(tab.id, editedTitle.trim())
    }
    setEditingTabId(null)
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
          onClick={() => onTabClick(tab.id)}
          onMiddleClick={(e) => handleMiddleClick(e, tab.id)}
          onClose={(e) => handleCloseClick(e, tab.id)}
          onCloseOthers={() => onTabCloseOthers(tab.id)}
          onCloseAll={onTabCloseAll}
          onDoubleClick={() => handleDoubleClick(tab)}
          onEditChange={setEditedTitle}
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
  const extension = tab.path
    ? tab.path.substring(tab.path.lastIndexOf('.'))
    : '.md'

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
                    className="h-5 w-[120px] text-xs px-1 py-0"
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
