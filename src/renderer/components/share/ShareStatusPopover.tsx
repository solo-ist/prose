/**
 * ShareStatusPopover (#769) — the share surface, opened from the pinned ◎.
 * Three sections: SHARED (status line, link + copy), SYNC (Auto|Publish
 * toggle, mode note, "Share latest updates" when publish + dirty), and
 * Conversation (open-thread count + revoke). Hand-rolled — no popover
 * primitive exists in this app and none is worth adding for one card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getApi } from '../../lib/browserApi'
import { pushShareContent } from '../../lib/shareContentSync'
import { syncShareComments } from '../../lib/shareSync'
import { useShareStore, deriveShareStatus } from '../../stores/shareStore'
import { useEditorStore } from '../../stores/editorStore'
import { useCommentStore, countOpenThreads } from '../../extensions/comments/store'
import { OPEN_COMMENT_EVENT, requestCommentReview } from '../editor/AIEditsHistoryPanel'
import { formatAge } from '../../types/annotations'
import type { CommentData } from '../../extensions/comments/types'
import { SHARE_GOLD } from './ShareStatusIcon'
import { cn } from '../../lib/utils'

const SECTION_LABEL = 'text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70'

export function ShareStatusPopover() {
  const entry = useShareStore((s) => s.entry)
  const pushing = useShareStore((s) => s.pushing)
  const shareDirty = useShareStore((s) => s.shareDirty)
  const lastError = useShareStore((s) => s.lastError)
  const lastErrorCode = useShareStore((s) => s.lastErrorCode)
  const setPopoverOpen = useShareStore((s) => s.setPopoverOpen)
  const setSyncMode = useShareStore((s) => s.setSyncMode)
  const unseen = useShareStore((s) => s.unseenComments)
  const pendingComments = useCommentStore((s) => s.pendingComments)
  const openCount = countOpenThreads(pendingComments)
  // The most recent reviewer threads — the popover's jump list into the
  // commenting layer. Share-sourced (shareId) and still open, newest first.
  const recentReviewerThreads = useMemo(
    () =>
      pendingComments
        .filter((c) => c.shareId && !c.resolved)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 3),
    [pendingComments]
  )

  const [copied, setCopied] = useState(false)
  const [revokeArmed, setRevokeArmed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setPopoverOpen(false), [setPopoverOpen])

  // Opening the popover pulls new reviewer comments right away (the dialog
  // used to do this) — synced threads land in the doc and the count updates.
  // Once the pull settles, everything visible here counts as seen.
  useEffect(() => {
    const e = useShareStore.getState().entry
    const documentId = useEditorStore.getState().document.documentId
    void (async () => {
      if (e && !e.revokedAt && documentId) await syncShareComments(e, documentId)
      useShareStore.getState().clearUnseenComments()
    })()
  }, [])

  // Jump from the popover into a thread: anchored threads open their inline
  // bubble at the highlight; anchor-lost ones open focused in Comment Review.
  const jumpToThread = useCallback(
    (c: CommentData) => {
      setPopoverOpen(false)
      if (c.anchorLost) {
        requestCommentReview(c.id)
      } else {
        window.dispatchEvent(new CustomEvent(OPEN_COMMENT_EVENT, { detail: { id: c.id } }))
      }
    },
    [setPopoverOpen]
  )

  const openReview = useCallback(() => {
    setPopoverOpen(false)
    requestCommentReview()
  }, [setPopoverOpen])

  // Outside mousedown + Escape close (FindBar pattern). Clicks on the icon
  // itself toggle via the button, so exclude it here.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (rootRef.current?.contains(target)) return
      if (target.closest('[data-share-icon]')) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [close])

  if (!entry) return null

  const status = deriveShareStatus({ pushing, shareDirty, lastError, lastErrorCode, entry })
  const auto = entry.syncMode === 'auto'
  const statusLine =
    status === 'dirty'
      ? 'unshared changes'
      : status === 'syncing'
        ? 'syncing'
        : status === 'offline'
          ? 'offline'
          : status === 'error'
            ? 'sync problem'
            : auto
              ? 'live'
              : 'up to date'

  const handleCopy = async () => {
    await getApi().copyToClipboard(entry.shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const handleMode = async (mode: 'auto' | 'publish') => {
    if (mode === entry.syncMode) return
    await setSyncMode(mode)
    // Switching to auto with pending changes pushes them right away.
    if (mode === 'auto' && useShareStore.getState().shareDirty) void pushShareContent('manual')
  }

  const handleShareLatest = () => void pushShareContent('manual')

  const handleRevoke = async () => {
    if (!revokeArmed) {
      setRevokeArmed(true)
      return
    }
    const res = await getApi().shareRevoke(entry.publicationId)
    if (res.ok) {
      useShareStore.getState().applyEntry(null)
      close()
    } else {
      useShareStore.getState().setError(res.error, res.code ?? null)
      setRevokeArmed(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="w-[272px] overflow-hidden rounded-[10px] border border-border bg-popover text-left shadow-xl"
    >
      {/* Shared: status + link */}
      <div className="flex flex-col gap-2.5 border-b border-border px-3.5 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2.5">
          <span className={SECTION_LABEL}>Shared</span>
          <span className="text-[10px] text-muted-foreground">{statusLine}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-[5px] border border-border bg-background px-2 py-1.5 text-[11px] text-foreground">
            {entry.shareUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-[5px] px-2.5 py-1.5 text-[10px] font-semibold tracking-wide text-[#090909] transition-opacity hover:opacity-80"
            style={{ background: SHARE_GOLD }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Sync: mode toggle + share-latest */}
      <div className="flex flex-col gap-2.5 border-b border-border px-3.5 py-3">
        <span className={SECTION_LABEL}>Sync</span>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[5px] border border-border bg-border">
          {(['auto', 'publish'] as const).map((mode) => {
            const active = entry.syncMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => void handleMode(mode)}
                aria-pressed={active}
                className={cn(
                  'py-1.5 text-[11px] capitalize transition-colors',
                  active ? 'font-semibold text-[#090909]' : 'bg-background text-muted-foreground hover:text-foreground'
                )}
                style={active ? { background: SHARE_GOLD } : undefined}
              >
                {mode}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {auto
            ? 'Saves push in the background. No version ceremony.'
            : 'Content freezes at the last publish. Comments stay live.'}
        </p>
        {!auto && status === 'dirty' && (
          <button
            type="button"
            onClick={handleShareLatest}
            className="rounded-[5px] border px-2.5 py-2 text-[11px] transition-opacity hover:opacity-80"
            style={{ color: SHARE_GOLD, background: 'rgba(200,164,90,0.1)', borderColor: 'rgba(200,164,90,0.28)' }}
          >
            Share latest updates
          </button>
        )}
        {lastError && <p className="text-[10px] leading-relaxed text-destructive">{lastError}</p>}
      </div>

      {/* Conversation + revoke */}
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <button
          type="button"
          onClick={openReview}
          disabled={openCount === 0}
          title={openCount > 0 ? 'Open Comment Review' : undefined}
          className={cn(
            'group flex items-center justify-between gap-2.5 text-left text-[11px] text-muted-foreground transition-colors',
            openCount > 0 && 'hover:text-foreground'
          )}
        >
          <span className="flex items-center gap-1.5">
            Conversation
            {unseen > 0 && (
              <span
                className="rounded-full px-1.5 text-[9px] font-semibold text-[#090909]"
                style={{ background: SHARE_GOLD }}
              >
                {unseen} new
              </span>
            )}
          </span>
          <span className={cn('text-foreground', openCount > 0 && 'group-hover:underline')}>
            {openCount} open · live
          </span>
        </button>

        {recentReviewerThreads.length > 0 && (
          <div className="flex flex-col gap-1">
            {recentReviewerThreads.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => jumpToThread(c)}
                title={c.anchorLost ? 'Anchor lost — opens in Comment Review' : 'Jump to the highlight'}
                className="rounded-[5px] border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-background"
              >
                <span className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate font-semibold text-foreground/80">{c.authorName || 'Reviewer'}</span>
                  <span className="shrink-0">{formatAge(c.createdAt)}</span>
                </span>
                <span className="line-clamp-2 text-[11px] leading-snug text-foreground/90">{c.comment}</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleRevoke()}
          className={cn(
            'self-start text-[11px] transition-colors',
            revokeArmed ? 'font-semibold text-destructive' : 'text-muted-foreground hover:text-destructive'
          )}
        >
          {revokeArmed ? 'Really revoke?' : 'Revoke session'}
        </button>
      </div>
    </div>
  )
}
