import { test, expect } from '@playwright/test'
import {
  createMcpReviewAttribution,
  getMcpClientLabel,
  isMcpAttributionLabel,
  normalizeMcpClientIdentity,
} from '../src/shared/tools/mcpClientIdentity'

test.describe('MCP client attribution', () => {
  test('normalizes Codex, Claude, custom, and fallback identities', () => {
    expect(getMcpClientLabel({ name: 'Codex' })).toBe('Codex (MCP)')
    expect(getMcpClientLabel({ name: 'OpenAI Codex' })).toBe('Codex (MCP)')
    expect(getMcpClientLabel({ name: 'Claude Desktop' })).toBe('Claude (MCP)')
    expect(getMcpClientLabel({ name: 'Cursor' })).toBe('Cursor (MCP)')
    expect(getMcpClientLabel(undefined)).toBe('MCP client')
    expect(getMcpClientLabel({ name: '<script>alert(1)</script>' })).toBe('MCP client')
  })

  test('keeps user-controlled tool arguments from overriding identity', () => {
    const identity = normalizeMcpClientIdentity({
      name: 'Codex',
      model: 'Claude (MCP)',
      arguments: { clientIdentity: { name: 'Claude' } },
    })

    expect(createMcpReviewAttribution(identity, 'request-1')).toMatchObject({
      actor: 'assistant',
      origin: 'mcp',
      label: 'Codex (MCP)',
      model: 'Codex (MCP)',
      requestId: 'request-1',
    })
    expect(isMcpAttributionLabel('Claude (MCP)')).toBe(true)
    expect(isMcpAttributionLabel('Codex (MCP)')).toBe(true)
  })
})
