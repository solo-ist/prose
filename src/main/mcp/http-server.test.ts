// @vitest-environment node
/**
 * The MCP HTTP endpoint (#1235): both protocol eras through the SDK's own
 * client, the result shape, and the Host / Origin / bearer guards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request as httpRequest } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpHttpServer, mcpHttpPort } from './http-server'
import { mcpToolNames } from '../../shared/tools/registry'
import type { ToolResult } from '../../shared/tools/types'

const TOKEN = 'a'.repeat(64)
const VERSION = '9.8.7'

const PAYLOADS: Record<string, ToolResult> = {
  read_document: { success: true, data: { nodes: [{ id: 'n1', type: 'paragraph', content: 'Hello' }], markdown: 'Hello\n' } },
  list_tabs: {
    success: true,
    data: { tabs: [{ tabId: 't1', title: 'Draft', path: null, isActive: true, isDirty: false, isPreview: false, documentId: 'd1' }] }
  },
  select_tab: { success: false, error: 'tab not found', code: 'TAB_NOT_FOUND' }
}

let server: McpHttpServer
let baseUrl: URL
const calls: Array<{ name: string; args: unknown }> = []

beforeAll(async () => {
  server = new McpHttpServer()
  server.setAuthToken(TOKEN)
  server.setToolInvokeHandler(async (name, args) => {
    calls.push({ name, args })
    const payload = PAYLOADS[name]
    if (!payload) throw new Error(`Tool "${name}" is not available over MCP`)
    return payload
  })
  await server.start({ port: 0, version: VERSION })
  baseUrl = new URL(`http://127.0.0.1:${server.port}/mcp`)
})

afterAll(async () => {
  await server.stop()
})

/** What the client put on the wire: each JSON-RPC method and its protocol-version header. */
type Sent = { method: string; protocolHeader: string | null }

async function connect(pin?: string): Promise<{ client: Client; sent: Sent[] }> {
  const sent: Sent[] = []
  const client = new Client(
    { name: 'prose-test', version: '1.0.0' },
    pin ? { versionNegotiation: { mode: { pin } } } : {}
  )
  const transport = new StreamableHTTPClientTransport(baseUrl, {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    fetch: async (input, init) => {
      if (typeof init?.body === 'string') {
        const headers = new Headers(init.headers)
        sent.push({ method: (JSON.parse(init.body) as { method?: string }).method ?? '', protocolHeader: headers.get('mcp-protocol-version') })
      }
      return fetch(input, init)
    }
  })
  await client.connect(transport)
  return { client, sent }
}

/** A raw request with full control over Host and Origin (fetch won't set Host). */
function raw(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        method,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } : {}),
          ...headers
        }
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }))
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function jsonRpcBody(text: string): Record<string, unknown> {
  const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
  return JSON.parse(dataLine ? dataLine.slice(5).trim() : text) as Record<string, unknown>
}

describe.each([
  ['2025-era (initialize)', undefined],
  ['2026-07-28', '2026-07-28']
])('MCP over HTTP, %s', (_label, pin) => {
  let client: Client
  let sent: Sent[]

  beforeAll(async () => {
    ;({ client, sent } = await connect(pin))
  })

  it('really speaks that era on the wire', () => {
    if (pin) {
      expect(sent.map((s) => s.method)).not.toContain('initialize')
      expect(sent.some((s) => s.protocolHeader === pin)).toBe(true)
    } else {
      expect(sent[0].method).toBe('initialize')
    }
  })

  afterAll(async () => {
    await client.close()
  })

  it('identifies the server and carries the instructions', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'Prose', version: VERSION })
    expect(client.getInstructions()).toContain('The writer decides')
  })

  it('lists the MCP tools with titles, annotations and output schemas', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...mcpToolNames].sort())
    const read = tools.find((t) => t.name === 'read_document')!
    expect(read.title).toBe('Read document')
    expect(read.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false })
    expect(read.outputSchema).toMatchObject({ type: 'object', required: ['nodes', 'markdown'] })
    expect(read.description).not.toMatch(/\bedit tool\b|call edit\b/)
  })

  it('returns structuredContent the client validates against the output schema', async () => {
    const result = await client.callTool({ name: 'read_document', arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual((PAYLOADS.read_document as { data: unknown }).data)
    const text = (result.content as Array<{ type: string; text: string }>)[0]
    expect(JSON.parse(text.text)).toEqual(result.structuredContent)
  })

  it('reports a tool failure as an error result with its code', async () => {
    const result = await client.callTool({ name: 'select_tab', arguments: { tabId: 'nope' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('TAB_NOT_FOUND')
  })

  it('reports a refused tool as an error result', async () => {
    const result = await client.callTool({ name: 'read_file', arguments: { path: '/etc/hosts' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('not available over MCP')
  })
})

describe('MCP HTTP guards', () => {
  it('still answers a bare stateless 2025 POST without initialize', async () => {
    const res = await raw('POST', '/mcp', { Authorization: `Bearer ${TOKEN}` }, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(res.status).toBe(200)
    const tools = (jsonRpcBody(res.text).result as { tools: Array<{ name: string }> }).tools
    expect(tools.map((t) => t.name)).toContain('list_tabs')
  })

  it('refuses a foreign Host header (DNS rebinding)', async () => {
    const res = await raw('POST', '/mcp', { Host: 'attacker.example:9877', Authorization: `Bearer ${TOKEN}` }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(403)
  })

  it('accepts host.docker.internal for Docker-hosted clients', async () => {
    const res = await raw('POST', '/mcp', { Host: `host.docker.internal:${server.port}`, Authorization: `Bearer ${TOKEN}` }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(200)
  })

  it('refuses a foreign Origin before the token is even checked', async () => {
    const res = await raw('POST', '/mcp', { Origin: 'https://attacker.example', Authorization: `Bearer ${TOKEN}` }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers a localhost preflight with the protocol headers allowed', async () => {
    const res = await raw('OPTIONS', '/mcp', { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(String(res.headers['access-control-allow-headers'])).toContain('MCP-Protocol-Version')
    expect(String(res.headers['access-control-allow-headers'])).toContain('Last-Event-ID')
  })

  it('requires the bearer token', async () => {
    const missing = await raw('POST', '/mcp', {}, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(missing.status).toBe(401)
    expect(missing.headers['www-authenticate']).toBe('Bearer realm="Prose"')
    const wrong = await raw('POST', '/mcp', { Authorization: `Bearer ${'b'.repeat(64)}` }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(wrong.status).toBe(401)
  })

  it('keeps /health open and reports the version at /', async () => {
    expect((await raw('GET', '/health', {})).status).toBe(200)
    const info = await raw('GET', '/', { Authorization: `Bearer ${TOKEN}` })
    expect(JSON.parse(info.text)).toMatchObject({ version: VERSION, protocolRevisions: ['2026-07-28', '2025-11-25'] })
  })
})

describe('mcpHttpPort', () => {
  it('separates the installed app from unpackaged runs', () => {
    expect(mcpHttpPort(true, {})).toBe(9877)
    expect(mcpHttpPort(false, {})).toBe(9878)
    expect(mcpHttpPort(false, { PROSE_MCP_PORT: '9911' })).toBe(9911)
  })
})
