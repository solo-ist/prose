// ThemeCard.tsx — Color theme selection card for Settings → Appearance.
// The nested theme-scoped wrapper applies `theme-{id}` + effective `dark` class
// so the preview tile renders in ITS OWN theme even when the surrounding pane
// uses a different theme.

import { forwardRef } from 'react'
import { Check } from 'lucide-react'
import type { ColorTheme } from '../../types'

export interface ThemeCardEntry {
  id: ColorTheme
  name: string
  subtitle: string
  tag: string
  official?: boolean
}

export const THEMES: ThemeCardEntry[] = [
  { id: 'mono',  name: 'Mono',  subtitle: 'shadcn neutral',  tag: 'LEGACY 1.0' },
  { id: 'prose', name: 'Prose', subtitle: 'paper + gold',    tag: 'DEFAULT', official: true },
  { id: 'termy', name: 'Termy', subtitle: 'phosphor green',  tag: 'DEEP CUT' },
]

export const DEFAULT_COLOR: ColorTheme = 'prose'

interface ThemeCardProps {
  theme: ThemeCardEntry
  selected: boolean
  /** Effective mode ('light' | 'dark') used for the nested preview tile. */
  effectiveMode: 'light' | 'dark'
  onSelect: (id: ColorTheme) => void
  /** For ARIA radio group — keyboard handler passed from parent */
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
  tabIndex?: number
}

export const ThemeCard = forwardRef<HTMLButtonElement, ThemeCardProps>(function ThemeCard(
  { theme, selected, effectiveMode, onSelect, onKeyDown, tabIndex = -1 },
  ref
) {
  // Build the class list for the nested preview wrapper.
  // Mono has no dedicated class — :root defaults apply naturally.
  const previewClasses: string[] = []
  if (theme.id === 'prose') previewClasses.push('theme-prose')
  if (theme.id === 'termy') previewClasses.push('theme-termy')
  if (effectiveMode === 'dark') previewClasses.push('dark')

  return (
    <button
      ref={ref}
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      data-radio-id={theme.id}
      onClick={() => onSelect(theme.id)}
      onKeyDown={onKeyDown}
      className={[
        'relative text-left rounded-[10px] p-3 cursor-pointer transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        selected
          ? 'bg-accent/10 border border-primary shadow-sm'
          : 'bg-transparent border border-border hover:-translate-y-0.5',
      ].join(' ')}
      style={{ fontFamily: '"IBM Plex Mono", monospace' }}
    >
      {/* Nested theme-scoped preview tile */}
      <div
        className={previewClasses.join(' ')}
        style={{
          height: 78,
          background: 'var(--background)',
          borderRadius: 6,
          border: '1px solid hsl(var(--border))',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          overflow: 'hidden',
        }}
      >
        {/* Mini titlebar traffic lights */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 2 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff5f57', opacity: 0.7 }} />
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#febc2e', opacity: 0.7 }} />
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#28c840', opacity: 0.7 }} />
        </div>
        <div style={{ height: 5, width: '80%', background: 'hsl(var(--foreground))', borderRadius: 1, opacity: 0.85 }} />
        <div style={{ height: 4, width: '60%', background: 'hsl(var(--muted-foreground))', borderRadius: 1 }} />
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 'auto' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'hsl(var(--primary))' }} />
          <div style={{ height: 3, width: 28, background: 'hsl(var(--muted-foreground))', borderRadius: 1 }} />
          <div style={{ height: 3, width: 16, background: 'hsl(var(--muted-foreground))', borderRadius: 1, opacity: 0.5 }} />
        </div>
      </div>

      {/* Label row */}
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="text-[13px] font-normal text-foreground tracking-tight">{theme.name}</span>
        <span className="text-[10.5px] text-muted-foreground">{theme.subtitle}</span>
      </div>

      {theme.tag && (
        <div
          className="mt-1 text-[8.5px] tracking-[0.16em] uppercase font-medium"
          style={{ color: theme.official ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
        >
          {theme.tag}
        </div>
      )}

      {/* Selection check dot */}
      {selected && (
        <div
          className="absolute top-2.5 right-2.5 w-[18px] h-[18px] rounded-full flex items-center justify-center"
          style={{ background: 'hsl(var(--primary))', boxShadow: '0 0 0 2px hsl(var(--background))' }}
        >
          <Check className="w-3 h-3" style={{ color: 'hsl(var(--primary-foreground))', strokeWidth: 3 }} />
        </div>
      )}
    </button>
  )
})
