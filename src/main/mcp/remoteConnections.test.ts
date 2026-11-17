// @vitest-environment node
/** Remote connections (#1239): the second gate's store — pending, approved with scopes, denied, removed. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_PENDING, RemoteConnectionStore, remoteConnectionId } from './remoteConnections'

let dir: string
let file: string
let clock: number
const store = () => new RemoteConnectionStore(file, () => clock)
const chatgpt = { id: 'https://chatgpt.com/oauth/client.json', name: 'ChatGPT', verified: true }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prose-1239-'))
  file = join(dir, 'mcp-remote.json')
  clock = 1_000_000
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('RemoteConnectionStore', () => {
  it('is off by default, writes nothing until changed, and keeps one device id', () => {
    const s = store()
    expect(s.enabled).toBe(false)
    expect(s.list()).toEqual([])
    expect(existsSync(file)).toBe(false)
    const device = s.deviceId
    expect(device).toMatch(/^[A-Za-z0-9_-]{24}$/)
    s.setEnabled(true)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(store().enabled).toBe(true)
    expect(store().deviceId).toBe(device)
  })

  it('records an unknown client as pending, once', () => {
    const s = store()
    const row = s.notePending(chatgpt)
    expect(row).toMatchObject({
      id: 'remote:https://chatgpt.com/oauth/client.json',
      clientId: chatgpt.id,
      clientName: 'ChatGPT',
      label: 'ChatGPT',
      verified: true,
      status: 'pending',
      scopes: [],
      firstSeenAt: clock,
      approvedAt: null
    })
    clock += 1000
    s.notePending(chatgpt)
    expect(store().list()).toHaveLength(1)
  })

  it('approves with the writer’s scopes, read always included; denies; removes', () => {
    const s = store()
    s.notePending(chatgpt)
    expect(s.approve(chatgpt.id, ['comment'])).toMatchObject({ status: 'approved', scopes: ['read', 'comment'], approvedAt: clock })
    expect(() => s.approve(chatgpt.id, ['admin'])).toThrow('Unknown permission')
    expect(s.update(chatgpt.id, { scopes: [], label: 'ChatGPT (work)' })).toMatchObject({ scopes: ['read'], label: 'ChatGPT (work)' })
    expect(store().get(chatgpt.id)).toMatchObject({ label: 'ChatGPT (work)', scopes: ['read'] })
    expect(s.deny(chatgpt.id)).toMatchObject({ status: 'denied', scopes: [] })
    expect(() => s.update(chatgpt.id, { scopes: ['read'] })).toThrow('Approve this client first')
    s.remove(chatgpt.id)
    expect(store().get(chatgpt.id)).toBeNull()
    expect(() => s.remove(chatgpt.id)).toThrow('No such connection')
  })

  it('connects a trusted client with its granted scopes, unreviewed until the writer has seen it (#1304)', () => {
    const s = store()
    expect(s.connectTrusted(chatgpt, ['comment', 'offline_access'])).toMatchObject({
      id: 'remote:https://chatgpt.com/oauth/client.json',
      label: 'ChatGPT',
      status: 'approved',
      scopes: ['read', 'comment'],
      firstSeenAt: clock,
      approvedAt: clock,
      reviewedAt: null
    })
    // Known already: never changed by a second connect.
    expect(() => s.connectTrusted(chatgpt, ['propose'])).toThrow('already known')
    clock += 5000
    expect(s.markReviewed()).toBe(true)
    expect(store().get(chatgpt.id)).toMatchObject({ reviewedAt: clock, scopes: ['read', 'comment'] })
    expect(s.markReviewed()).toBe(false)
  })

  it('a writer’s own approval or change counts as seen; a trusted client’s label never collides', () => {
    const s = store()
    s.notePending({ id: 'a', name: 'ChatGPT', verified: false })
    expect(s.approve('a', ['read'])).toMatchObject({ reviewedAt: clock })
    expect(s.connectTrusted(chatgpt, ['read'])).toMatchObject({ label: 'ChatGPT 2', reviewedAt: null })
    clock += 1
    expect(s.update(chatgpt.id, { scopes: ['comment'] })).toMatchObject({ reviewedAt: clock })
  })

  it('treats an approved row written before #1304 as seen', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        enabled: true,
        deviceId: 'd'.repeat(24),
        connections: [
          { id: 'remote:a', clientId: 'a', clientName: 'A', verified: false, label: 'A', status: 'approved', scopes: ['read'], firstSeenAt: 5, approvedAt: 7, lastUsedAt: null },
          { id: 'remote:b', clientId: 'b', clientName: 'B', verified: false, label: 'B', status: 'pending', scopes: [], firstSeenAt: 5, approvedAt: null, lastUsedAt: null }
        ]
      })
    )
    expect(store().get('a')?.reviewedAt).toBe(7)
    expect(store().get('b')?.reviewedAt).toBeNull()
    expect(store().markReviewed()).toBe(false)
  })

  it('cleans names and refuses a label another approved connection has', () => {
    const s = store()
    s.notePending({ id: 'a', name: 'Claude\u0000\n', verified: false })
    s.notePending({ id: 'b', name: 'Other', verified: false })
    expect(s.get('a')?.clientName).toBe('Claude')
    s.approve('a', ['read'], 'Claude')
    expect(() => s.approve('b', ['read'], 'claude')).toThrow('already exists')
    expect(() => s.approve('b', ['read'], '   ')).toThrow('needs a name')
  })

  it('keeps at most 20 pending clients, dropping the oldest', () => {
    const s = store()
    for (let i = 0; i < MAX_PENDING + 3; i++) {
      clock += 1
      s.notePending({ id: `client-${i}`, name: `Client ${i}`, verified: false })
    }
    const ids = store().list().map((c) => c.clientId)
    expect(ids).toHaveLength(MAX_PENDING)
    expect(ids).not.toContain('client-0')
    expect(ids).toContain(`client-${MAX_PENDING + 2}`)
  })

  it('derives a connection id that fits the actor, hashing a long client id', () => {
    expect(remoteConnectionId('abc')).toBe('remote:abc')
    const long = `https://example.com/${'x'.repeat(120)}`
    expect(remoteConnectionId(long)).toMatch(/^remote:sha256:[0-9a-f]{40}$/)
    expect(remoteConnectionId(long)).toBe(remoteConnectionId(long))
  })

  it('survives a corrupt file and drops malformed rows', () => {
    writeFileSync(file, '{not json')
    expect(store().list()).toEqual([])
    writeFileSync(file, JSON.stringify({ version: 1, enabled: true, deviceId: 'd'.repeat(24), connections: [{ id: 1 }, null] }))
    expect(store().list()).toEqual([])
    expect(store().enabled).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).deviceId).toBe('d'.repeat(24))
  })
})
