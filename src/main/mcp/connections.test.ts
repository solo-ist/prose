// @vitest-environment node
/** The MCP connection store (#1236): hashes only, revocable, one name per connection. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { McpConnectionStore, MCP_TOKEN_PREFIX } from './connections'

let dir: string
let file: string
let clock: number
const store = () => new McpConnectionStore(file, () => clock)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prose-1236-'))
  file = join(dir, 'mcp-connections.json')
  clock = 1_000_000
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('McpConnectionStore', () => {
  it('stores only the token hash, in an owner-only file, and shows the token once', () => {
    const { connection, token } = store().create('Codex on the Mac')
    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true)
    expect(token.length).toBeGreaterThan(40)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(token)
    expect(raw).toContain(createHash('sha256').update(token).digest('hex'))
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(connection).toEqual({ id: expect.any(String), label: 'Codex on the Mac', createdAt: clock, lastUsedAt: null })
    expect(Object.keys(store().list()[0]).sort()).toEqual(['createdAt', 'id', 'label', 'lastUsedAt'])
  })

  it('resolves a token to its connection and records the use', () => {
    const s = store()
    const { connection, token } = s.create('Claude Code')
    clock += 5_000
    expect(s.resolve(token)).toEqual({ ...connection, lastUsedAt: clock })
    expect(store().list()[0].lastUsedAt).toBe(clock) // written: the first use
    expect(s.resolve(`${token}x`)).toBeNull()
    expect(s.resolve(token.slice(MCP_TOKEN_PREFIX.length))).toBeNull()
    expect(s.resolve('')).toBeNull()
  })

  it('writes the last use at most once a minute, and on flush', () => {
    const s = store()
    const { token } = s.create('Open WebUI')
    s.resolve(token)
    const first = clock
    clock += 10_000
    s.resolve(token)
    expect(store().list()[0].lastUsedAt).toBe(first)
    s.flush()
    expect(store().list()[0].lastUsedAt).toBe(clock)
    clock += 61_000
    s.resolve(token)
    expect(store().list()[0].lastUsedAt).toBe(clock)
  })

  it('revoking stops the token at once', () => {
    const s = store()
    const a = s.create('LibreChat')
    const b = s.create('Codex')
    s.revoke(a.connection.id)
    expect(s.resolve(a.token)).toBeNull()
    expect(s.resolve(b.token)?.id).toBe(b.connection.id)
    expect(store().list().map((c) => c.label)).toEqual(['Codex'])
    expect(() => s.revoke(a.connection.id)).toThrow('No such connection')
  })

  it('renames, and keeps names non-empty and unique', () => {
    const s = store()
    const a = s.create('  Codex\u0007  ')
    expect(a.connection.label).toBe('Codex')
    s.create('Claude Code')
    expect(() => s.create('codex')).toThrow('already exists')
    expect(() => s.create('   ')).toThrow('needs a name')
    expect(() => s.rename(a.connection.id, 'Claude code')).toThrow('already exists')
    expect(s.rename(a.connection.id, 'Codex (laptop)').label).toBe('Codex (laptop)')
    expect(s.rename(a.connection.id, 'codex (Laptop)').label).toBe('codex (Laptop)') // its own name, recased
    expect(s.resolve(a.token)?.label).toBe('codex (Laptop)')
  })

  it('treats a missing or corrupt file as no connections', () => {
    expect(store().list()).toEqual([])
    writeFileSync(file, '{not json')
    expect(store().list()).toEqual([])
    writeFileSync(file, JSON.stringify({ version: 1, connections: [{ id: 'x', label: 'y', tokenHash: 'nothex' }] }))
    expect(store().list()).toEqual([])
  })
})
