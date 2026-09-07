/**
 * ShareStatusIcon (#769) — the Solo.ist ◎ pinned top-right of the document
 * surface when it's shared. 18px, two circles: a 1.2px hairline ring and a
 * 2.4px gold pupil; every state is a stroke/fill change on the same geometry
 * (nothing moves position, nothing scales). Click opens the share popover.
 *
 * States: synced (dim ring, gold pupil) · dirty, publish mode only (dashed
 * gold ring + badge dot) · syncing (rotating gold arc, breathing pupil) ·
 * error/offline (red tint). Not shared → the icon is absent (parent gates).
 */
import { useShareStore, deriveShareStatus, type ShareStatus } from '../../stores/shareStore'

/** The solo.ist share accent — constant across themes. */
export const SHARE_GOLD = '#c8a45a'
const SHARE_RED = '#e07070'

const TOOLTIPS: Record<ShareStatus, string> = {
  synced: 'Shared and in sync',
  dirty: 'Unshared changes — click to share',
  syncing: 'Syncing',
  error: 'Sync problem — changes kept locally',
  offline: 'Offline — changes queued',
}

function StatusGlyph({ status }: { status: ShareStatus }) {
  if (status === 'syncing') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="7" stroke="hsl(var(--border))" strokeWidth="1.2" />
        <g className="prose-share-spin">
          <circle
            cx="9"
            cy="9"
            r="7"
            stroke={SHARE_GOLD}
            strokeWidth="1.2"
            strokeDasharray="11 33"
            strokeLinecap="round"
          />
        </g>
        <circle className="prose-share-breathe" cx="9" cy="9" r="2.4" fill={SHARE_GOLD} />
      </svg>
    )
  }
  if (status === 'dirty') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle
          cx="9"
          cy="9"
          r="7"
          stroke={SHARE_GOLD}
          strokeWidth="1.2"
          strokeOpacity="0.55"
          strokeDasharray="2.6 3.4"
        />
        <circle cx="9" cy="9" r="2.4" fill={SHARE_GOLD} />
        {/* Badge dot, masked from the ring by a background-colored disc. */}
        <circle cx="15.4" cy="2.6" r="3" fill="hsl(var(--background))" />
        <circle cx="15.4" cy="2.6" r="1.7" fill={SHARE_GOLD} />
      </svg>
    )
  }
  if (status === 'error' || status === 'offline') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="7" stroke={SHARE_RED} strokeWidth="1.2" strokeOpacity="0.5" />
        <circle cx="9" cy="9" r="2.4" fill={SHARE_RED} />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="7" stroke="hsl(var(--muted-foreground))" strokeOpacity="0.6" strokeWidth="1.2" />
      <circle cx="9" cy="9" r="2.4" fill={SHARE_GOLD} />
    </svg>
  )
}

export function ShareStatusIcon() {
  const entry = useShareStore((s) => s.entry)
  const pushing = useShareStore((s) => s.pushing)
  const shareDirty = useShareStore((s) => s.shareDirty)
  const lastError = useShareStore((s) => s.lastError)
  const lastErrorCode = useShareStore((s) => s.lastErrorCode)
  const popoverOpen = useShareStore((s) => s.popoverOpen)
  const setPopoverOpen = useShareStore((s) => s.setPopoverOpen)

  if (!entry) return null
  const status = deriveShareStatus({ pushing, shareDirty, lastError, lastErrorCode, entry })

  return (
    <button
      type="button"
      data-share-icon
      onClick={() => setPopoverOpen(!popoverOpen)}
      title={TOOLTIPS[status]}
      aria-label={`Share status: ${TOOLTIPS[status]}`}
      aria-expanded={popoverOpen}
      className="prose-share-icon grid h-[30px] w-[30px] place-items-center rounded-md transition-colors"
    >
      <StatusGlyph status={status} />
    </button>
  )
}
