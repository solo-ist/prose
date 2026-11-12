// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { remoteConnectedMessage, remoteScopeSummary } from './remoteAccessText'

describe('remote access wording (#1304)', () => {
  it('summarises what a connection can do, read always first', () => {
    expect(remoteScopeSummary(['read'])).toBe('read')
    expect(remoteScopeSummary([])).toBe('read')
    expect(remoteScopeSummary(['comment', 'read'])).toBe('read and comment on')
    expect(remoteScopeSummary(['read', 'propose', 'comment'])).toBe('read, suggest edits on and comment on')
  })

  it('names the client, its proven domain and its permissions', () => {
    expect(
      remoteConnectedMessage({ reason: 'connected', clientName: 'Claude', host: 'claude.ai', scopes: ['read', 'propose', 'comment'] })
    ).toBe('Claude (claude.ai) is now connected to Prose. It can read, suggest edits on and comment on the documents you have open.')
  })

  it('caps a long name and copes without a host', () => {
    const message = remoteConnectedMessage({ reason: 'connected', clientName: 'x'.repeat(200), host: '', scopes: ['read'] })
    expect(message).toBe(`${'x'.repeat(80)} is now connected to Prose. It can read the documents you have open.`)
  })
})
