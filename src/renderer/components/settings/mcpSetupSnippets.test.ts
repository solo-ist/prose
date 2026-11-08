/** The per-client setup snippets (#1236). */
import { describe, expect, it } from 'vitest'
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

  it('maps loopback to the Docker host name', () => {
    expect(dockerUrl('http://127.0.0.1:9878/mcp')).toBe('http://host.docker.internal:9878/mcp')
  })
})
