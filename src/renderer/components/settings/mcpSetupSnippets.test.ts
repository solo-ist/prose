/** The per-client setup snippets (#1236). */
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { dockerUrl, mcpSetupSnippet, MCP_SETUP_CLIENTS, TOKEN_PLACEHOLDER } from './mcpSetupSnippets'

const URL = 'http://localhost:9877/mcp'

describe('MCP setup snippets', () => {
  it('fill in the endpoint and the token, or a placeholder', () => {
    for (const { id } of MCP_SETUP_CLIENTS) {
      const withToken = mcpSetupSnippet(id, URL, 'prose_mcp_abc')
      expect(withToken.text + withToken.note).toContain('prose_mcp_abc')
      const without = mcpSetupSnippet(id, URL)
      expect(without.text + without.note).toContain(TOKEN_PLACEHOLDER)
    }
  })

  it('give each client its own shape', () => {
    expect(mcpSetupSnippet('claude-code', URL, 't').text).toBe(`claude mcp add --transport http prose ${URL} --header "Authorization: Bearer t"`)
    expect(mcpSetupSnippet('codex', URL, 't').text).toContain('bearer_token_env_var = "PROSE_MCP_TOKEN"')
    expect(mcpSetupSnippet('open-webui', URL, 't').note).toContain('http://host.docker.internal:9877/mcp')
    const libre = mcpSetupSnippet('librechat', URL, 't').text
    expect(libre).toContain('allowedAddresses')
    expect(libre).toContain('url: http://host.docker.internal:9877/mcp')
    expect(libre).toContain('Authorization: "Bearer t"')
  })

  it('Open WebUI: the fields of the config that passed acceptance run 2', () => {
    const owui = mcpSetupSnippet('open-webui', URL, 't')
    expect(owui.text.split('\n')).toEqual([`URL: ${URL}`, 'Type: MCP (Streamable HTTP)', 'Auth: Bearer', 'Key: t'])
  })

  // #1278: the shape that worked on LibreChat 0.8.8 (acceptance run 2).
  it('LibreChat: valid YAML that LibreChat 0.8.8 accepts and connects with', () => {
    const parsed = load(mcpSetupSnippet('librechat', 'http://127.0.0.1:9898/mcp', 'prose_mcp_abc').text) as {
      mcpServers: { prose: Record<string, unknown> }
      mcpSettings: { allowedAddresses: string[] }
    }
    expect(parsed.mcpServers.prose).toEqual({
      type: 'streamable-http',
      url: 'http://host.docker.internal:9898/mcp',
      headers: { Authorization: 'Bearer prose_mcp_abc' },
      // A static bearer: without this, LibreChat probes without the header, sees the 401 challenge and assumes OAuth.
      requiresOAuth: false,
      // Without this, LibreChat doesn't give the model Prose's server instructions.
      serverInstructions: true
    })
    // 0.8.8's schema rejects a bare host, and an invalid config stops LibreChat at startup.
    expect(parsed.mcpSettings.allowedAddresses).toEqual(['host.docker.internal:9898'])
    expect(mcpSetupSnippet('librechat', URL, 't').note).toContain('localhost:9877')
  })

  it('maps loopback to the Docker host name', () => {
    expect(dockerUrl('http://127.0.0.1:9878/mcp')).toBe('http://host.docker.internal:9878/mcp')
  })
})
