import { beforeEach, describe, expect, it, vi } from 'vitest'

// credentialStore stands in for OS safeStorage: a map, and a switch for
// whether secure storage is available on "this system".
const h = vi.hoisted(() => ({ available: true, stored: new Map<string, string>() }))
vi.mock('./credentialStore', () => ({
  credentialStore: {
    isAvailable: () => h.available,
    get: async (key: string) => (h.available ? h.stored.get(key) ?? null : null),
    set: async (key: string, value: string) => {
      if (!h.available) throw new Error('Secure storage is not available on this system')
      h.stored.set(key, value)
    },
    delete: async (key: string) => {
      h.stored.delete(key)
    },
  },
}))

import {
  clearProviderKey,
  keyStatusAll,
  resetSessionKeysForTest,
  resolveProviderKey,
  seedSessionKeyFromDisk,
  setProviderKey,
  stripLlmSecretsForDisk,
  toRendererSettings,
} from './llmKeys'

const KEY = 'sk-ant-api03-' + 'x'.repeat(60) + 'WXYZ'

beforeEach(() => {
  h.available = true
  h.stored.clear()
  resetSessionKeysForTest()
})

describe('llmKeys (#1240)', () => {
  it('stores in secure storage under the pre-1.9.1 name, so saved keys keep resolving', async () => {
    await setProviderKey('anthropic', KEY)
    expect(h.stored.get('llm-api-key')).toBe(KEY)
    expect(await resolveProviderKey('anthropic')).toBe(KEY)
    expect(await keyStatusAll()).toEqual({ anthropic: { hint: 'WXYZ', persisted: true } })
  })

  it('without secure storage, keeps the key in memory for the session and writes nothing', async () => {
    h.available = false
    await setProviderKey('anthropic', `  ${KEY}  `)
    expect(h.stored.size).toBe(0)
    expect(await resolveProviderKey('anthropic')).toBe(KEY)
    expect(await keyStatusAll()).toEqual({ anthropic: { hint: 'WXYZ', persisted: false } })
  })

  it('refuses an empty or oversized key', async () => {
    await expect(setProviderKey('anthropic', '   ')).rejects.toThrow(/empty/)
    await expect(setProviderKey('anthropic', 'k'.repeat(5000))).rejects.toThrow(/too long/)
    expect(await keyStatusAll()).toEqual({})
  })

  it('clear forgets the key in both places', async () => {
    await setProviderKey('anthropic', KEY)
    h.available = false
    await setProviderKey('anthropic', KEY)
    h.available = true
    await clearProviderKey('anthropic')
    expect(await resolveProviderKey('anthropic')).toBeNull()
    h.available = false
    expect(await resolveProviderKey('anthropic')).toBeNull()
  })

  it('seeds a plaintext key from settings.json for the session, unless one is already saved', async () => {
    h.available = false
    await seedSessionKeyFromDisk({ llm: { provider: 'anthropic', apiKey: KEY } })
    expect(await resolveProviderKey('anthropic')).toBe(KEY)

    resetSessionKeysForTest()
    h.available = true
    h.stored.set('llm-api-key', 'sk-ant-saved')
    await seedSessionKeyFromDisk({ llm: { provider: 'anthropic', apiKey: KEY } })
    expect(await resolveProviderKey('anthropic')).toBe('sk-ant-saved')

    await seedSessionKeyFromDisk({ llm: { provider: 'anthropic', apiKey: '' } })
    await seedSessionKeyFromDisk({})
    expect(await resolveProviderKey('anthropic')).toBe('sk-ant-saved')
  })

  it('the renderer payload never carries a key, only the status', async () => {
    await setProviderKey('anthropic', KEY)
    const raw = { llm: { provider: 'anthropic', model: 'm', apiKey: KEY }, editor: { fontSize: 16 } }
    const payload = toRendererSettings(raw, await keyStatusAll())
    expect(JSON.stringify(payload)).not.toContain(KEY)
    expect(payload.llm).toEqual({ provider: 'anthropic', model: 'm', keyStatus: { anthropic: { hint: 'WXYZ', persisted: true } } })
    expect(payload.editor).toEqual({ fontSize: 16 })
  })

  it('what goes to disk carries neither the key nor the derived status', () => {
    const settings = { llm: { provider: 'anthropic', model: 'm', apiKey: KEY, keyStatus: { anthropic: { hint: 'WXYZ', persisted: true } } } }
    const disk = stripLlmSecretsForDisk(settings)
    expect(JSON.stringify(disk)).not.toContain(KEY)
    expect(disk.llm).toEqual({ provider: 'anthropic', model: 'm' })
    expect(stripLlmSecretsForDisk({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })
})
