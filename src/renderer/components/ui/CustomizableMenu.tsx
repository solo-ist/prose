/**
 * CustomizableMenu — a DropdownMenuContent wrapper that adds iOS-style wiggle
 * edit mode for reordering and hiding/showing menu items.
 *
 * Usage:
 *
 *   const items: CustomizableMenuItem[] = [
 *     { id: 'new-file', label: 'New Document', icon: <FilePlus />, onSelect: handleNewFile },
 *     { id: 'separator-1', separatorBefore: true },
 *     { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: openSettings },
 *   ]
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild>...</DropdownMenuTrigger>
 *     <CustomizableMenu
 *       menuId="toolbar-more"
 *       items={items}
 *       align="end"
 *     />
 *   </DropdownMenu>
 *
 * Notes:
 *   - separatorBefore: true on an item renders a separator above it in the normal view.
 *   - Pinned items (pinned: true) always appear at the bottom above "Customize…"
 *     and cannot be hidden or reordered.
 *   - The "Customize…" trigger is appended at the very bottom, below pinned items.
 *   - In edit mode, regular <button> elements are used so Radix does not auto-close
 *     the menu on interaction. "Done" is a DropdownMenuItem which closes normally.
 */

import { useState, useCallback, Fragment } from 'react'
import type { ReactNode } from 'react'
import { Eye, EyeOff, ChevronUp, ChevronDown, SlidersHorizontal, Check, GripVertical } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './dropdown-menu'
import { cn } from '../../lib/utils'
import { useMenuCustomization } from '../../hooks/useMenuCustomization'
import type { MenuItemDescriptor } from '../../hooks/useMenuCustomization'

export interface CustomizableMenuItem {
  /** Stable, unique ID. Required for all items. */
  id: string
  label?: string
  /** Icon element (16×16 recommended, pass raw JSX) */
  icon?: ReactNode
  /** When true, renders a separator above this item in the normal (non-edit) view. */
  separatorBefore?: boolean
  /** Callback on selection (normal mode only; not called in edit mode) */
  onSelect?: () => void
  /**
   * Pinned items appear at the bottom (above "Customize…") and cannot be
   * hidden or reordered. Use for structural items like "Close".
   */
  pinned?: boolean
  /** When true, the item is rendered disabled. */
  disabled?: boolean
}

interface Props {
  menuId: string
  items: CustomizableMenuItem[]
  /** Forwarded to DropdownMenuContent */
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function CustomizableMenu({ menuId, items, align = 'end', className }: Props) {
  const [isEditing, setIsEditing] = useState(false)

  // Separate pinned from customizable
  const pinnedItems = items.filter((i) => i.pinned)
  const customizableItems = items.filter((i) => !i.pinned)

  const descriptors: MenuItemDescriptor[] = customizableItems.map((i) => ({
    id: i.id,
    label: i.label ?? i.id,
  }))

  const { visibleIds, hiddenIds, orderedAllIds, toggleHidden, moveUp, moveDown, save } =
    useMenuCustomization(menuId, descriptors)

  const itemById = new Map(customizableItems.map((i) => [i.id, i]))

  const enterEdit = useCallback((e: Event) => {
    // Prevent Radix from closing the dropdown when "Customize…" is selected
    e.preventDefault()
    setIsEditing(true)
  }, [])

  // --- Drag-to-reorder (edit mode) ---
  // Native HTML5 DnD over the wiggle rows; the up/down chevrons remain as the
  // keyboard-accessible reorder path. Dropping a row onto another moves it to
  // that row's slot, pushing the rest down.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const handleDrop = useCallback(
    (targetId: string) => {
      setDragOverId(null)
      const sourceId = draggingId
      setDraggingId(null)
      if (!sourceId || sourceId === targetId) return
      const next = orderedAllIds.filter((x) => x !== sourceId)
      const targetIdx = next.indexOf(targetId)
      if (targetIdx === -1) return
      next.splice(targetIdx, 0, sourceId)
      save(next, hiddenIds)
    },
    [draggingId, orderedAllIds, hiddenIds, save]
  )

  // --- Edit mode ---
  if (isEditing) {
    return (
      <DropdownMenuContent
        align={align}
        className={cn('w-56', className)}
        // Prevent closing when the user clicks inside (on the edit buttons)
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={() => setIsEditing(false)}
        onEscapeKeyDown={() => setIsEditing(false)}
      >
        <div className="px-1 py-0.5 text-xs font-medium text-muted-foreground select-none mb-1">
          Customize menu
        </div>

        {orderedAllIds.map((id, idx) => {
          const item = itemById.get(id)
          if (!item) return null
          const isHidden = hiddenIds.includes(id)
          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => {
                setDraggingId(id)
                e.dataTransfer.effectAllowed = 'move'
                // Firefox requires data to be set for a drag to initiate.
                e.dataTransfer.setData('text/plain', id)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dragOverId !== id) setDragOverId(id)
              }}
              onDrop={(e) => { e.preventDefault(); handleDrop(id) }}
              onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
              className={cn(
                'flex items-center gap-1 px-1 py-0.5 rounded-sm cursor-grab active:cursor-grabbing',
                isHidden && 'opacity-40',
                draggingId === id && 'opacity-30',
                dragOverId === id && draggingId !== id && 'ring-1 ring-primary/50 bg-accent/60'
              )}
            >
              {/* Drag handle cue — the whole row is draggable */}
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />

              {/* Up / down reorder buttons (keyboard-accessible reorder) */}
              <div className="flex flex-col shrink-0 gap-0">
                <button
                  type="button"
                  className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25 focus:outline-hidden"
                  onClick={(e) => { e.stopPropagation(); moveUp(id) }}
                  disabled={idx === 0}
                  aria-label={`Move ${item.label} up`}
                  tabIndex={-1}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25 focus:outline-hidden"
                  onClick={(e) => { e.stopPropagation(); moveDown(id) }}
                  disabled={idx === orderedAllIds.length - 1}
                  aria-label={`Move ${item.label} down`}
                  tabIndex={-1}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              {/* Item icon + label — wiggle in edit mode */}
              <div className="flex flex-1 items-center gap-2 px-1 py-1 text-sm rounded-sm animate-wiggle select-none">
                {item.icon && (
                  <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0 text-muted-foreground">
                    {item.icon}
                  </span>
                )}
                <span className="truncate">{item.label}</span>
              </div>

              {/* Eye toggle */}
              <button
                type="button"
                className="shrink-0 h-6 w-6 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-hidden"
                onClick={(e) => { e.stopPropagation(); toggleHidden(id) }}
                aria-label={isHidden ? `Show ${item.label}` : `Hide ${item.label}`}
                aria-pressed={isHidden}
                tabIndex={-1}
              >
                {isHidden
                  ? <EyeOff className="h-3.5 w-3.5" />
                  : <Eye className="h-3.5 w-3.5" />
                }
              </button>
            </div>
          )
        })}

        {/* Pinned items shown greyed out (not customizable) */}
        {pinnedItems.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {pinnedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground/50 select-none"
              >
                {item.icon && (
                  <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0">{item.icon}</span>
                )}
                <span className="truncate">{item.label}</span>
              </div>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        {/* Done closes the menu via Radix's natural onSelect behaviour */}
        <DropdownMenuItem
          className="cursor-pointer font-medium"
          onSelect={() => setIsEditing(false)}
        >
          <Check className="mr-2 h-4 w-4" />
          Done
        </DropdownMenuItem>
      </DropdownMenuContent>
    )
  }

  // --- Normal mode ---
  const visibleItems = visibleIds
    .map((id) => itemById.get(id))
    .filter((i): i is CustomizableMenuItem => !!i)

  return (
    <DropdownMenuContent align={align} className={className}>
      {visibleItems.map((item, idx) => (
        <Fragment key={item.id}>
          {item.separatorBefore && idx > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onClick={item.onSelect}
            disabled={item.disabled}
            className="cursor-pointer"
          >
            {item.icon && (
              <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0">{item.icon}</span>
            )}
            {item.label}
          </DropdownMenuItem>
        </Fragment>
      ))}

      {/* Pinned items at the bottom, separated */}
      {pinnedItems.length > 0 && visibleItems.length > 0 && <DropdownMenuSeparator />}
      {pinnedItems.map((item) => (
        <DropdownMenuItem
          key={item.id}
          onClick={item.onSelect}
          disabled={item.disabled}
          className="cursor-pointer"
        >
          {item.icon && (
            <span className="[&_svg]:h-4 [&_svg]:w-4 shrink-0">{item.icon}</span>
          )}
          {item.label}
        </DropdownMenuItem>
      ))}

      {/* Customize trigger — always last */}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="cursor-pointer text-muted-foreground"
        onSelect={enterEdit}
      >
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        Customize…
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
