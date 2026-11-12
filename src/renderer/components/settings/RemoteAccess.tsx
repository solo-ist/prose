/**
 * Settings → Integrations → Connections → Remote access (#1239): lets
 * ChatGPT and claude.ai work with the documents open in Prose, through the
 * Prose gateway (design docs/architecture/mcp-relay.md §6).
 *
 * The switch is the kill switch: off closes the connection at once. A
 * trusted assistant (claude.ai, ChatGPT; shared/mcp/trustedRemoteClients.ts,
 * #1304) the writer connects is listed here already connected, with the
 * permissions granted on the gateway's consent page, and marked new until
 * the writer has seen it. Any other appears as pending on its first call,
 * and reaches nothing until the writer approves it with the permissions
 * picked here (the second gate, after the gateway's consent page). Removing
 * or declining one refuses it at once and revokes it at the gateway.
 * Direct build only; the Mac App Store build has no Integrations tab.
 */

import { useCallback, useEffect, useState } from 'react'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Checkbox } from '../ui/checkbox'
import { CopyButton } from '../ui/copy-button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog'
import { BadgeCheck, Cloud, Pencil, Trash2 } from 'lucide-react'
import type { RemoteAccessStatus, RemoteConnection } from '../../../shared/mcp/remoteAccess'

/** The optional permissions; reading the open documents comes with any approval. */
const OPTIONAL_SCOPES = [
  { scope: 'propose', label: 'Suggest edits' },
  { scope: 'comment', label: 'Comment' }
] as const

function statusText(status: RemoteAccessStatus): string {
  switch (status.state) {
    case 'connected':
      // The gateway routes an account's calls to its most recently active Mac (§7a).
      if (status.receiving === false) {
        return 'Connected. Another Mac is active: remote calls go to it until you use Prose here.'
      }
      return 'Connected. Receiving remote calls: the assistants listed below can work on the documents you have open.'
    case 'connecting':
      return 'Connecting…'
    case 'reconnecting':
      return `Reconnecting…${status.error ? ` (${status.error})` : ''}`
    case 'signed-out':
      return 'Signed out. Sign in under Settings → Account to use Remote access.'
    case 'replaced':
      return 'Another Prose window on this Mac has the connection. Turn Remote access off and on to take it back.'
    case 'unavailable':
      return 'Not available in this version of Prose.'
    default:
      return status.signedIn
        ? "Off. ChatGPT and claude.ai can't reach Prose."
        : 'Sign in under Settings → Account to use Remote access.'
  }
}

function lastUsed(c: RemoteConnection): string {
  return c.lastUsedAt ? `Last used ${new Date(c.lastUsedAt).toLocaleString()}` : 'Not used yet'
}

function identity(c: RemoteConnection): string {
  if (!c.verified) return 'Unverified: it registered itself under this name'
  try {
    return `Verified: ${new URL(c.clientId).host}`
  } catch {
    return 'Verified'
  }
}

function ScopeChoices({
  name,
  scopes,
  onChange,
  disabled
}: {
  name: string
  scopes: string[]
  onChange: (scopes: string[]) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Checkbox checked disabled aria-label={`${name}: read open documents`} />
        Read open documents
      </span>
      {OPTIONAL_SCOPES.map(({ scope, label }) => (
        <label key={scope} className="flex items-center gap-1.5">
          <Checkbox
            checked={scopes.includes(scope)}
            disabled={disabled}
            aria-label={`${name}: ${label.toLowerCase()}`}
            onCheckedChange={(checked) =>
              onChange(checked === true ? [...scopes.filter((s) => s !== scope), scope] : scopes.filter((s) => s !== scope))
            }
          />
          {label}
        </label>
      ))}
    </div>
  )
}

/**
 * Remote clients that need the writer's eye, for the Integrations tab's
 * count: those waiting for approval, and trusted ones that connected and
 * haven't been seen here yet (#1304). Follows main's change events; 0 where
 * Remote access doesn't exist.
 */
export function useRemotePendingCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const api = window.api
    if (!api?.mcpRemoteStatus) return
    const refresh = () => {
      api.mcpRemoteStatus?.().then((s) => setCount(s.available ? s.pendingCount + s.unreviewedCount : 0)).catch(() => {})
    }
    refresh()
    return api.onMcpRemoteChanged?.(refresh)
  }, [])
  return count
}

export function RemoteAccess() {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [connections, setConnections] = useState<RemoteConnection[]>([])
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [renaming, setRenaming] = useState<{ clientId: string; label: string } | null>(null)
  const [removing, setRemoving] = useState<RemoteConnection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Trusted clients that connected since the writer last looked (#1304): shown
  // as new for this visit. Showing them is what marks them seen, which clears
  // the counts on the Integrations tab and the Dock.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(async () => {
    const api = window.api
    if (!api?.mcpRemoteStatus || !api.mcpRemoteList) return
    const [s, listed] = await Promise.all([api.mcpRemoteStatus(), api.mcpRemoteList()])
    setStatus(s)
    if (!listed.ok) return
    setConnections(listed.value)
    const unreviewed = listed.value.filter((c) => c.status === 'approved' && c.reviewedAt === null).map((c) => c.clientId)
    if (unreviewed.length > 0) {
      setFresh((seen) => new Set([...seen, ...unreviewed]))
      void api.mcpRemoteAcknowledge?.()
    }
  }, [])

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    const off = window.api?.onMcpRemoteChanged?.(() => {
      void load()
    })
    return () => off?.()
  }, [load])

  if (!status?.available) return null

  const setEnabled = async (enabled: boolean) => {
    if (!window.api?.mcpRemoteSetEnabled) return
    setError(null)
    const result = await window.api.mcpRemoteSetEnabled(enabled)
    if (result.ok) setStatus(result.value)
    else setError(result.error)
  }

  const approve = async (c: RemoteConnection) => {
    if (!window.api?.mcpRemoteApprove) return
    setError(null)
    const result = await window.api.mcpRemoteApprove(c.clientId, drafts[c.clientId] ?? [])
    if (!result.ok) setError(result.error)
    await load()
  }

  const updateScopes = async (c: RemoteConnection, scopes: string[]) => {
    if (!window.api?.mcpRemoteUpdate) return
    setError(null)
    const result = await window.api.mcpRemoteUpdate(c.clientId, { scopes })
    if (!result.ok) setError(result.error)
    await load()
  }

  const rename = async () => {
    if (!renaming || !window.api?.mcpRemoteUpdate) return
    setError(null)
    const result = await window.api.mcpRemoteUpdate(renaming.clientId, { label: renaming.label })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRenaming(null)
    await load()
  }

  const forget = async (c: RemoteConnection, how: 'deny' | 'remove') => {
    const api = window.api
    const call = how === 'deny' ? api?.mcpRemoteDeny : api?.mcpRemoteRemove
    if (!call) return
    setError(null)
    setNotice(null)
    const result = await call(c.clientId)
    if (!result.ok) setError(result.error)
    else if (!result.value.revokedAtGateway) {
      setNotice(`${c.label} is refused in Prose, but the gateway couldn't revoke it (${result.value.error ?? 'unreachable'}). It will be revoked when you remove it again.`)
    }
    setRemoving(null)
    await load()
  }

  const pending = connections.filter((c) => c.status === 'pending')
  const approved = connections.filter((c) => c.status === 'approved')
  const denied = connections.filter((c) => c.status === 'denied')
  const canTurnOn = status.signedIn || status.enabled

  return (
    <div className="space-y-4" data-testid="remote-access">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="remote-access-switch">Remote access</Label>
          <p className="text-xs text-muted-foreground">
            Let ChatGPT and claude.ai work with the documents you have open, through the Prose gateway. They can't open,
            create or list your files. Each one you connect is listed here, where you can change what it may do or
            remove it; any other assistant waits for your approval here first.
          </p>
        </div>
        <Switch
          id="remote-access-switch"
          data-testid="remote-access-switch"
          checked={status.enabled}
          disabled={!canTurnOn}
          onCheckedChange={(checked) => void setEnabled(checked)}
        />
      </div>
      {pending.length > 0 && (
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400" data-testid="remote-access-pending-count">
          {pending.length === 1 ? '1 assistant is waiting for your approval.' : `${pending.length} assistants are waiting for your approval.`}
        </p>
      )}
      <p
        className="text-xs"
        data-testid="remote-access-status"
        data-state={status.enabled ? status.state : 'off'}
        data-receiving={status.enabled && status.state === 'connected' ? String(status.receiving !== false) : undefined}
      >
        <Cloud className="mr-1 inline h-3 w-3" />
        {statusText(status.enabled ? status : { ...status, state: 'off' })}
      </p>

      {status.enabled && status.connectorUrl && (
        <div className="space-y-1 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Add Prose to an assistant with this URL:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 text-xs" data-testid="remote-connector-url">
              {status.connectorUrl}
            </code>
            <CopyButton value={status.connectorUrl} aria-label="Copy the Prose URL" />
          </div>
          <p className="text-xs text-muted-foreground">
            ChatGPT: Settings → Apps &amp; Connectors → Advanced settings → Developer mode, then Create, with OAuth.
            claude.ai: Settings → Connectors → Add custom connector. Sign in with your Prose email and allow it; it
            then appears below, connected.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-xs text-amber-600 dark:text-amber-400">{notice}</p>}

      {pending.length > 0 && (
        <ul className="space-y-2" aria-label="Waiting for approval">
          {pending.map((c) => (
            <li key={c.clientId} className="space-y-2 rounded-md border border-amber-500/60 px-3 py-2" data-testid="remote-connection-row" data-status="pending">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.clientName} wants to use Prose</p>
                  <p className="text-xs text-muted-foreground">{identity(c)}</p>
                </div>
                <Button size="sm" onClick={() => void approve(c)} aria-label={`Approve ${c.clientName}`}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void forget(c, 'deny')} aria-label={`Decline ${c.clientName}`}>
                  Decline
                </Button>
              </div>
              <ScopeChoices
                name={c.clientName}
                scopes={drafts[c.clientId] ?? []}
                onChange={(scopes) => setDrafts((d) => ({ ...d, [c.clientId]: scopes }))}
              />
            </li>
          ))}
        </ul>
      )}

      {approved.length > 0 && (
        <ul className="space-y-2" aria-label="Remote connections">
          {approved.map((c) => (
            <li key={c.clientId} className="space-y-2 rounded-md border border-border px-3 py-2" data-testid="remote-connection-row" data-status="approved">
              <div className="flex items-center gap-2">
                {c.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Verified" />}
                {renaming?.clientId === c.clientId ? (
                  <>
                    <Input
                      value={renaming.label}
                      onChange={(e) => setRenaming({ clientId: c.clientId, label: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      aria-label="New name"
                      maxLength={100}
                      autoFocus
                    />
                    <Button size="sm" onClick={() => void rename()} disabled={!renaming.label.trim()}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.label !== c.clientName ? `${c.clientName} · ` : ''}
                        {lastUsed(c)}
                      </p>
                      {fresh.has(c.clientId) && (
                        <p className="text-xs font-medium text-amber-600 dark:text-amber-400" data-testid="remote-connection-new">
                          New: connected after you allowed it in your browser. {identity(c)}. Not you? Remove it.
                        </p>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setRenaming({ clientId: c.clientId, label: c.label })}
                      aria-label={`Rename ${c.label}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRemoving(c)}
                      aria-label={`Remove ${c.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              <ScopeChoices name={c.label} scopes={c.scopes} onChange={(scopes) => void updateScopes(c, scopes)} />
            </li>
          ))}
        </ul>
      )}

      {denied.length > 0 && (
        <ul className="space-y-2" aria-label="Declined">
          {denied.map((c) => (
            <li key={c.clientId} className="flex items-center gap-2 rounded-md border border-border px-3 py-2" data-testid="remote-connection-row" data-status="denied">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{c.clientName}</p>
                <p className="text-xs text-muted-foreground">Declined</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(c)} aria-label={`Remove ${c.clientName}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It loses access right away, and has to be connected again to come back. What it already did in Prose stays
              attributed to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (removing) void forget(removing, 'remove')
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
