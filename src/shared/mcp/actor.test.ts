// @vitest-environment node
/** MCP actors (#1236): built in main, re-validated in the renderer, self-reports cleaned. */
import { describe, expect, it } from 'vitest'
import { connectionActor, launchActor, mcpActorFrom } from './actor'

describe('MCP actors', () => {
  it('labels an HTTP call with its connection, the client beside it', () => {
    expect(connectionActor({ id: 'c1', label: 'Codex' }, 'http')).toEqual({ kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex', via: 'http' })
    expect(connectionActor({ id: 'c1', label: 'Codex' }, 'http', { name: 'codex-cli\u0000', version: 7 })).toEqual({
      kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex', client: 'codex-cli', clientVersion: '7', via: 'http'
    })
  })

  it('labels a stdio call with the client it reports, else "MCP client"', () => {
    expect(launchActor('stdio', { name: 'claude-ai', version: '0.1.0' })).toEqual({
      kind: 'mcp-agent', connectionId: 'launch', connectionLabel: 'Claude Desktop', client: 'claude-ai', clientVersion: '0.1.0', via: 'stdio'
    })
    // Claude Desktop's agent mode reports the server's name, not its own.
    expect(launchActor('stdio', { name: 'local-agent-mode-Prose (Prose Dev)' }).connectionLabel).toBe('Claude Desktop')
    expect(launchActor('stdio', { name: 'some-other-client' }).connectionLabel).toBe('some-other-client')
    expect(launchActor('stdio')).toEqual({ kind: 'mcp-agent', connectionId: 'launch', connectionLabel: 'MCP client', via: 'stdio' })
    // Over HTTP the launch token names nothing: a client's report never becomes the label.
    expect(launchActor('http', { name: 'Pretender' }).connectionLabel).toBe('MCP client')
    expect(launchActor('stdio', { name: 'x'.repeat(500) }).connectionLabel).toHaveLength(100)
  })

  it('lets only a clean mcp-agent across the IPC boundary', () => {
    expect(mcpActorFrom({ kind: 'human', self: true })).toBeNull()
    expect(mcpActorFrom({ kind: 'mcp-agent' })).toBeNull()
    expect(mcpActorFrom(null)).toBeNull()
    expect(mcpActorFrom('mcp-agent')).toBeNull()
    expect(
      mcpActorFrom({ kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Co\u001bdex', client: '', via: 'carrier-pigeon', extra: 1 })
    ).toEqual({ kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex' })
    expect(mcpActorFrom({ kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex', via: 'http', client: 'cli' })).toEqual({
      kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex', client: 'cli', via: 'http'
    })
  })
})
