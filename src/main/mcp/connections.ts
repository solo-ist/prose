/**
 * MCP connections (#1236): a named, revocable token per MCP client, created
 * by the writer in Settings → Integrations. The connection is the MCP
 * identity — its label is what every record the client makes is attributed
 * to — so a client can't claim to be anything else.
 *
 * Stored at `<userData>/mcp-connections.json` (mode 0600). A record holds the
 * SHA-256 of its token, never the token: the token is shown once, when the
 * connection is created, and a revoked connection is deleted, so its token
 * fails on the next request.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { cleanActorText } from '../../shared/review/actor'

export interface McpConnection {
  id: string
  label: string
  createdAt: number
  lastUsedAt: number | null
}

interface StoredConnection extends McpConnection {
  tokenHash: string
}

interface StoreFile {
  version: 1
  connections: StoredConnection[]
}

/** Prefixed so secret scanners and people can tell what a leaked token is. */
export const MCP_TOKEN_PREFIX = 'prose_mcp_'

/** `lastUsedAt` is written at most this often per connection; reads see it at once. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000

export class McpConnectionError extends Error {}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

function publicView({ id, label, createdAt, lastUsedAt }: StoredConnection): McpConnection {
  return { id, label, createdAt, lastUsedAt }
}

export class McpConnectionStore {
  private connections: StoredConnection[] | null = null
  private lastWritten = new Map<string, number>()

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {}

  list(): McpConnection[] {
    return this.load().map(publicView)
  }

  /** Create a connection; the token in the result is the only copy that ever leaves this store. */
  create(label: string): { connection: McpConnection; token: string } {
    const connections = this.load()
    const name = this.validLabel(label)
    const token = MCP_TOKEN_PREFIX + randomBytes(32).toString('base64url')
    const record: StoredConnection = {
      id: randomUUID(),
      label: name,
      tokenHash: hashToken(token).toString('hex'),
      createdAt: this.now(),
      lastUsedAt: null
    }
    connections.push(record)
    this.save()
    return { connection: publicView(record), token }
  }

  rename(id: string, label: string): McpConnection {
    const record = this.find(id)
    record.label = this.validLabel(label, id)
    this.save()
    return publicView(record)
  }

  /** Revoke a connection: it is deleted, so its token stops working on the next request. */
  revoke(id: string): void {
    const connections = this.load()
    const index = connections.findIndex((c) => c.id === id)
    if (index === -1) throw new McpConnectionError('No such connection')
    connections.splice(index, 1)
    this.lastWritten.delete(id)
    this.save()
  }

  /** The connection a bearer token belongs to, or null. Records the use. */
  resolve(token: string): McpConnection | null {
    if (!token.startsWith(MCP_TOKEN_PREFIX)) return null
    const presented = hashToken(token)
    let match: StoredConnection | null = null
    for (const record of this.load()) {
      const stored = Buffer.from(record.tokenHash, 'hex')
      // Compare every record, in constant time, so timing says nothing about which (if any) matched.
      if (stored.length === presented.length && timingSafeEqual(stored, presented)) match = record
    }
    if (!match) return null
    const now = this.now()
    match.lastUsedAt = now
    if (now - (this.lastWritten.get(match.id) ?? 0) >= LAST_USED_WRITE_INTERVAL_MS) {
      this.lastWritten.set(match.id, now)
      this.save()
    }
    return publicView(match)
  }

  /** Write any `lastUsedAt` still held in memory (on quit). */
  flush(): void {
    if (this.connections) this.save()
  }

  private find(id: string): StoredConnection {
    const record = this.load().find((c) => c.id === id)
    if (!record) throw new McpConnectionError('No such connection')
    return record
  }

  private validLabel(label: string, exceptId?: string): string {
    const name = cleanActorText(label)
    if (!name) throw new McpConnectionError('A connection needs a name')
    const taken = this.load().some((c) => c.id !== exceptId && c.label.toLowerCase() === name.toLowerCase())
    if (taken) throw new McpConnectionError(`A connection named "${name}" already exists`)
    return name
  }

  private load(): StoredConnection[] {
    if (this.connections) return this.connections
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch {
      parsed = null // missing or unreadable: no connections yet
    }
    const rows = (parsed as Partial<StoreFile> | null)?.connections
    this.connections = Array.isArray(rows)
      ? rows.filter(
          (r): r is StoredConnection =>
            !!r && typeof r.id === 'string' && typeof r.label === 'string' && /^[0-9a-f]{64}$/.test(String(r.tokenHash))
        )
      : []
    return this.connections
  }

  private save(): void {
    const data: StoreFile = { version: 1, connections: this.load() }
    const tmp = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.filePath)
    chmodSync(this.filePath, 0o600)
  }
}
