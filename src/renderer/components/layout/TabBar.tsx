import { useRef, type MouseEvent } from 'react'
import { X, FileText } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useTabStore, type Tab } from '../../stores/tabStore'
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
}

export function TabBar({ onTabClick, onTabClose, onTabCloseOthers, onTabCloseAll }: TabBarProps) {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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

  if (tabs.length === 0) {
    return null
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex items-center gap-0.5 overflow-x-auto scrollbar-none"
      style={{ maxWidth: 'calc(100vw - 400px)' }}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => onTabClick(tab.id)}
          onMiddleClick={(e) => handleMiddleClick(e, tab.id)}
          onClose={(e) => handleCloseClick(e, tab.id)}
          onCloseOthers={() => onTabCloseOthers(tab.id)}
          onCloseAll={onTabCloseAll}
        />
      ))}
    </div>
  )
}

interface TabItemProps {
  tab: Tab
  isActive: boolean
  onClick: () => void
  onMiddleClick: (e: MouseEvent) => void
  onClose: (e: MouseEvent) => void
  onCloseOthers: () => void
  onCloseAll: () => void
}

function TabItem({
  tab,
  isActive,
  onClick,
  onMiddleClick,
  onClose,
  onCloseOthers,
  onCloseAll
}: TabItemProps) {
  const tabs = useTabStore((state) => state.tabs)

  // Extract file extension if path exists
  const extension = tab.path
    ? tab.path.substring(tab.path.lastIndexOf('.'))
    : '.md'

  return (
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
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[120px]">
                {tab.title}
                <span className="text-muted-foreground">{extension}</span>
              </span>
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
  )
}
