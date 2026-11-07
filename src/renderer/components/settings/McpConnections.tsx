/**
 * Settings → Integrations → Connections (#1236): one named, revocable token
 * per MCP client. Everything a client does in Prose is attributed to its
 * connection's name; revoking a connection stops its token at once. The
 * token is shown once, right after the connection is created.
 */

import { useCallback, useEffect, useState } from 'react'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { CopyButton } from '../ui/copy-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
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
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import type { McpConnection } from '../../types'
import { MCP_SETUP_CLIENTS, mcpSetupSnippet, type McpSetupClient } from './mcpSetupSnippets'

interface Endpoint {
  available: boolean
  port: number
  url: string
}

function lastUsed(connection: McpConnection): string {
  return connection.lastUsedAt ? `Last used ${new Date(connection.lastUsedAt).toLocaleString()}` : 'Never used'
}

export function McpConnections() {
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [created, setCreated] = useState<{ connection: McpConnection; token: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null)
  const [revoking, setRevoking] = useState<McpConnection | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [client, setClient] = useState<McpSetupClient>('claude-code')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const api = window.api
    if (!api?.mcpListConnections || !api.mcpEndpoint) return
    const [listed, info] = await Promise.all([api.mcpListConnections(), api.mcpEndpoint()])
    if (listed.ok) setConnections(listed.value)
    else setError(listed.error)
    setEndpoint(info)
  }, [])

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [load])

  const create = async () => {
    if (!window.api?.mcpCreateConnection) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.mcpCreateConnection(newLabel)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCreated(result.value)
      setNewLabel('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const rename = async () => {
    if (!renaming || !window.api?.mcpRenameConnection) return
    setError(null)
    const result = await window.api.mcpRenameConnection(renaming.id, renaming.label)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRenaming(null)
    await load()
  }

  const revoke = async () => {
    if (!revoking || !window.api?.mcpRevokeConnection) return
    setRevokeError(null)
    const result = await window.api.mcpRevokeConnection(revoking.id)
    if (!result.ok) {
      // Keep the dialog open on the failure: the connection still works.
      setRevokeError(result.error)
      return
    }
    if (created?.connection.id === revoking.id) setCreated(null)
    setRevoking(null)
    await load()
  }

  // Before the endpoint answers (or when it isn't running), a placeholder rather than a guessed port.
  const url = endpoint?.url || 'http://localhost:<port>/mcp'

  return (
    <div className="space-y-4" data-testid="mcp-connections">
      <div className="space-y-0.5">
        <Label>Connections</Label>
        <p className="text-xs text-muted-foreground">
          Give each MCP client its own token. What a client does in Prose is attributed to the connection's name, and
          revoking a connection stops its token at once.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newLabel.trim()) void create()
          }}
          placeholder="Name, e.g. Codex on this Mac"
          aria-label="Connection name"
          data-testid="mcp-connection-name"
          maxLength={100}
        />
        <Button onClick={() => void create()} disabled={busy || !newLabel.trim()} data-testid="mcp-connection-add">
          <Plus className="h-4 w-4 mr-2" />
          Add
        </Button>
      </div>

      {created && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2" data-testid="mcp-connection-created">
          <p className="text-sm">
            Token for <span className="font-medium">{created.connection.label}</span>. Copy it now: Prose won't show it
            again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs" data-testid="mcp-connection-token">
              {created.token}
            </code>
            <CopyButton value={created.token} aria-label="Copy token" />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
            Done
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {connections.length > 0 && (
        <ul className="space-y-2" aria-label="Connections">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              data-testid="mcp-connection-row"
            >
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              {renaming?.id === connection.id ? (
                <>
                  <Input
                    value={renaming.label}
                    onChange={(e) => setRenaming({ id: connection.id, label: e.target.value })}
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
                    <p className="truncate text-sm font-medium">{connection.label}</p>
                    <p className="text-xs text-muted-foreground">{lastUsed(connection)}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setRenaming({ id: connection.id, label: connection.label })}
                    aria-label={`Rename ${connection.label}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRevoking(connection)}
                    aria-label={`Revoke ${connection.label}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <Label>Set up a client</Label>
        <p className="text-xs text-muted-foreground">
          {endpoint?.available
            ? `Prose is listening at ${url}.`
            : 'The MCP endpoint is not running in this window (its port may be taken by another Prose).'}
        </p>
        <Tabs value={client} onValueChange={(value) => setClient(value as McpSetupClient)}>
          <TabsList className="grid w-full grid-cols-4">
            {MCP_SETUP_CLIENTS.map((c) => (
              <TabsTrigger key={c.id} value={c.id}>
                {c.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {MCP_SETUP_CLIENTS.map((c) => {
            const snippet = mcpSetupSnippet(c.id, url, created?.token)
            return (
              <TabsContent key={c.id} value={c.id} className="space-y-2">
                <div className="flex items-start gap-2">
                  <pre
                    className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-xs"
                    data-testid={`mcp-setup-${c.id}`}
                  >
                    {snippet.text}
                  </pre>
                  <CopyButton value={snippet.text} aria-label={`Copy ${c.name} setup`} />
                </div>
                <p className="text-xs text-muted-foreground">{snippet.note}</p>
              </TabsContent>
            )
          })}
        </Tabs>
      </div>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (open) return
          setRevoking(null)
          setRevokeError(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Clients using this connection's token lose access right away. What they already did in Prose stays
              attributed to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError && (
            <p className="text-sm text-destructive" role="alert">
              Not revoked: {revokeError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Close only once the revoke has succeeded (revoke() does it).
                e.preventDefault()
                void revoke()
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
