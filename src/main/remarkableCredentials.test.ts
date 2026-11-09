import { beforeEach, describe, expect, it, vi } from 'vitest'

// credentialStore stands in for OS safeStorage; `available` toggles it.
const h = vi.hoisted(() => ({ available: true, stored: new Map<string, string>(), legacy: null as string | null }))
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
    migrateFromLegacyFile: async (_path: string, key: string) => {
      if (!h.available || !h.legacy) return null
      h.stored.set(key, h.legacy)
      const value = h.legacy
      h.legacy = null
      return value
    },
  },
}))

import {
  clearDeviceToken,
  clearOcrKey,
  hasOcrKey,
  remarkableForRenderer,
  resetRemarkableSessionForTest,
  resolveDeviceToken,
  resolveOcrKey,
  seedDeviceTokenFromDisk,
  setDeviceToken,
  setOcrKey,
  stripRemarkableSecretsForDisk,
} from './remarkableCredentials'
import { resetSessionKeysForTest, setProviderKey } from './llmKeys'

const TOKEN = 'rm-device-token-SECRET-1234567890'
const OCR = 'sk-ant-api03-ocr' + 'o'.repeat(50) + 'OCRK'
const LLM = 'sk-ant-api03-llm' + 'l'.repeat(50) + 'LLMK'

beforeEach(() => {
  h.available = true
  h.stored.clear()
  h.legacy = null
  resetRemarkableSessionForTest()
  resetSessionKeysForTest()
})

describe('reMarkable credentials stay in main (#1275)', () => {
  it('the device token is stored under its pre-1.9.1 name, resolved and cleared', async () => {
    await setDeviceToken(TOKEN)
    expect(h.stored.get('remarkable-device-token')).toBe(TOKEN)
    expect(await resolveDeviceToken()).toBe(TOKEN)
    await clearDeviceToken()
    expect(await resolveDeviceToken()).toBeNull()
  })

  it('without secure storage, the token lives in memory for the session and nothing is written', async () => {
    h.available = false
    await setDeviceToken(TOKEN)
    expect(h.stored.size).toBe(0)
    expect(await resolveDeviceToken()).toBe(TOKEN)
  })

  it('a plaintext token from settings.json is kept for the session unless one is already stored', async () => {
    h.available = false
    await seedDeviceTokenFromDisk({ remarkable: { deviceToken: TOKEN } })
    expect(await resolveDeviceToken()).toBe(TOKEN)

    resetRemarkableSessionForTest()
    h.available = true
    h.stored.set('remarkable-device-token', 'stored-token')
    await seedDeviceTokenFromDisk({ remarkable: { deviceToken: TOKEN } })
    expect(await resolveDeviceToken()).toBe('stored-token')
  })

  it("OCR uses the LLM settings' Anthropic key first, then the reMarkable one, then the legacy file", async () => {
    expect(await resolveOcrKey()).toBeUndefined()
    await setOcrKey(OCR)
    expect(await resolveOcrKey()).toBe(OCR)
    await setProviderKey('anthropic', LLM)
    expect(await resolveOcrKey()).toBe(LLM)

    h.stored.clear()
    resetSessionKeysForTest()
    h.legacy = 'sk-ant-legacy-file-key'
    expect(await hasOcrKey('/legacy')).toBe(true)
    expect(await resolveOcrKey('/legacy')).toBe('sk-ant-legacy-file-key')
  })

  it('the OCR key status says only whether one is saved; clear removes it', async () => {
    expect(await hasOcrKey()).toBe(false)
    await setOcrKey(OCR)
    expect(await hasOcrKey()).toBe(true)
    await clearOcrKey()
    expect(await hasOcrKey()).toBe(false)
  })

  it('the renderer shape carries neither credential; the disk shape drops the derived flag too', () => {
    const remarkable = { enabled: true, syncDirectory: '~/r', deviceToken: TOKEN, connected: true, hasAnthropicKey: false }
    const forRenderer = remarkableForRenderer(remarkable, { connected: true, hasAnthropicKey: true })
    expect(JSON.stringify(forRenderer)).not.toContain(TOKEN)
    expect(forRenderer).toEqual({ enabled: true, syncDirectory: '~/r', connected: true, hasAnthropicKey: true })
    expect(stripRemarkableSecretsForDisk(remarkable)).toEqual({ enabled: true, syncDirectory: '~/r', hasAnthropicKey: false })
  })
})
