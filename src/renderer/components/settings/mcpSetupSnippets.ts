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

/**
 * The `host:port` of an endpoint URL. A string split rather than `new URL`:
 * before the endpoint answers, the URL is a placeholder with `<port>`, which
 * `new URL` rejects.
 */
export function hostPort(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0]
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
      // The shape that worked on LibreChat 0.8.8 (#1278). requiresOAuth: false,
      // because LibreChat probes without the header and reads Prose's 401
      // challenge as "needs OAuth"; allowedAddresses entries must be host:port,
      // or LibreChat rejects the whole config at startup.
      return {
        text: [
          'mcpServers:',
          '  prose:',
          '    type: streamable-http',
          `    url: ${dockerUrl(url)}`,
          '    headers:',
          `      Authorization: "Bearer ${secret}"`,
          '    requiresOAuth: false',
          '    serverInstructions: true',
          'mcpSettings:',
          '  allowedAddresses:',
          `    - "${hostPort(dockerUrl(url))}"`
        ].join('\n'),
        note: `Add to librechat.yaml. Outside Docker, use ${url} and allow "${hostPort(url)}" instead.`
      }
  }
}
