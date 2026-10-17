// prose-icons.tsx — the Prose app icon.
//
// Ported from docs/design/v1.2-appearance/prose-icons.jsx (the design canvas
// used `window.ProseIcons`; this is the real renderer module). Single source of
// truth for the AI-avatar rendering AND the PNG/.icns export pipeline (#505).
// Renders at a base 320×320 squircle; use `IconThumb` to render it at an
// arbitrary smaller size via CSS scaling.
//
// The app-icon switcher and its six other variants were removed in 1.9.0
// (#1052) — Pilcrow is the only icon.

import type { CSSProperties, ComponentType, ReactNode } from 'react'
import type { IconId } from '../types'

const NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

export const CREAM = '#e3dbd1'
export const NEAR_BLACK = '#0a0a0a'
export const SQUIRCLE = 0.2237

interface IconShellProps {
  children?: ReactNode
  size?: number
  bg?: string
  grain?: boolean
}

export function IconShell({
  children,
  size = 320,
  bg = NEAR_BLACK,
  grain = true,
}: IconShellProps) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: size * SQUIRCLE,
        background: bg,
        overflow: 'hidden',
        boxShadow: '0 14px 44px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.045)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {grain && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: NOISE_URL,
            backgroundSize: '200px 200px',
            opacity: 0.16,
            mixBlendMode: 'screen',
            pointerEvents: 'none',
          }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1, lineHeight: 1 }}>{children}</div>
    </div>
  )
}

// ── Icon ─────────────────────────────────────────────────────────────────────

export function IconPilcrow() {
  return (
    <IconShell>
      <div
        style={{
          fontFamily: '"Fraunces", serif',
          fontStyle: 'italic',
          fontWeight: 340,
          fontVariationSettings: '"opsz" 144',
          fontSize: 280,
          color: CREAM,
          transform: 'translateY(6px)',
        }}
      >
        ¶
      </div>
    </IconShell>
  )
}

// Renders the icon component at an arbitrary smaller size by CSS-scaling the
// underlying 320×320 shell. Keeps geometry exact.
interface IconThumbProps {
  Component: ComponentType
  size?: number
  /** Clip to a circle (e.g. for chat avatars) instead of the app-icon squircle. */
  circle?: boolean
}

export function IconThumb({ Component, size = 96, circle = false }: IconThumbProps) {
  // In circle mode, zoom the 320px shell a touch so its squircle background
  // fully fills the circular clip — otherwise the shell's cut corners leave
  // transparent notches at the diagonals.
  const fill = circle ? 1.2 : 1
  const scale = (size * fill) / 320
  const offset = (size * (fill - 1)) / 2
  const wrap: CSSProperties = {
    width: size,
    height: size,
    position: 'relative',
    flexShrink: 0,
    ...(circle ? { borderRadius: '50%', overflow: 'hidden' } : {}),
  }
  const inner: CSSProperties = {
    position: 'absolute',
    top: -offset,
    left: -offset,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  }
  return (
    <div style={wrap}>
      <div style={inner}>
        <Component />
      </div>
    </div>
  )
}

// ── Catalog ──────────────────────────────────────────────────────────────────

export interface ProseIconEntry {
  id: IconId
  name: string
  subtitle: string
  Component: ComponentType
  official?: boolean
}

export const PROSE_ICONS: ProseIconEntry[] = [
  { id: 'pilcrow', name: 'Pilcrow', subtitle: '¶ · paragraph mark', Component: IconPilcrow, official: true },
]
