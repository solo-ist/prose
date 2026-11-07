/**
 * Copy-paste setup for the MCP clients that connect by URL (#1236), filled
 * in with this app's endpoint and, right after a connection is created, its
 * token. Pure, so the snippets are tested as text.
 */

export type McpSetupClient = 'claude-code' | 'codex' | 'open-webui' | 'librechat'

export const MCP_SETUP_CLIENTS: Array<{ id: McpSetupClient; name: string }> = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'open-webui', name: 'Open WebUI' },
  { id: 'librechat', name: 'LibreChat' }
]

export const TOKEN_PLACEHOLDER = '<your connection token>'

export interface McpSetupSnippet {
  /** What to paste, and where. */
  text: string
  note: string
}

/** The same endpoint as seen from inside a Docker container on this Mac. */
export function dockerUrl(url: string): string {
  return url.replace('//localhost:', '//host.docker.internal:').replace('//127.0.0.1:', '//host.docker.internal:')
}

export function mcpSetupSnippet(client: McpSetupClient, url: string, token?: string): McpSetupSnippet {
  const secret = token || TOKEN_PLACEHOLDER
  switch (client) {
    case 'claude-code':
      return {
        text: `claude mcp add --transport http prose ${url} --header "Authorization: Bearer ${secret}"`,
        note: 'Run in a terminal. Add --scope user to use Prose from every project.'
      }
    case 'codex':
      return {
        text: ['[mcp_servers.prose]', `url = "${url}"`, 'bearer_token_env_var = "PROSE_MCP_TOKEN"'].join('\n'),
        note: `Add to ~/.codex/config.toml, and set PROSE_MCP_TOKEN=${secret} in the environment Codex starts from.`
      }
    case 'open-webui':
      return {
        text: [`URL: ${url}`, 'Type: MCP (Streamable HTTP)', 'Auth: Bearer', `Key: ${secret}`].join('\n'),
        note: `Admin Settings → External Tools → add a server. From Open WebUI in Docker, use ${dockerUrl(url)}.`
      }
    case 'librechat':
      return {
        text: [
          'mcpSettings:',
          '  allowedAddresses:',
          '    - host.docker.internal',
          'mcpServers:',
          '  prose:',
          '    type: streamable-http',
          `    url: ${dockerUrl(url)}`,
          '    headers:',
          `      Authorization: "Bearer ${secret}"`
        ].join('\n'),
        note: `Add to librechat.yaml. Outside Docker, use ${url} and allow localhost instead.`
      }
  }
}
