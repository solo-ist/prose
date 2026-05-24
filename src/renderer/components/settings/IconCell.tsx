// IconCell.tsx — App icon selection cell for Settings → Appearance.
// Renders a 78px IconThumb, a label, and DEFAULT/LEGACY badges.
// Used inside a 6-column ARIA radio group grid in AppearancePane.

import { forwardRef } from 'react'
import { Check } from 'lucide-react'
import { IconThumb } from '../../lib/prose-icons'
import type { ProseIconEntry } from '../../lib/prose-icons'
import type { IconId } from '../../types'

interface IconCellProps {
  item: ProseIconEntry
  selected: boolean
  onSelect: (id: IconId) => void
  /** For ARIA radio group — keyboard handler passed from parent */
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
  tabIndex?: number
}

export const IconCell = forwardRef<HTMLButtonElement, IconCellProps>(function IconCell(
  { item, selected, onSelect, onKeyDown, tabIndex = -1 },
  ref
) {
  return (
    <button
      ref={ref}
      role="radio"
      aria-checked={selected}
      aria-label={item.name}
      tabIndex={tabIndex}
      data-radio-id={item.id}
      onClick={() => onSelect(item.id)}
      onKeyDown={onKeyDown}
      className={[
        'flex flex-col items-center gap-2 p-1 bg-transparent border-none cursor-pointer',
        'focus:outline-none transition-transform duration-150',
        selected ? '' : 'hover:-translate-y-0.5',
      ].join(' ')}
      style={{ fontFamily: '"IBM Plex Mono", monospace' }}
    >
      {/* Icon with selection ring */}
      <div
        className="relative p-[5px] rounded-[22px] transition-all duration-150"
        style={{
          background: selected ? 'hsl(var(--primary) / 0.12)' : 'transparent',
          boxShadow: selected ? '0 0 0 2px hsl(var(--primary))' : 'none',
        }}
      >
        <IconThumb Component={item.Component} size={78} />

        {/* Selection check badge */}
        {selected && (
          <div
            className="absolute -top-1.5 -right-1.5 w-[19px] h-[19px] rounded-full flex items-center justify-center"
            style={{
              background: 'hsl(var(--primary))',
              boxShadow: '0 0 0 3px hsl(var(--background))',
            }}
          >
            <Check className="w-3 h-3" style={{ color: 'hsl(var(--primary-foreground))', strokeWidth: 3 }} />
          </div>
        )}
      </div>

      {/* Label + badges */}
      <div className="text-center">
        <div
          className="text-[10.5px] font-normal tracking-tight leading-tight"
          style={{ color: selected ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
        >
          {item.name}
        </div>
        {item.official && (
          <div className="text-[8.5px] tracking-[0.16em] uppercase font-medium mt-0.5" style={{ color: 'hsl(var(--primary))' }}>
            DEFAULT
          </div>
        )}
        {item.legacy && (
          <div className="text-[8.5px] tracking-[0.16em] uppercase font-medium mt-0.5 text-muted-foreground">
            LEGACY
          </div>
        )}
      </div>
    </button>
  )
})
