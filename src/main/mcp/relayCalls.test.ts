// @vitest-environment node
/**
 * Relayed calls (#1239): the desktop's second gate. Driven by the MCP SDK's
 * own client through a stand-in for the gateway (it frames each request the
 * way gateway/src/relay/mcp.ts does), for both protocol eras.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { RELAY_CALL_ERROR, RelayCallHandler, parseCallFrame, type RelayCallFrame } from './relayCalls'
import { RemoteConnectionStore } from './remoteConnections'
import type { McpAgentActor } from '../../shared/review/actor'
import type { ToolResult } from '../../shared/tools/types'

const CLIENT = { id: 'https://chatgpt.com/oauth/client.json', name: 'ChatGPT', verified: true }

let dir: string
let store: RemoteConnectionStore
let handler: RelayCallHandler
let pending: string[]
const invoked: Array<{ name: string; args: unknown; actor: McpAgentActor }> = []

const RESULTS: Record<string, ToolResult> = {
  read_document: { success: true, data: { nodes: [{ id: 'n1', type: 'paragraph', content: 'Hello' }], markdown: 'Hello\n' } },
  add_comment: { success: true, data: { id: 'c1', nodeId: 'n1', comment: 'Hi' } }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'prose-1239-calls-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

beforeEach(() => {
  store = new RemoteConnectionStore(join(dir, `${randomUUID()}.json`))
  pending = []
  invoked.length = 0
  handler = new RelayCallHandler({
    store,
    version: '9.8.7',
    invokeTool: async (name, args, actor) => {
      invoked.push({ name, args, actor })
      return RESULTS[name] ?? { success: false, error: `no stub for ${name}` }
    },
    onPending: (c) => pending.push(c.clientId)
  })
})
afterEach(() => handler.close())

/** What the gateway does with one HTTP request: frame it, wait, answer with the client's own id. */
function viaGateway(scopes: string[], client = CLIENT): typeof fetch {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? 'null')) as { id?: unknown; method?: string; params?: Record<string, unknown> }
    if (body.id === undefined) return new Response(null, { status: 202 })
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => {
      if (/^mcp-/.test(key)) headers[key] = value
    })
    const frame = parseCallFrame({ type: 'call', id: randomUUID(), client, scopes, method: body.method, params: body.params, headers })
    if (!frame) throw new Error('the stand-in gateway built a bad frame')
    const answer = await handler.handle(frame)
    void input
    return Response.json({ jsonrpc: '2.0', id: body.id, ...answer })
  }
}

async function connect(scopes: string[], pin?: string): Promise<Client> {
  const client = new Client({ name: 'relay-test', version: '1.0.0' }, pin ? { versionNegotiation: { mode: { pin } } } : {})
  await client.connect(new StreamableHTTPClientTransport(new URL('https://gateway.test/mcp'), { fetch: viaGateway(scopes) }))
  return client
}

function frame(method: string, params?: Record<string, unknown>, scopes = ['read', 'comment']): RelayCallFrame {
  return parseCallFrame({ type: 'call', id: randomUUID(), client: CLIENT, scopes, method, params, headers: { 'MCP-Protocol-Version': '2025-11-25' } })!
}

describe('a client the writer has not approved', () => {
  it('is recorded as pending and refused, and runs nothing', async () => {
    const answer = await handler.handle(frame('tools/call', { name: 'read_document', arguments: {} }))
    expect(answer).toEqual({
      error: { code: RELAY_CALL_ERROR.NOT_APPROVED, message: 'Approve ChatGPT in Prose → Settings → Integrations → Connections, then try again.' }
    })
    expect(store.get(CLIENT.id)).toMatchObject({ status: 'pending', clientName: 'ChatGPT', verified: true })
    expect(pending).toEqual([CLIENT.id])
    // Asking again doesn't record it twice.
    await handler.handle(frame('tools/list'))
    expect(pending).toEqual([CLIENT.id])
    expect(invoked).toEqual([])
  })

  it('stays refused once declined', async () => {
    store.notePending(CLIENT)
    store.deny(CLIENT.id)
    const answer = await handler.handle(frame('tools/list'))
    expect(answer).toMatchObject({ error: { code: RELAY_CALL_ERROR.DECLINED } })
  })
})

describe.each([
  ['2025-era (initialize)', undefined],
  ['2026-07-28', '2026-07-28']
])('an approved client, %s', (_label, pin) => {
  beforeEach(() => {
    store.notePending(CLIENT)
    store.approve(CLIENT.id, ['read'], 'ChatGPT on the web')
  })

  it('reads with read, but cannot comment although its token could', async () => {
    const client = await connect(['read', 'comment'], pin)
    try {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('read_document')
      expect(names).not.toContain('add_comment')
      expect(names).not.toContain('open_file')
      expect(names).not.toContain('select_tab')

      const read = await client.callTool({ name: 'read_document', arguments: {} })
      expect(read.isError).toBeFalsy()
      expect((read.structuredContent as { markdown: string }).markdown).toBe('Hello\n')

      const comment = await client.callTool({ name: 'add_comment', arguments: { nodeId: 'n1', comment: 'Hi' } })
      expect(comment.isError).toBe(true)
      expect(invoked.map((c) => c.name)).toEqual(['read_document'])
    } finally {
      await client.close()
    }
  })

  it('calls carry the relay actor: the connection, the writer’s label, the registered name', async () => {
    store.update(CLIENT.id, { scopes: ['comment'] })
    const client = await connect(['read', 'comment'], pin)
    try {
      const added = await client.callTool({ name: 'add_comment', arguments: { nodeId: 'n1', comment: 'Hi' } })
      expect(added.isError).toBeFalsy()
    } finally {
      await client.close()
    }
    expect(invoked.at(-1)?.actor).toEqual({
      kind: 'mcp-agent',
      connectionId: 'remote:https://chatgpt.com/oauth/client.json',
      connectionLabel: 'ChatGPT on the web',
      client: 'ChatGPT',
      via: 'relay'
    })
    expect(store.get(CLIENT.id)?.lastUsedAt).toEqual(expect.any(Number))
  })

  it('gets only what both gates allow: the token’s scopes narrow the writer’s', async () => {
    store.update(CLIENT.id, { scopes: ['comment', 'propose'] })
    const client = await connect(['read'], pin)
    try {
      const names = (await client.listTools()).tools.map((t) => t.name)
      expect(names).toContain('list_comments')
      expect(names).not.toContain('add_comment')
      expect(names).not.toContain('suggest_edit')
    } finally {
      await client.close()
    }
  })
})

describe('frames', () => {
  it('a token without a relay scope reaches nothing', async () => {
    store.notePending(CLIENT)
    store.approve(CLIENT.id, ['read'])
    const answer = await handler.handle(frame('tools/list', undefined, ['offline_access']))
    expect(answer).toMatchObject({ error: { code: RELAY_CALL_ERROR.NO_PERMISSION } })
  })

  it('malformed frames are not calls, and unexpected headers are dropped', () => {
    expect(parseCallFrame(null)).toBeNull()
    expect(parseCallFrame({ type: 'ping' })).toBeNull()
    expect(parseCallFrame({ type: 'call', id: 'x', client: { id: 'c', name: 'n' }, scopes: [], method: 'm', headers: {} })).toBeNull()
    expect(parseCallFrame({ type: 'call', id: 'x', client: CLIENT, scopes: [], method: 'm', params: [1], headers: {} })).toBeNull()
    const parsed = parseCallFrame({
      type: 'call',
      id: 'x',
      client: CLIENT,
      scopes: ['read', 7],
      method: 'tools/list',
      headers: { Authorization: 'Bearer leak', Cookie: 'a=b', 'Mcp-Name': 'x', 'MCP-Protocol-Version': '2025-11-25' }
    })
    expect(parsed?.headers).toEqual({ 'mcp-name': 'x', 'mcp-protocol-version': '2025-11-25' })
    expect(parsed?.scopes).toEqual(['read'])
  })
})
