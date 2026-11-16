/**
 * Remote MCP connections (#1239; design docs/architecture/mcp-relay.md §6):
 * the clients that reach Prose through the gateway's relay (ChatGPT,
 * claude.ai), and the Remote access switch.
 *
 * The gateway's consent is the first gate; this store is the second. A client
 * the writer hasn't approved here reaches nothing: its first call records it
 * as pending, and it stays refused until the writer approves it, with the
 * scopes the writer picks. For those clients even a stolen OAuth token, or a
 * compromised gateway account, reaches nothing the writer hasn't approved in
 * the app.
 *
 * The exception (#1304) is the short list of trusted clients
 * (shared/mcp/trustedRemoteClients.ts): one of those is connected on its
 * first call, with the scopes the writer granted on the gateway's consent
 * page, and stays counted as unreviewed until the writer has seen it here.
 * For them the gateway's sign-in and consent are the only gate.
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
      lastUsedAt: null,
      reviewedAt: null
    }
    data.connections.push(row)
    this.save()
    return { ...row }
  }

  /**
   * A first call from a trusted client (#1304): connect it without the
   * writer's approval, with the scopes granted on the gateway's consent page
   * (`read` always). It is unreviewed until the writer has seen it. The
   * caller decides trust; a client already known here is never changed.
   */
  connectTrusted(client: { id: string; name: string; verified: boolean }, scopes: readonly unknown[]): RemoteConnection {
    const data = this.load()
    if (data.connections.some((c) => c.clientId === client.id)) throw new RemoteConnectionError('This client is already known')
    const name = cleanActorText(client.name) || 'Remote client'
    const now = this.now()
    const row: RemoteConnection = {
      id: remoteConnectionId(client.id),
      clientId: client.id,
      clientName: name,
      verified: client.verified,
      label: this.freeLabel(name),
      status: 'approved',
      scopes: remoteScopesOf(['read', ...scopes]),
      firstSeenAt: now,
      approvedAt: now,
      lastUsedAt: null,
      reviewedAt: null
    }
    data.connections.push(row)
    this.save()
    return { ...row, scopes: [...row.scopes] }
  }

  /** The writer has seen the connections: nothing is unreviewed any more. Returns whether anything changed. */
  markReviewed(): boolean {
    const unreviewed = this.load().connections.filter((c) => c.status === 'approved' && c.reviewedAt === null)
    if (unreviewed.length === 0) return false
    const now = this.now()
    for (const row of unreviewed) row.reviewedAt = now
    this.save()
    return true
  }

  /** The writer approves a client, with the scopes it may use (`read` always). */
  approve(clientId: string, scopes: readonly unknown[], label?: string): RemoteConnection {
    const row = this.find(clientId)
    row.status = 'approved'
    row.scopes = this.validScopes(scopes)
    if (label !== undefined) row.label = this.validLabel(label, clientId)
    row.approvedAt = this.now()
    row.reviewedAt = row.approvedAt
    this.save()
    return { ...row }
  }

  /** Change an approved client's scopes or label. */
  update(clientId: string, change: { scopes?: readonly unknown[]; label?: string }): RemoteConnection {
    const row = this.find(clientId)
    if (row.status !== 'approved') throw new RemoteConnectionError('Approve this client first')
    if (change.scopes !== undefined) row.scopes = this.validScopes(change.scopes)
    if (change.label !== undefined) row.label = this.validLabel(change.label, clientId)
    row.reviewedAt ??= this.now()
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

  /**
   * Forget a client: its calls are refused at once. The caller revokes its
   * tokens at the gateway, so it comes back (as pending, or connected if it
   * is trusted) only after the writer consents there again.
   */
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

  /** `name`, or `name 2`, `name 3`… when an approved connection already has it (labels are unique). */
  private freeLabel(name: string): string {
    const taken = new Set(
      this.load()
        .connections.filter((c) => c.status === 'approved')
        .map((c) => c.label.toLowerCase())
    )
    if (!taken.has(name.toLowerCase())) return name
    for (let n = 2; ; n++) {
      const candidate = `${name} ${n}`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
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
      ? parsed.connections.filter(isConnection).map((c) => ({
          ...c,
          scopes: remoteScopesOf(c.scopes),
          // A row written before #1304 was approved by the writer: it has been seen.
          reviewedAt: typeof c.reviewedAt === 'number' ? c.reviewedAt : c.status === 'approved' ? (c.approvedAt ?? c.firstSeenAt) : null
        }))
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
