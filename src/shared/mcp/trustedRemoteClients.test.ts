// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isTrustedRemoteClient, remoteClientHost } from './trustedRemoteClients'

const verified = (id: string) => ({ id, verified: true })

describe('trusted remote clients (#1304)', () => {
  it('trusts a verified client on a listed domain', () => {
    expect(isTrustedRemoteClient(verified('https://claude.ai/oauth/mcp-oauth-client-metadata'))).toBe(true)
    expect(isTrustedRemoteClient(verified('https://chatgpt.com/oauth/client.json'))).toBe(true)
    expect(isTrustedRemoteClient(verified('https://inference.coop/client.json'))).toBe(true)
    expect(isTrustedRemoteClient(verified('https://chat.inference.coop/oauth/client.json'))).toBe(true)
  })

  it('never trusts an unverified client, whatever its id says', () => {
    expect(isTrustedRemoteClient({ id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', verified: false })).toBe(false)
    expect(isTrustedRemoteClient({ id: 'dcr-client-123', verified: false })).toBe(false)
  })

  it('does not trust a verified client on another domain, or a look-alike', () => {
    expect(isTrustedRemoteClient(verified('https://example.com/client.json'))).toBe(false)
    expect(isTrustedRemoteClient(verified('https://claude.ai.example.com/client.json'))).toBe(false)
    expect(isTrustedRemoteClient(verified('https://notclaude.ai/client.json'))).toBe(false)
    expect(isTrustedRemoteClient(verified('https://evil-inference.coop/client.json'))).toBe(false)
    // Subdomains only where the list says so.
    expect(isTrustedRemoteClient(verified('https://evil.claude.ai/client.json'))).toBe(false)
    expect(isTrustedRemoteClient(verified('https://evil.chatgpt.com/client.json'))).toBe(false)
  })

  it('needs a plain https URL: no other scheme, credentials or port', () => {
    expect(isTrustedRemoteClient(verified('http://claude.ai/client.json'))).toBe(false)
    expect(isTrustedRemoteClient(verified('https://user@claude.ai/client.json'))).toBe(false)
    expect(isTrustedRemoteClient(verified('https://claude.ai:8443/client.json'))).toBe(false)
    expect(isTrustedRemoteClient(verified('not a url'))).toBe(false)
  })

  it('reports the proven domain of a verified client only', () => {
    expect(remoteClientHost(verified('https://CHATGPT.com/oauth/client.json'))).toBe('chatgpt.com')
    expect(remoteClientHost({ id: 'https://chatgpt.com/oauth/client.json', verified: false })).toBeNull()
  })
})
