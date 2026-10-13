/**
 * SharedPanel (#1036) — the explorer's "Shared" view: every document shared
 * through the gateway, live shares first and revoked ones dimmed below under
 * "Previously shared". One row per publication (a doc that was shared,
 * revoked and re-shared appears in both sections — that IS the history).
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
import type { ShareEntry } from '../../types'

const SECTION_LABEL =
  'px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70'

interface SharedPanelProps {
  selectedPath: string | null
  onFileClick: (path: string) => void
  onFileDoubleClick: (path: string) => void
  onShowInFolder: (path: string) => void
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

  const active = entries
    .filter((e) => !e.revokedAt)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const revoked = entries
    .filter((e) => !!e.revokedAt)
    .sort((a, b) => (b.revokedAt ?? '').localeCompare(a.revokedAt ?? ''))

  if (!loadedOnce) {
    return <div className="p-4 text-sm text-muted-foreground">Loading shares…</div>
  }
  if (entries.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">Nothing shared yet.</div>
  }

  const renderRow = (entry: ShareEntry) => (
    <SharedRow
      key={entry.publicationId}
      entry={entry}
      isMissing={missingPaths.has(entry.localPath)}
      isOtherGateway={isOtherGateway(entry, activeOrigin)}
      isSelected={selectedPath === entry.localPath}
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
    </div>
  )
}

// ---- row ----------------------------------------------------------------

interface SharedRowProps {
  entry: ShareEntry
  isMissing: boolean
  isOtherGateway: boolean
  isSelected: boolean
  onFileClick: (path: string) => void
  onFileDoubleClick: (path: string) => void
  onShowInFolder: (path: string) => void
}

function SharedRow({
  entry,
  isMissing,
  isOtherGateway,
  isSelected,
  onFileClick,
  onFileDoubleClick,
  onShowInFolder,
}: SharedRowProps) {
  const [revokeArmed, setRevokeArmed] = useState(false)
  const isRevoked = !!entry.revokedAt
  const title = entry.title || fileNameOf(entry.localPath)

  const detail: string[] = []
  if (isRevoked) {
    detail.push(`revoked ${formatAge(Date.parse(entry.revokedAt!))}`)
  } else {
    detail.push(`shared ${formatAge(Date.parse(entry.publishedAt))}`)
    if (isOtherGateway && entry.gatewayOrigin) detail.push(`on ${hostnameOf(entry.gatewayOrigin)}`)
    else {
      detail.push(`rev ${entry.revCount}`)
      if (entry.syncMode === 'publish') detail.push('publish')
    }
  }
  if (isMissing) detail.push('file missing')

  const tooltip = isMissing
    ? `${entry.localPath} (file missing)`
    : isOtherGateway && entry.gatewayOrigin
      ? `Shared via ${entry.gatewayOrigin} — switch gateway to manage`
      : entry.localPath

  const handleCopy = () => void getApi().copyToClipboard(entry.shareUrl)
  const handleOpenInBrowser = () => void getApi().openExternal?.(entry.shareUrl)

  // Two-step arm inside the menu (mirrors ShareStatusPopover): the first
  // select keeps the menu open and relabels; the second revokes.
  const handleRevokeSelect = async (e: Event) => {
    if (!revokeArmed) {
      e.preventDefault()
      setRevokeArmed(true)
      return
    }
    const res = await getApi().shareRevoke(entry.publicationId)
    if (res.ok) {
      // Keep the editor's ◎ honest when the revoked share is the active doc's.
      if (useShareStore.getState().entry?.publicationId === entry.publicationId) {
        useShareStore.getState().applyEntry(null)
      }
      void useSharedListStore.getState().refresh()
    } else {
      useNotificationStore.getState().notify({ message: `Couldn't revoke "${title}": ${res.error}` })
    }
    setRevokeArmed(false)
  }

  const Icon = isRevoked ? CircleOff : CircleDot
  const iconStyle = !isRevoked && !isOtherGateway ? { color: SHARE_GOLD } : undefined

  return (
    <ContextMenu onOpenChange={(open) => { if (!open) setRevokeArmed(false) }}>
      <ContextMenuTrigger asChild>
        {/* A missing file still has a LIVE link: the row can't open, but the
            menu keeps Copy link / Revoke reachable (aria-disabled, not
            disabled — a disabled button swallows the contextmenu event). */}
        <button
          type="button"
          data-testid="shared-row"
          data-share-state={isRevoked ? 'revoked' : 'active'}
          aria-disabled={isMissing || undefined}
          className={cn(
            'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50',
            isSelected && 'bg-muted',
            isRevoked && 'opacity-60',
            isMissing && 'opacity-50 cursor-default hover:bg-transparent'
          )}
          onClick={() => { if (!isMissing) onFileClick(entry.localPath) }}
          onDoubleClick={() => { if (!isMissing) onFileDoubleClick(entry.localPath) }}
          title={tooltip}
        >
          <Icon
            className={cn('mt-0.5 h-4 w-4 shrink-0', !iconStyle && 'text-muted-foreground')}
            style={iconStyle}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{title}</span>
            <span className="truncate text-xs text-muted-foreground">{detail.join(' · ')}</span>
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {!isMissing && (
          <ContextMenuItem onClick={() => onFileDoubleClick(entry.localPath)}>
            <FileText className="h-4 w-4 mr-2" />
            Open
          </ContextMenuItem>
        )}
        {!isRevoked && (
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
        <ContextMenuItem disabled={isMissing} onClick={() => onShowInFolder(entry.localPath)}>
          <Folder className="h-4 w-4 mr-2" />
          {isMissing ? 'Open in Finder (file missing)' : 'Open in Finder'}
        </ContextMenuItem>
        {!isRevoked && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={isOtherGateway}
              className={cn(revokeArmed && 'text-destructive focus:text-destructive')}
              onSelect={(e) => void handleRevokeSelect(e)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isOtherGateway ? 'Revoke (switch gateway)' : revokeArmed ? 'Really revoke?' : 'Revoke'}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
