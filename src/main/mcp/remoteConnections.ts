/**
 * Remote MCP connections (#1239; design docs/architecture/mcp-relay.md §6):
 * the clients that reach Prose through the gateway's relay (ChatGPT,
 * claude.ai), and the Remote access switch.
 *
 * The gateway's consent is the first gate; this store is the second. A client
 * the writer hasn't approved here reaches nothing: its first call records it
 * as pending, and it stays refused until the writer approves it, with the
 * scopes the writer picks. Even a stolen OAuth token, or a compromised
 * gateway account, reaches nothing the writer hasn't approved in the app.
 *
 * Stored at `<userData>/mcp-remote.json` (mode 0600), written atomically. It
 * holds no secret: the relay authenticates with the gateway session, and the
 * OAuth tokens live with the client and (hashed) at the gateway.
 */

import { createHash, randomBytes } from 'crypto'
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { cleanActorText } from '../../shared/review/actor'
import { isRemoteScope, remoteScopesOf, type RemoteScope } from '../../shared/mcp/remoteScopes'
import type { RemoteConnection, RemoteConnectionStatus } from '../../shared/mcp/remoteAccess'

export type { RemoteConnection, RemoteConnectionStatus }

interface StoreFile {
  version: 1
  enabled: boolean
  deviceId: string
  connections: RemoteConnection[]
}

/** Pending clients kept at most; the oldest makes way. */
export const MAX_PENDING = 20
/** The actor's text cap (cleanActorText). */
const MAX_ID = 100
const LAST_USED_WRITE_INTERVAL_MS = 60_000

export class RemoteConnectionError extends Error {}

/** The connection id an actor carries for a gateway client id. */
export function remoteConnectionId(clientId: string): string {
  const plain = `remote:${clientId}`
  if (plain.length <= MAX_ID && cleanActorText(plain) === plain) return plain
  return `remote:sha256:${createHash('sha256').update(clientId, 'utf8').digest('hex').slice(0, 40)}`
}

function isConnection(r: unknown): r is RemoteConnection {
  const c = r as Partial<RemoteConnection> | null
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.clientId === 'string' &&
    typeof c.label === 'string' &&
    (c.status === 'pending' || c.status === 'approved' || c.status === 'denied') &&
    Array.isArray(c.scopes)
  )
}

export class RemoteConnectionStore {
  private data: StoreFile | null = null
  private lastWritten = new Map<string, number>()

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {}

  /** Remote access: whether the desktop dials out. Off by default. */
  get enabled(): boolean {
    return this.load().enabled
  }

  setEnabled(enabled: boolean): void {
    this.load().enabled = enabled
    this.save()
  }

  /** This install's stable id for the relay (one socket per account + device). */
  get deviceId(): string {
    return this.load().deviceId
  }

  list(): RemoteConnection[] {
    return this.load().connections.map((c) => ({ ...c, scopes: [...c.scopes] }))
  }

  get(clientId: string): RemoteConnection | null {
    const found = this.load().connections.find((c) => c.clientId === clientId)
    return found ? { ...found, scopes: [...found.scopes] } : null
  }

  /**
   * A call from a client the writer hasn't approved: remember it as pending
   * (once; a pending row follows the client's current name). Returns the row.
   */
  notePending(client: { id: string; name: string; verified: boolean }): RemoteConnection {
    const data = this.load()
    const existing = data.connections.find((c) => c.clientId === client.id)
    const name = cleanActorText(client.name) || 'Remote client'
    if (existing) {
      if (existing.status === 'pending' && (existing.clientName !== name || existing.verified !== client.verified)) {
        existing.clientName = name
        existing.label = name
        existing.verified = client.verified
        this.save()
      }
      return { ...existing }
    }
    const pending = data.connections.filter((c) => c.status === 'pending')
    if (pending.length >= MAX_PENDING) {
      const oldest = pending.reduce((a, b) => (a.firstSeenAt <= b.firstSeenAt ? a : b))
      data.connections.splice(data.connections.indexOf(oldest), 1)
    }
    const row: RemoteConnection = {
      id: remoteConnectionId(client.id),
      clientId: client.id,
      clientName: name,
      verified: client.verified,
      label: name,
      status: 'pending',
      scopes: [],
      firstSeenAt: this.now(),
      approvedAt: null,
      lastUsedAt: null
    }
    data.connections.push(row)
    this.save()
    return { ...row }
  }

  /** The writer approves a client, with the scopes it may use (`read` always). */
  approve(clientId: string, scopes: readonly unknown[], label?: string): RemoteConnection {
    const row = this.find(clientId)
    row.status = 'approved'
    row.scopes = this.validScopes(scopes)
    if (label !== undefined) row.label = this.validLabel(label, clientId)
    row.approvedAt = this.now()
    this.save()
    return { ...row }
  }

  /** Change an approved client's scopes or label. */
  update(clientId: string, change: { scopes?: readonly unknown[]; label?: string }): RemoteConnection {
    const row = this.find(clientId)
    if (row.status !== 'approved') throw new RemoteConnectionError('Approve this client first')
    if (change.scopes !== undefined) row.scopes = this.validScopes(change.scopes)
    if (change.label !== undefined) row.label = this.validLabel(change.label, clientId)
    this.save()
    return { ...row }
  }

  /** The writer declines a client: its calls stay refused, and it stays listed so it doesn't ask again. */
  deny(clientId: string): RemoteConnection {
    const row = this.find(clientId)
    row.status = 'denied'
    row.scopes = []
    this.save()
    return { ...row }
  }

  /** Forget a client: its calls are refused at once (it would come back as pending). */
  remove(clientId: string): void {
    const data = this.load()
    const index = data.connections.findIndex((c) => c.clientId === clientId)
    if (index === -1) throw new RemoteConnectionError('No such connection')
    data.connections.splice(index, 1)
    this.lastWritten.delete(clientId)
    this.save()
  }

  /** Record an approved client's use (written at most once a minute). */
  touch(clientId: string): void {
    const row = this.load().connections.find((c) => c.clientId === clientId)
    if (!row) return
    const now = this.now()
    row.lastUsedAt = now
    if (now - (this.lastWritten.get(clientId) ?? 0) >= LAST_USED_WRITE_INTERVAL_MS) {
      this.lastWritten.set(clientId, now)
      this.save()
    }
  }

  flush(): void {
    if (this.data) this.save()
  }

  private find(clientId: string): RemoteConnection {
    const row = this.load().connections.find((c) => c.clientId === clientId)
    if (!row) throw new RemoteConnectionError('No such connection')
    return row
  }

  private validScopes(scopes: readonly unknown[]): RemoteScope[] {
    if (!Array.isArray(scopes) || scopes.some((s) => !isRemoteScope(s))) {
      throw new RemoteConnectionError('Unknown permission')
    }
    return remoteScopesOf(['read', ...scopes])
  }

  private validLabel(label: string, exceptClientId: string): string {
    const name = cleanActorText(label)
    if (!name) throw new RemoteConnectionError('A connection needs a name')
    const taken = this.load().connections.some(
      (c) => c.clientId !== exceptClientId && c.status === 'approved' && c.label.toLowerCase() === name.toLowerCase()
    )
    if (taken) throw new RemoteConnectionError(`A connection named "${name}" already exists`)
    return name
  }

  private load(): StoreFile {
    if (this.data) return this.data
    let parsed: Partial<StoreFile> | null = null
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreFile>
    } catch {
      parsed = null // missing or unreadable: nothing yet
    }
    const deviceId =
      typeof parsed?.deviceId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(parsed.deviceId)
        ? parsed.deviceId
        : randomBytes(18).toString('base64url')
    const connections = Array.isArray(parsed?.connections)
      ? parsed.connections.filter(isConnection).map((c) => ({ ...c, scopes: remoteScopesOf(c.scopes) }))
      : []
    this.data = { version: 1, enabled: parsed?.enabled === true, deviceId, connections }
    // A file without a usable device id gets one now; a missing file is
    // written on its first change (turning Remote access on).
    if (parsed && parsed.deviceId !== deviceId) this.save()
    return this.data
  }

  private save(): void {
    const data = this.load()
    const tmp = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.filePath)
    chmodSync(this.filePath, 0o600)
  }
}
