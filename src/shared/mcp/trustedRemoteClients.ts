/**
 * The remote MCP clients that connect without the writer's approval in the
 * app (#1304; design docs/architecture/mcp-relay.md §6).
 *
 * A client is trusted only when both hold:
 *   - the gateway verified it: it registered with a Client ID Metadata
 *     Document, so its client id is an https URL on a domain it controls
 *     (a self-registered DCR client has no proven domain and is never trusted);
 *   - that domain is on the list below.
 *
 * Verified alone is not enough: any domain can publish a metadata document
 * and call its client "Claude". Every other client, verified or not, waits
 * for the writer's approval in Settings → Integrations → Connections.
 *
 * The client's name plays no part: it is whatever the client registered.
 */

interface TrustedHost {
  host: string
  /** Also trust every subdomain of `host`. */
  subdomains?: boolean
}

export const TRUSTED_REMOTE_CLIENT_HOSTS: readonly TrustedHost[] = [
  { host: 'claude.ai' },
  { host: 'chatgpt.com' },
  // The Inference Co-op's hosted LibreChat. LibreChat registers dynamically
  // today, so this takes effect once it identifies itself with a metadata
  // document on this domain.
  { host: 'inference.coop', subdomains: true },
]

/** The proven domain of a verified client (its client id's host), or null. */
export function remoteClientHost(client: { id: string; verified: boolean }): string | null {
  if (!client.verified) return null
  try {
    const url = new URL(client.id)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Whether a client connects without the writer's approval in the app. */
export function isTrustedRemoteClient(client: { id: string; verified: boolean }): boolean {
  const host = remoteClientHost(client)
  if (!host) return false
  return TRUSTED_REMOTE_CLIENT_HOSTS.some((t) => host === t.host || (t.subdomains === true && host.endsWith(`.${t.host}`)))
}
