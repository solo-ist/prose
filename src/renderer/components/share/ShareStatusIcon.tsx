/**
 * ShareStatusIcon (#769) — the Solo.ist ◎ pinned top-right of the document
 * surface when it's shared. 18px, two circles: a 1.2px hairline ring and a
 * 2.4px gold pupil; every state is a stroke/fill change on the same geometry
 * (nothing moves position, nothing scales). Click opens the share popover.
 *
 * States: synced (dim ring, gold pupil) · dirty, both modes — unsaved edits
 * or a save awaiting push (dashed gold ring + badge dot) · syncing (rotating
 * gold arc, breathing pupil) · error/offline (red tint). Not shared → the
 * icon is absent (parent gates).
 */
import { useShareStore, deriveShareStatus, type ShareStatus } from '../../stores/shareStore'
import { useEditorStore } from '../../stores/editorStore'

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

/** The dirty/unseen badge dot, masked from the ring by a background disc. */
function BadgeDot({ breathe }: { breathe?: boolean }) {
  return (
    <>
      <circle cx="15.4" cy="2.6" r="3" fill="hsl(var(--background))" />
      <circle className={breathe ? 'prose-share-breathe' : undefined} cx="15.4" cy="2.6" r="1.7" fill={SHARE_GOLD} />
    </>
  )
}

function StatusGlyph({ status, showBadge }: { status: ShareStatus; showBadge: boolean }) {
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
        <BadgeDot breathe={showBadge} />
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
      {/* New reviewer comments landed — a breathing badge until seen. */}
      {showBadge && <BadgeDot breathe />}
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
  const unseen = useShareStore((s) => s.unseenComments)
  const docDirty = useEditorStore((s) => s.document.isDirty)

  if (!entry) return null
  const status = deriveShareStatus({ pushing, shareDirty, lastError, lastErrorCode, entry })
  // Dirty needs a mode-aware action: an unsaved doc syncs on save (auto pushes
  // it, publish arms the badge); a saved-but-unpushed one wants the popover.
  const base =
    status === 'dirty' && docDirty
      ? 'Unshared changes — save to sync'
      : TOOLTIPS[status]
  const tooltip = unseen > 0 ? `${base} · ${unseen} new comment${unseen === 1 ? '' : 's'}` : base

  return (
    <button
      type="button"
      data-share-icon
      onClick={() => setPopoverOpen(!popoverOpen)}
      title={tooltip}
      aria-label={`Share status: ${tooltip}`}
      aria-expanded={popoverOpen}
      className="prose-share-icon grid h-[30px] w-[30px] place-items-center rounded-md transition-colors"
    >
      <StatusGlyph status={status} showBadge={unseen > 0} />
    </button>
  )
}
