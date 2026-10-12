/**
 * CustomizableToolbar — a unified, customizable toolbar action group where the
 * top-level icon buttons AND the "⋯" overflow menu are ONE list the user
 * partitions themselves (#701, iOS-springboard model).
 *
 * The split between "on the bar" and "in the ⋯ menu" is a user-positioned
 * BOUNDARY (persisted as `barCount`), not a fixed width capacity — the user
 * decides how many and which items live on the bar by dragging items (or the
 * boundary itself) across the line in Customize mode.
 *
 * Each action keeps its bespoke, stateful bar rendering via an optional
 * `renderBar` closure; actions without one fall back to a standard icon button.
 *
 * Special placements:
 *  - `pinnedBar` actions (e.g. "Show chat") are fixed on the bar's right edge,
 *    directly left of the ⋯ trigger — never reordered, hidden, or overflowed.
 *  - `pinned` actions (e.g. "Close") live at the bottom of the ⋯ menu and are
 *    never placed on the bar.
 *
 * Persistence is shared via useMenuCustomization (settings.menuCustomization).
 */

import { useState, useRef, useCallback, Fragment, type ReactNode } from 'react'
import {
  Eye,
  EyeOff,
  SlidersHorizontal,
  Check,
  GripVertical,
  MoreHorizontal,
  Lock,
} from 'lucide-react'
import { Button } from './button'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './dropdown-menu'
import { cn } from '../../lib/utils'
import { useMenuCustomization } from '../../hooks/useMenuCustomization'
import type { MenuItemDescriptor } from '../../hooks/useMenuCustomization'

export interface ToolbarAction {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  active?: boolean
  disabled?: boolean
  /** When false the action is excluded entirely (e.g. a gated feature off). Default true. */
  available?: boolean
  /** Custom bar rendering for bespoke buttons; falls back to a standard icon button. */
  renderBar?: (key: string) => ReactNode
  /** Fixed on the bar's right edge, directly left of ⋯. Not reorderable/hideable. */
  pinnedBar?: boolean
  /** Fixed at the bottom of the ⋯ menu; never on the bar. */
  pinned?: boolean
}

interface Props {
  menuId: string
  actions: ToolbarAction[]
  /** Boundary position used when the user hasn't customized it yet. */
  defaultBarCount: number
  /**
   * Optional hard cap on bar items (e.g. a width-derived budget). The user's
   * boundary is clamped down to this so a narrow container auto-collapses extra
   * items into ⋯; the user can still go below it. Omit for no cap.
   */
  maxBarCap?: number
  /** Heading shown atop the Customize list. Omit for none. */
  customizeTitle?: string
  /** Label on the bar/menu boundary divider. Omit for a plain divider line. */
  boundaryLabel?: string
  /** Smaller 32px bar buttons + ⋯ trigger (e.g. the file-explorer header). */
  compact?: boolean
  align?: 'start' | 'center' | 'end'
}

const BOUNDARY = '__boundary__'

export function CustomizableToolbar({ menuId, actions, defaultBarCount, maxBarCap, customizeTitle, boundaryLabel, compact, align = 'end' }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  // State drives the insertion-line + drag-opacity rendering; refs hold the same
  // values for the drop handler so a fast drop reads them synchronously instead
  // of from a not-yet-flushed render closure (the "doesn't stick" flakiness).
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const draggingKeyRef = useRef<string | null>(null)
  const dropIndexRef = useRef<number | null>(null)

  const present = actions.filter((a) => a.available !== false)
  const pinnedBarItems = present.filter((a) => a.pinnedBar)
  const pinnedMenuItems = present.filter((a) => a.pinned && !a.pinnedBar)
  const customizable = present.filter((a) => !a.pinnedBar && !a.pinned)

  const descriptors: MenuItemDescriptor[] = customizable.map((a) => ({ id: a.id, label: a.label }))
  const { visibleIds, hiddenIds, orderedAllIds, toggleHidden, save, barCount } =
    useMenuCustomization(menuId, descriptors)

  const actionById = new Map(customizable.map((a) => [a.id, a]))
  const isVisible = (id: string) => !hiddenIds.includes(id)

  // The user-positioned boundary: items at order positions [0, boundary) sit on
  // the bar (if visible); the rest go to the ⋯ menu. A maxBarCap (e.g. a
  // width-derived budget) clamps it down so a narrow container auto-collapses.
  const cap = maxBarCap ?? Infinity
  const boundary = Math.max(0, Math.min(orderedAllIds.length, cap, barCount ?? defaultBarCount))
  const barCustomizable = orderedAllIds.slice(0, boundary).filter(isVisible)
  const menuCustomizable = orderedAllIds.slice(boundary).filter(isVisible)

  // Combined edit sequence: every customizable item plus the boundary sentinel.
  const combined = [...orderedAllIds]
  combined.splice(boundary, 0, BOUNDARY)

  const clearDrag = useCallback(() => {
    draggingKeyRef.current = null
    dropIndexRef.current = null
    setDraggingKey(null)
    setDropIndex(null)
  }, [])

  const beginDrag = useCallback((key: string, e: React.DragEvent) => {
    draggingKeyRef.current = key
    dropIndexRef.current = null
    setDraggingKey(key)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }, [])

  const performDrop = useCallback(() => {
    const key = draggingKeyRef.current
    const idx = dropIndexRef.current
    clearDrag()
    if (key == null || idx == null) return
    const fromIdx = combined.indexOf(key)
    if (fromIdx === -1) return
    const without = combined.filter((k) => k !== key)
    let target = idx
    if (fromIdx < idx) target -= 1
    target = Math.max(0, Math.min(without.length, target))
    without.splice(target, 0, key)
    const newBarCount = without.indexOf(BOUNDARY)
    const newOrder = without.filter((k) => k !== BOUNDARY)
    save(newOrder, hiddenIds, newBarCount)
  }, [combined, hiddenIds, save, clearDrag])

  const onRowDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const insertion = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1
    dropIndexRef.current = insertion
    setDropIndex((prev) => (prev === insertion ? prev : insertion))
  }, [])

  const enterEdit = useCallback((e: Event) => {
    e.preventDefault()
    setIsEditing(true)
  }, [])

  function renderBarButton(a: ToolbarAction): ReactNode {
    if (a.renderBar) return a.renderBar(a.id)
    return (
      <Tooltip key={a.id}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={a.onSelect}
            disabled={a.disabled}
            aria-label={a.label}
            aria-pressed={a.active}
            className={cn(compact && 'h-8 w-8', a.active && 'bg-accent text-accent-foreground')}
          >
            <span className="[&_svg]:h-4 [&_svg]:w-4 flex items-center justify-center">{a.icon}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{a.label}</TooltipContent>
      </Tooltip>
    )
  }

  const insertionLine = <div className="h-0.5 bg-primary rounded-full mx-1 my-0.5" />

  return (
    <div className="flex items-center gap-1">
      {/* Bar buttons — dimmed + inert while the Customize menu is open */}
      <div className={cn('flex items-center gap-1', isEditing && 'opacity-40 pointer-events-none')}>
        {barCustomizable.map((id) => {
          const a = actionById.get(id)
          return a ? <span key={id}>{renderBarButton(a)}</span> : null
        })}
        {/* Pinned-to-bar buttons (e.g. chat), fixed directly left of ⋯ */}
        {pinnedBarItems.map((a) => (
          <span key={a.id}>{renderBarButton(a)}</span>
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More options" className={compact ? 'h-8 w-8' : undefined}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>

        {isEditing ? (
          <DropdownMenuContent
            align={align}
            className="w-64"
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={() => setIsEditing(false)}
            onEscapeKeyDown={() => setIsEditing(false)}
            onDrop={(e) => { e.preventDefault(); performDrop() }}
          >
            {customizeTitle && (
              <div className="px-1 py-0.5 text-xs font-medium text-muted-foreground select-none mb-1">
                {customizeTitle}
              </div>
            )}

            {combined.map((key, idx) => {
              if (key === BOUNDARY) {
                return (
                  <Fragment key={BOUNDARY}>
                    {dropIndex === idx && insertionLine}
                    {/* Pinned-to-bar items shown at the end of the bar (above the line) */}
                    {pinnedBarItems.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-1 px-1 py-1 rounded-sm opacity-60 select-none"
                      >
                        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0 text-muted-foreground">{a.icon}</span>
                        <span className="flex-1 truncate text-sm">{a.label}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">pinned</span>
                      </div>
                    ))}
                    {/* The draggable boundary divider */}
                    <div
                      draggable
                      onDragStart={(e) => beginDrag(BOUNDARY, e)}
                      onDragOver={(e) => onRowDragOver(e, idx)}
                      onDrop={(e) => { e.preventDefault(); performDrop() }}
                      onDragEnd={clearDrag}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1 my-0.5 cursor-grab active:cursor-grabbing select-none',
                        draggingKey === BOUNDARY && 'opacity-40'
                      )}
                    >
                      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      {boundaryLabel ? (
                        <>
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {boundaryLabel}
                          </span>
                          <div className="h-px flex-1 bg-border" />
                        </>
                      ) : (
                        <div className="h-px flex-1 bg-border" />
                      )}
                    </div>
                  </Fragment>
                )
              }

              const a = actionById.get(key)
              if (!a) return null
              const hidden = hiddenIds.includes(key)
              return (
                <Fragment key={key}>
                  {dropIndex === idx && insertionLine}
                  <div
                    draggable
                    onDragStart={(e) => beginDrag(key, e)}
                    onDragOver={(e) => onRowDragOver(e, idx)}
                    onDrop={(e) => { e.preventDefault(); performDrop() }}
                    onDragEnd={clearDrag}
                    className={cn(
                      'flex items-center gap-2 px-1 py-1 rounded-sm cursor-grab active:cursor-grabbing',
                      hidden && 'opacity-40',
                      draggingKey === key && 'opacity-30'
                    )}
                  >
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0 text-muted-foreground">{a.icon}</span>
                    <span className="flex-1 truncate text-sm animate-wiggle select-none">{a.label}</span>
                    <button
                      type="button"
                      className="shrink-0 h-6 w-6 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-hidden"
                      onClick={(e) => { e.stopPropagation(); toggleHidden(key) }}
                      aria-label={hidden ? `Show ${a.label}` : `Hide ${a.label}`}
                      aria-pressed={hidden}
                    >
                      {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </Fragment>
              )
            })}
            {dropIndex === combined.length && insertionLine}

            {pinnedMenuItems.length > 0 && (
              <>
                <DropdownMenuSeparator />
                {pinnedMenuItems.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground/50 select-none"
                  >
                    <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0">{a.icon}</span>
                    <span className="truncate">{a.label}</span>
                  </div>
                ))}
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer font-medium" onSelect={() => setIsEditing(false)}>
              <Check className="mr-2 h-4 w-4" />
              Done
            </DropdownMenuItem>
          </DropdownMenuContent>
        ) : (
          <DropdownMenuContent align={align}>
            {menuCustomizable.map((id) => {
              const a = actionById.get(id)
              if (!a) return null
              return (
                <DropdownMenuItem
                  key={id}
                  onClick={a.onSelect}
                  disabled={a.disabled}
                  className="cursor-pointer"
                >
                  <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0">{a.icon}</span>
                  <span className="flex-1">{a.label}</span>
                  {a.active && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                </DropdownMenuItem>
              )
            })}

            {pinnedMenuItems.length > 0 && menuCustomizable.length > 0 && <DropdownMenuSeparator />}
            {pinnedMenuItems.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onClick={a.onSelect}
                disabled={a.disabled}
                className="cursor-pointer"
              >
                <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0">{a.icon}</span>
                {a.label}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer text-muted-foreground" onSelect={enterEdit}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Customize…
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </div>
  )
}
