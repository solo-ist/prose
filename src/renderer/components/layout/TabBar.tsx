import { useState, useRef, useEffect, useCallback, type MouseEvent, type KeyboardEvent } from 'react'
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
import type { TabTier } from '../../hooks/useTabTier'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabEmoji } from '../../hooks/useTabEmoji'
import { regenerateEmoji } from '../../lib/emojiService'
import { useSettings } from '../../hooks/useSettings'

interface TabBarProps {
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabCloseOthers: (tabId: string) => void
  onTabCloseAll: () => void
  onTabRename: (tabId: string, newTitle: string) => Promise<string | null>
  onNewFileSave: (title: string) => Promise<boolean>
  tier: TabTier
  containerWidth: number
}

// Max widths per tier
const MAX_TAB_WIDTH: Record<TabTier, number> = {
  0: 180,
  1: 160,
  2: 120,
  3: 100,
  4: 40
}

export function TabBar({ onTabClick, onTabClose, onTabCloseOthers, onTabCloseAll, onTabRename, onNewFileSave, tier, containerWidth }: TabBarProps) {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const setTabOrder = useTabStore((state) => state.setTabOrder)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Editing state
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editedTitle, setEditedTitle] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameCancelledRef = useRef(false)

  // Calculate per-tab width for tiers 1+
  const tabWidth = tier >= 1 && tabs.length > 0
    ? Math.min(
        Math.floor((containerWidth - (tabs.length - 1) * 2) / tabs.length), // account for gap
        MAX_TAB_WIDTH[tier]
      )
    : undefined

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
      className="flex items-center gap-0.5 app-region-no-drag overflow-hidden"
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          isEditing={editingTabId === tab.id}
          editedTitle={editedTitle}
          hasError={editingTabId === tab.id && renameError !== null}
          tier={editingTabId === tab.id ? Math.min(tier, 2) as TabTier : tier}
          tabWidth={tabWidth}
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
  tier: TabTier
  tabWidth: number | undefined
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
  tier,
  tabWidth,
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
  const isAutoSaving = useSettingsStore((state) => state.settings.autosave?.mode === 'auto' && state.autosaveActive) && !!tab.path
  const inputRef = useRef<HTMLInputElement>(null)

  // Emoji: always generate eagerly, display based on tab width or setting
  const { settings } = useSettings()
  const emoji = useTabEmoji(tab)
  const showEmoji = settings.llm.emojiIcons || (tabWidth !== undefined && tabWidth <= 140)

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

  const handleRegenEmoji = useCallback(() => {
    regenerateEmoji(tab)
  }, [tab])

  // Shorten path: replace /Users/<username> with ~
  const displayPath = tab.path?.replace(/^\/Users\/[^/]+/, '~') ?? null

  // Build tooltip content based on whether emoji is shown (name may be truncated/hidden)
  const tooltipContent = showEmoji
    ? (
      <div className="text-xs">
        <p className="font-medium">{tab.title}{extension}{tab.isDirty && !isAutoSaving ? ' *' : ''}</p>
        {displayPath && <p className="break-all text-muted-foreground mt-0.5">{displayPath}</p>}
      </div>
    )
    : displayPath
      ? <p className="text-xs break-all">{displayPath}</p>
      : null

  return (
    <Reorder.Item
      value={tab}
      className="min-w-0"
      style={tabWidth ? { width: tabWidth, flexShrink: 0 } : undefined}
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
                  'group flex items-center gap-1.5 py-1.5 text-sm rounded-md min-w-0 w-full',
                  'transition-[colors,width,padding,opacity] duration-200 ease-in-out',
                  'hover:bg-accent/50',
                  tier >= 4 ? 'px-1.5 justify-center' : 'px-3',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {/* Icon: emoji for tier 3+, FileText for lower tiers */}
                {showEmoji ? (
                  <span
                    className="text-base leading-none shrink-0 transition-opacity duration-200"
                    role="img"
                    aria-label="Tab icon"
                  >
                    {emoji}
                  </span>
                ) : (
                  tab.path ? (
                    <div
                      onClick={onShowInFolder}
                      className="opacity-60 hover:opacity-100 transition-opacity shrink-0 cursor-pointer"
                      title="Open in Finder"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onShowInFolder(e as unknown as MouseEvent)
                        }
                      }}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </div>
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-40" />
                  )
                )}
                {/* Text: shown for tiers < 4, hidden at tier 4 (emoji only) */}
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
                ) : tier < 4 ? (
                  <span
                    className={cn(
                      'truncate min-w-0',
                      tier === 0 ? 'max-w-[180px]' : 'flex-1'
                    )}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onDoubleClick()
                    }}
                  >
                    {tab.title}
                    {!showEmoji && <span className="text-muted-foreground">{extension}</span>}
                  </span>
                ) : null}
                {/* Dirty indicator: shown for tiers < 4, suppressed in auto-save mode */}
                {tier < 4 && tab.isDirty && !isAutoSaving && (
                  <span className="text-muted-foreground shrink-0">*</span>
                )}
                {/* Close button: shown for tiers < 4; at tier 4 use context menu or middle-click */}
                {tier < 4 && (
                  <div
                    onClick={onClose}
                    className={cn(
                      'ml-1 p-0.5 rounded hover:bg-accent shrink-0 cursor-pointer',
                      'opacity-0 group-hover:opacity-100 transition-opacity',
                      isActive && 'opacity-100'
                    )}
                    role="button"
                    tabIndex={0}
                    aria-label="Close tab"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onClose(e as unknown as MouseEvent)
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </div>
                )}
              </button>
            </TooltipTrigger>
            {tooltipContent && (
              <TooltipContent side="bottom" className="max-w-md">
                {tooltipContent}
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
          {showEmoji && (
            <>
              <ContextMenuItem onClick={handleRegenEmoji}>
                Regenerate Emoji
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={onCloseAll}>
            Close All
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </Reorder.Item>
  )
}
