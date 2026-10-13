/**
 * SharedPanel (#1036, #1037) — the explorer's "Shared" view: every document
 * shared through the gateway, live shares first and revoked ones dimmed below
 * under "Previously shared". One row per publication (a doc that was shared,
 * revoked and re-shared appears in both sections — that IS the history).
 *
 * Rows come from two sources: this device's share-sync.json entries, and the
 * gateway's list for the signed-in account. Gateway rows with no local entry
 * ("not on this device") can't open or copy — the server never has the URL
 * or the path — but a live one can still be revoked from here.
 *
 * Reads sharedListStore; FileListPanel owns the refresh wiring. Rows never
 * render `shareUrl` — it embeds the capability token (share/metadata.ts).
 */
import { useState } from 'react'
import { CircleDot, CircleOff, Copy, ExternalLink, FileText, Folder, Trash2 } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { cn } from '../../lib/utils'
import { getApi } from '../../lib/browserApi'
import { formatAge } from '../../types/annotations'
import { useSharedListStore } from '../../stores/sharedListStore'
import { useShareStore } from '../../stores/shareStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { SHARE_GOLD } from '../share/ShareStatusIcon'
import type { ShareEntry, SharePublicationSummary } from '../../types'

const SECTION_LABEL =
  'px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70'

interface SharedPanelProps {
  selectedPath: string | null
  onFileClick: (path: string) => void
  onFileDoubleClick: (path: string) => void
  onShowInFolder: (path: string) => void
}

/** One list row, from a local entry, a gateway row, or both. */
interface SharedRowModel {
  publicationId: string
  title: string
  publishedAt: string
  revokedAt: string | null
  revCount: number
  syncMode: ShareEntry['syncMode'] | null
  /** Live comment rows on the gateway, when the gateway list is in. */
  commentCount: number | null
  /** This device's entry — absent for a gateway-only row. */
  local: ShareEntry | null
  isMissing: boolean
  isOtherGateway: boolean
  /** Live local entry on the active origin that the signed-in account's gateway list doesn't contain. */
  isOrphan: boolean
  /** Gateway-only rows collapsed into this one: earlier links of the same document (see collapseChurn). */
  earlierLinks: number
}

/** Republishing revoked the previous link at publish time — within this of each other. */
const CHURN_GAP_MS = 10_000

/**
 * Before #932 every republish minted a new publication and revoked the
 * previous one, so one document can have a long chain of server rows with
 * the same title, each revoked at the exact moment the next was published.
 * The device has no entries for them (they're gateway-only), so they'd read
 * as duplicates. Collapse each chain into its newest link, counting the
 * rest. Only gateway-only rows, only the churn signature — a share revoked
 * and re-shared days later stays two rows, because that IS the history.
 */
function collapseChurn(rows: SharePublicationSummary[]): Array<{ latest: SharePublicationSummary; earlier: number }> {
  const byTitle = new Map<string, SharePublicationSummary[]>()
  for (const p of rows) {
    const list = byTitle.get(p.title) ?? []
    list.push(p)
    byTitle.set(p.title, list)
  }
  const out: Array<{ latest: SharePublicationSummary; earlier: number }> = []
  for (const list of byTitle.values()) {
    list.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    let chain: SharePublicationSummary[] = []
    const flush = () => {
      if (chain.length > 0) out.push({ latest: chain[chain.length - 1], earlier: chain.length - 1 })
      chain = []
    }
    for (const p of list) {
      const prev = chain[chain.length - 1]
      const continues =
        !!prev?.revokedAt &&
        Math.abs(Date.parse(p.publishedAt) - Date.parse(prev.revokedAt)) <= CHURN_GAP_MS
      if (!continues) flush()
      chain.push(p)
    }
    flush()
  }
  return out
}

function fileNameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.(md|markdown|txt)$/i, '')
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return origin
  }
}

/** Minted on a different gateway than the one the app points at (M-02): the
 *  link is live, but copy/revoke here would be refused with wrong_gateway.
 *  Legacy entries with no recorded origin count as current. */
function isOtherGateway(entry: ShareEntry, activeOrigin: string | null): boolean {
  return !!entry.gatewayOrigin && !!activeOrigin && entry.gatewayOrigin !== activeOrigin
}

export function SharedPanel({ selectedPath, onFileClick, onFileDoubleClick, onShowInFolder }: SharedPanelProps) {
  const entries = useSharedListStore((s) => s.entries)
  const activeOrigin = useSharedListStore((s) => s.activeOrigin)
  const missingPaths = useSharedListStore((s) => s.missingPaths)
  const loadedOnce = useSharedListStore((s) => s.loadedOnce)
  const remoteById = useSharedListStore((s) => s.remoteById)
  const remoteOnly = useSharedListStore((s) => s.remoteOnly)
  const remoteStatus = useSharedListStore((s) => s.remoteStatus)

  const rows: SharedRowModel[] = [
    ...entries.map((e): SharedRowModel => {
      const other = isOtherGateway(e, activeOrigin)
      const remote = remoteById[e.publicationId]
      return {
        publicationId: e.publicationId,
        title: e.title || fileNameOf(e.localPath),
        publishedAt: e.publishedAt,
        revokedAt: e.revokedAt,
        revCount: e.revCount,
        syncMode: e.syncMode,
        commentCount: remote ? remote.commentCount : null,
        local: e,
        isMissing: missingPaths.has(e.localPath),
        isOtherGateway: other,
        isOrphan: remoteStatus === 'ok' && !e.revokedAt && !other && !remote,
        earlierLinks: 0,
      }
    }),
    ...collapseChurn(remoteOnly).map(({ latest: p, earlier }): SharedRowModel => ({
      publicationId: p.publicationId,
      title: p.title,
      publishedAt: p.publishedAt,
      revokedAt: p.revokedAt,
      revCount: p.revCount,
      syncMode: null,
      commentCount: p.commentCount,
      local: null,
      isMissing: false,
      isOtherGateway: false,
      isOrphan: false,
      earlierLinks: earlier,
    })),
  ]
  const active = rows
    .filter((r) => !r.revokedAt)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const revoked = rows
    .filter((r) => !!r.revokedAt)
    .sort((a, b) => (b.revokedAt ?? '').localeCompare(a.revokedAt ?? ''))

  if (!loadedOnce) {
    return <div className="p-4 text-sm text-muted-foreground">Loading shares…</div>
  }
  if (rows.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">Nothing shared yet.</div>
  }

  const renderRow = (row: SharedRowModel) => (
    <SharedRow
      key={row.publicationId}
      row={row}
      isSelected={!!row.local && selectedPath === row.local.localPath}
      onFileClick={onFileClick}
      onFileDoubleClick={onFileDoubleClick}
      onShowInFolder={onShowInFolder}
    />
  )

  return (
    <div className="p-2">
      {active.length > 0 && (
        <div data-testid="shared-active">
          {revoked.length > 0 && <div className={SECTION_LABEL}>Shared</div>}
          {active.map(renderRow)}
        </div>
      )}
      {revoked.length > 0 && (
        <div data-testid="shared-revoked">
          <div className={SECTION_LABEL}>Previously shared</div>
          {revoked.map(renderRow)}
        </div>
      )}
      {remoteStatus === 'error' && (
        <div className="px-2 pt-3 text-xs text-muted-foreground" data-testid="shared-remote-error">
          Couldn't reach the gateway — showing this device's list.
        </div>
      )}
    </div>
  )
}

// ---- row ----------------------------------------------------------------

interface SharedRowProps {
  row: SharedRowModel
  isSelected: boolean
  onFileClick: (path: string) => void
  onFileDoubleClick: (path: string) => void
  onShowInFolder: (path: string) => void
}

function SharedRow({ row, isSelected, onFileClick, onFileDoubleClick, onShowInFolder }: SharedRowProps) {
  const [revokeArmed, setRevokeArmed] = useState(false)
  const { local, title } = row
  const isRevoked = !!row.revokedAt
  const isRemoteOnly = !local
  // Nothing to open: no local file, or the local file is gone.
  const cannotOpen = isRemoteOnly || row.isMissing

  const detail: string[] = []
  if (isRevoked) {
    detail.push(`revoked ${formatAge(Date.parse(row.revokedAt!))}`)
  } else {
    detail.push(`shared ${formatAge(Date.parse(row.publishedAt))}`)
    if (row.isOtherGateway && local?.gatewayOrigin) detail.push(`on ${hostnameOf(local.gatewayOrigin)}`)
    else {
      detail.push(`rev ${row.revCount}`)
      if (row.syncMode === 'publish') detail.push('publish')
    }
  }
  if (!isRevoked && row.commentCount) {
    detail.push(`${row.commentCount} ${row.commentCount === 1 ? 'comment' : 'comments'}`)
  }
  if (isRemoteOnly) detail.push('not on this device')
  else if (row.isMissing) detail.push('file missing')
  else if (row.isOrphan) detail.push('not on gateway')
  if (row.earlierLinks > 0) {
    detail.push(`${row.earlierLinks} earlier ${row.earlierLinks === 1 ? 'link' : 'links'}`)
  }

  const tooltip = isRemoteOnly
    ? 'Shared from another device or profile — this one has no copy of the file or the link'
    : row.isMissing
      ? `${local!.localPath} (file missing)`
      : row.isOtherGateway && local?.gatewayOrigin
        ? `Shared via ${local.gatewayOrigin} — switch gateway to manage`
        : row.isOrphan
          ? `${local!.localPath} — the signed-in account's gateway list has no record of this share`
          : local!.localPath

  const handleCopy = () => local && void getApi().copyToClipboard(local.shareUrl)
  const handleOpenInBrowser = () => local && void getApi().openExternal?.(local.shareUrl)

  // Two-step arm inside the menu (mirrors ShareStatusPopover): the first
  // select keeps the menu open and relabels; the second revokes.
  const handleRevokeSelect = async (e: Event) => {
    if (!revokeArmed) {
      e.preventDefault()
      setRevokeArmed(true)
      return
    }
    const res = await getApi().shareRevoke(row.publicationId)
    if (res.ok) {
      // Keep the editor's ◎ honest when the revoked share is the active doc's.
      if (useShareStore.getState().entry?.publicationId === row.publicationId) {
        useShareStore.getState().applyEntry(null)
      }
      void useSharedListStore.getState().refresh()
    } else {
      useNotificationStore.getState().notify({ message: `Couldn't revoke "${title}": ${res.error}` })
    }
    setRevokeArmed(false)
  }

  const Icon = isRevoked ? CircleOff : CircleDot
  const muted = isRevoked || row.isOtherGateway || row.isOrphan || isRemoteOnly
  const iconStyle = muted ? undefined : { color: SHARE_GOLD }
  const canRevoke = !isRevoked && !row.isOtherGateway

  const button = (
    // Rows that can't open still own a context menu (Copy link / Revoke for
    // a live link whose file is gone; Revoke for a gateway-only row), so
    // aria-disabled rather than disabled — a disabled button swallows the
    // contextmenu event.
    <button
      type="button"
      data-testid="shared-row"
      data-share-state={isRevoked ? 'revoked' : 'active'}
      data-remote={isRemoteOnly || undefined}
      data-orphan={row.isOrphan || undefined}
      data-earlier-links={row.earlierLinks > 0 ? row.earlierLinks : undefined}
      aria-disabled={cannotOpen || undefined}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50',
        isSelected && 'bg-muted',
        isRevoked && 'opacity-60',
        cannotOpen && 'opacity-50 cursor-default hover:bg-transparent'
      )}
      onClick={() => { if (!cannotOpen) onFileClick(local!.localPath) }}
      onDoubleClick={() => { if (!cannotOpen) onFileDoubleClick(local!.localPath) }}
      title={tooltip}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', muted && 'text-muted-foreground')} style={iconStyle} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{detail.join(' · ')}</span>
      </span>
    </button>
  )

  // A revoked gateway-only row has no action at all.
  if (isRemoteOnly && !canRevoke) return button

  return (
    <ContextMenu onOpenChange={(open) => { if (!open) setRevokeArmed(false) }}>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        {!cannotOpen && (
          <ContextMenuItem onClick={() => onFileDoubleClick(local!.localPath)}>
            <FileText className="h-4 w-4 mr-2" />
            Open
          </ContextMenuItem>
        )}
        {!isRevoked && local && (
          <>
            <ContextMenuItem onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-2" />
              Copy link
            </ContextMenuItem>
            <ContextMenuItem onClick={handleOpenInBrowser}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in browser
            </ContextMenuItem>
          </>
        )}
        {local && (
          <ContextMenuItem disabled={row.isMissing} onClick={() => onShowInFolder(local.localPath)}>
            <Folder className="h-4 w-4 mr-2" />
            {row.isMissing ? 'Open in Finder (file missing)' : 'Open in Finder'}
          </ContextMenuItem>
        )}
        {!isRevoked && (
          <>
            {local && <ContextMenuSeparator />}
            <ContextMenuItem
              disabled={!canRevoke}
              className={cn(revokeArmed && 'text-destructive focus:text-destructive')}
              onSelect={(e) => void handleRevokeSelect(e)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {!canRevoke ? 'Revoke (switch gateway)' : revokeArmed ? 'Really revoke?' : 'Revoke'}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
