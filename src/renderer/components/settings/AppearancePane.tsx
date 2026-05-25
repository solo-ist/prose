// AppearancePane.tsx — Settings → Appearance pane (#504, #499 PR 2).
// Three sections: Mode (segmented), Color (3 ThemeCards), App Icon (11 IconCells).
// All three sections implement ARIA radio group semantics with full keyboard nav.

import { useRef, useCallback } from 'react'
import { Sun, Moon, Monitor, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { ThemeCard, THEMES, DEFAULT_COLOR } from './ThemeCard'
import { IconCell } from './IconCell'
import { PROSE_ICONS } from '../../lib/prose-icons'
import type { ColorTheme, ThemeMode, IconId } from '../../types'
import type { Appearance } from '../../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const MODES: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { id: 'light',  label: 'Light',  Icon: Sun },
  { id: 'dark',   label: 'Dark',   Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
]

// Must match FRESH_INSTALL_APPEARANCE in settingsStore (mono / system / pilcrow)
// so "Reset all to default" and the at-defaults check agree with fresh installs.
const DEFAULT_MODE: ThemeMode = 'system'
const DEFAULT_ICON: IconId = 'pilcrow'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Make an arrow-key radio-group keyboard handler for a list of items.
 *  `selected` is the currently-selected value in the group. */
function makeRadioKeyHandler<T extends string>(
  items: T[],
  selected: T,
  onSelect: (id: T) => void,
): React.KeyboardEventHandler<HTMLElement> {
  return (e) => {
    const idx = items.indexOf(selected)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      onSelect(items[(idx + 1) % items.length])
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      onSelect(items[(idx - 1 + items.length) % items.length])
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      // The focused button's id is stored in aria-checked; use e.currentTarget
      // to read the id of the focused item. Skip if it's already selected.
      const focusedId = (e.currentTarget as HTMLElement).dataset.radioId as T | undefined
      if (focusedId === undefined || focusedId === selected) return
      onSelect(focusedId)
    }
  }
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span
        className="text-[10px] tracking-[0.18em] uppercase font-normal text-muted-foreground"
        style={{ fontFamily: '"IBM Plex Mono", monospace' }}
      >
        {children}
      </span>
      <div className="h-px flex-1 max-w-[200px] bg-border" />
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AppearancePaneProps {
  appearance: Appearance
  effectiveMode: 'light' | 'dark'
  onAppearanceChange: (patch: Partial<Appearance>) => void
}

// ── Pane ──────────────────────────────────────────────────────────────────────

export function AppearancePane({ appearance, effectiveMode, onAppearanceChange }: AppearancePaneProps) {
  const { color, mode, icon } = appearance
  // Capitalized for display (e.g. "System · Light", matching the mode labels).
  const effectiveModeLabel = effectiveMode === 'dark' ? 'Dark' : 'Light'

  const isAllDefault =
    color === DEFAULT_COLOR &&
    mode === DEFAULT_MODE &&
    icon === DEFAULT_ICON

  const currentTheme = THEMES.find((t) => t.id === color) ?? THEMES[0]
  const currentIcon = PROSE_ICONS.find((i) => i.id === icon) ?? PROSE_ICONS[0]

  // ── Refs for focus management after arrow-key selection ──────────────────
  const modeButtonRefs = useRef<Map<ThemeMode, HTMLButtonElement | null>>(new Map())
  const themeButtonRefs = useRef<Map<ColorTheme, HTMLButtonElement | null>>(new Map())
  const iconButtonRefs = useRef<Map<IconId, HTMLButtonElement | null>>(new Map())

  // ── Selection handlers with focus follow ──────────────────────────────────
  const handleModeSelect = useCallback((id: ThemeMode) => {
    onAppearanceChange({ mode: id })
    // Focus the newly selected button after state update
    requestAnimationFrame(() => modeButtonRefs.current.get(id)?.focus())
  }, [onAppearanceChange])

  const handleColorSelect = useCallback((id: ColorTheme) => {
    onAppearanceChange({ color: id })
    requestAnimationFrame(() => themeButtonRefs.current.get(id)?.focus())
  }, [onAppearanceChange])

  const handleIconSelect = useCallback((id: IconId) => {
    onAppearanceChange({ icon: id })
    requestAnimationFrame(() => iconButtonRefs.current.get(id)?.focus())
  }, [onAppearanceChange])

  // ── Arrow-key handlers per group ──────────────────────────────────────────
  const modeIds = MODES.map((m) => m.id)
  const colorIds = THEMES.map((t) => t.id)
  const iconIds = PROSE_ICONS.map((i) => i.id)

  const modeKeyHandler = makeRadioKeyHandler(modeIds, mode, handleModeSelect)
  const colorKeyHandler = makeRadioKeyHandler(colorIds, color, handleColorSelect)
  const iconKeyHandler = makeRadioKeyHandler(iconIds, icon, handleIconSelect)

  return (
    <div
      className="flex-1 overflow-auto bg-background text-foreground"
      style={{ padding: '22px 28px', fontFamily: '"IBM Plex Mono", monospace' }}
    >
      {/* Page title + current state summary */}
      <div className="flex items-baseline justify-between mb-5">
        <h1
          className="text-[19px] font-normal tracking-tight text-foreground"
          style={{ fontFamily: '"IBM Plex Mono", monospace' }}
        >
          Appearance
        </h1>
        <div className="text-[10.5px] text-muted-foreground tracking-[0.04em]">
          <span className="text-foreground">{currentTheme.name}</span>
          <span className="mx-1.5">·</span>
          <span>
            {mode === 'system' ? `System · ${effectiveModeLabel}` : effectiveModeLabel}
          </span>
          <span className="mx-1.5">·</span>
          <span className="text-foreground">{currentIcon.name}</span>
        </div>
      </div>

      {/* ── MODE ── */}
      <SectionLabel>Mode</SectionLabel>
      <div className="mb-5">
        <div
          role="radiogroup"
          aria-label="Display mode"
          className="inline-flex bg-muted border border-border rounded-lg p-[3px] gap-0.5"
        >
          {MODES.map((m) => {
            const selected = mode === m.id
            return (
              <button
                key={m.id}
                ref={(el) => modeButtonRefs.current.set(m.id, el)}
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-radio-id={m.id}
                onClick={() => handleModeSelect(m.id)}
                onKeyDown={modeKeyHandler as React.KeyboardEventHandler<HTMLButtonElement>}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-md text-[11.5px] border-none cursor-pointer',
                  'transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
                style={{ fontFamily: '"IBM Plex Mono", monospace' }}
              >
                <m.Icon className="w-3 h-3" strokeWidth={1.7} />
                {m.label}
                {m.id === 'system' && mode === 'system' && (
                  <span className="text-[9px] opacity-70 ml-0.5 tracking-[0.05em]">
                    · {effectiveModeLabel}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── COLOR ── */}
      <SectionLabel>Color</SectionLabel>
      <div
        role="radiogroup"
        aria-label="Color theme"
        className="grid grid-cols-3 gap-3.5 mb-5"
      >
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            theme={t}
            selected={t.id === color}
            effectiveMode={effectiveMode}
            onSelect={handleColorSelect}
            onKeyDown={colorKeyHandler as React.KeyboardEventHandler<HTMLButtonElement>}
            tabIndex={t.id === color ? 0 : -1}
            ref={(el: HTMLButtonElement | null) => themeButtonRefs.current.set(t.id, el)}
          />
        ))}
      </div>

      {/* ── APP ICON ── */}
      <SectionLabel>App icon</SectionLabel>
      <p
        className="text-[11.5px] font-light text-muted-foreground leading-relaxed mb-4 max-w-[560px]"
        style={{ fontFamily: '"IBM Plex Mono", monospace' }}
      >
        Default is{' '}
        <em style={{ fontFamily: '"Fraunces", serif', fontStyle: 'italic', color: 'hsl(var(--foreground))' }}>
          Pilcrow
        </em>{' '}
        — the paragraph mark used by prose typographers since the 12th century.{' '}
        <span className="text-muted-foreground/60">Changes apply immediately.</span>
      </p>
      <div
        role="radiogroup"
        aria-label="App icon"
        className="grid grid-cols-6 gap-3.5 mb-5"
      >
        {PROSE_ICONS.map((item) => (
          <IconCell
            key={item.id}
            item={item}
            selected={item.id === icon}
            onSelect={handleIconSelect}
            onKeyDown={iconKeyHandler as React.KeyboardEventHandler<HTMLButtonElement>}
            tabIndex={item.id === icon ? 0 : -1}
            ref={(el: HTMLButtonElement | null) => iconButtonRefs.current.set(item.id, el)}
          />
        ))}
      </div>

      {/* ── Reset row ── */}
      <div className="flex items-center justify-between pt-3.5 border-t border-border text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <Info className="w-3 h-3 text-muted-foreground/60" strokeWidth={1.6} />
          <span>
            Using{' '}
            <span className="text-foreground">{currentTheme.name}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-foreground">
              {mode === 'system' ? `System · ${effectiveModeLabel}` : effectiveModeLabel}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-foreground">{currentIcon.name}</span>
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isAllDefault}
          onClick={() => {
            onAppearanceChange({ color: DEFAULT_COLOR, mode: DEFAULT_MODE, icon: DEFAULT_ICON })
          }}
          className="text-[11px] h-7 px-3"
          style={{ fontFamily: '"IBM Plex Mono", monospace' }}
        >
          Reset all to default
        </Button>
      </div>
    </div>
  )
}
