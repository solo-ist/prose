// @vitest-environment node
/**
 * The stdio hand-off of `clientInfo` (#1236): whichever protocol era a
 * connection opens with, the shared server hands `callTool` the client's
 * self-reported name and version, which the bridge forwards to the app.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { Client } from '@modelcontextprotocol/client'
import { createProseMcpServer, type McpCallContext } from './server'

describe.each([
  ['2025-era (initialize)', undefined],
  ['2026-07-28 (envelope)', '2026-07-28']
])('clientInfo over a stdio-style connection, %s', (_label, pin) => {
  it('reaches callTool', async () => {
    const seen: McpCallContext[] = []
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const handle = serveStdio(
      () =>
        createProseMcpServer({
          version: '1.0.0',
          callTool: async (_name, _args, context) => {
            seen.push(context)
            return { content: [{ type: 'text', text: '{}' }] }
          }
        }),
      { transport: serverSide }
    )
    const client = new Client({ name: 'claude-ai', version: '0.9.1' }, pin ? { versionNegotiation: { mode: { pin } } } : {})
    await client.connect(clientSide)
    await client.callTool({ name: 'list_tabs', arguments: {} })
    await client.close()
    await handle.close()
    expect(seen).toEqual([{ client: { name: 'claude-ai', version: '0.9.1' } }])
  })
})
