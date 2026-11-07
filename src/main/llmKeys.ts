/**
 * LLM API keys: the only reader and writer, and the reason the renderer never
 * holds one (#1240).
 *
 * A key lives in `credentialStore` (OS safeStorage) when secure storage is
 * available. When it is not (Linux without a keyring), the key lives in this
 * module's memory for the session and is never written — the same behaviour
 * Prose had when the renderer held it: usable this session, gone at quit.
 *
 * The renderer sees `LLMKeyStatusMap` (the last four characters and whether the
 * key persists), asks main to set or clear a key, and names a provider on each
 * request; main resolves that provider's key here.
 */
import { credentialStore } from './credentialStore'
import {
  PROVIDER_IDS,
  getProvider,
  type LLMKeyStatusMap,
  type LLMProvider,
} from '../shared/llm/providers'

/** Keys held for this session only (secure storage unavailable). Never written. */
const sessionKeys = new Map<LLMProvider, string>()

/** Longest key `setProviderKey` accepts. Real keys are ~100–200 characters. */
export const MAX_KEY_LENGTH = 4096

/** The provider's key, or null. Reads secure storage, then this session's memory. */
export async function resolveProviderKey(provider: LLMProvider): Promise<string | null> {
  if (credentialStore.isAvailable()) {
    const stored = await credentialStore.get(getProvider(provider).credentialKey)
    if (stored) return stored
  }
  return sessionKeys.get(provider) ?? null
}

/** Store a key: in secure storage when available, else in memory for this session. */
export async function setProviderKey(provider: LLMProvider, key: string): Promise<void> {
  const value = key.trim()
  if (!value) throw new Error('API key is empty')
  if (value.length > MAX_KEY_LENGTH) throw new Error('API key is too long')
  if (credentialStore.isAvailable()) {
    await credentialStore.set(getProvider(provider).credentialKey, value)
    sessionKeys.delete(provider)
  } else {
    sessionKeys.set(provider, value)
  }
}

/** Forget a key everywhere it may live. */
export async function clearProviderKey(provider: LLMProvider): Promise<void> {
  sessionKeys.delete(provider)
  await credentialStore.delete(getProvider(provider).credentialKey)
}

/**
 * A plaintext key found in `settings.json` at load (written by hand, by an old
 * build, or by a test seed) that secure storage could not take. It is kept in
 * memory for the session, as the renderer used to keep it: the next settings
 * write strips it from disk.
 */
export async function seedSessionKeyFromDisk(raw: { llm?: { provider?: unknown; apiKey?: unknown } }): Promise<void> {
  const plaintext = raw.llm?.apiKey
  if (typeof plaintext !== 'string' || !plaintext.trim()) return
  // The pre-1.9.1 field belonged to the only provider there was.
  if ((await resolveProviderKey('anthropic')) !== null) return
  sessionKeys.set('anthropic', plaintext.trim())
}

/** What the renderer may know about every provider's key. */
export async function keyStatusAll(): Promise<LLMKeyStatusMap> {
  const status: LLMKeyStatusMap = {}
  for (const provider of PROVIDER_IDS) {
    let persisted = false
    let key: string | null = null
    if (credentialStore.isAvailable()) {
      key = await credentialStore.get(getProvider(provider).credentialKey)
      persisted = key !== null
    }
    if (!key) key = sessionKeys.get(provider) ?? null
    if (key) status[provider] = { hint: key.slice(-4), persisted }
  }
  return status
}

type WithLlm = { llm?: Record<string, unknown> }

/** `llm` without the key fields: what goes to disk. */
function llmWithoutSecrets(llm: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!llm) return llm
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { apiKey: _key, keyStatus: _status, ...rest } = llm
  return rest
}

/** The settings payload for the renderer: no key, plus the key status. */
export function toRendererSettings<T extends WithLlm>(settings: T, keyStatus: LLMKeyStatusMap): T {
  return { ...settings, llm: { ...llmWithoutSecrets(settings.llm), keyStatus } }
}

/** Settings for `settings.json`: no key and no (derived) key status. */
export function stripLlmSecretsForDisk<T extends WithLlm>(settings: T): T {
  return settings.llm ? { ...settings, llm: llmWithoutSecrets(settings.llm) } : settings
}

/** Test seam: forget this session's in-memory keys. */
export function resetSessionKeysForTest(): void {
  sessionKeys.clear()
}
