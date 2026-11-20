/**
 * The reMarkable credentials, kept in main like the LLM keys (#1275, after
 * #1240): the device token for the reMarkable cloud, and the separate
 * Anthropic key handwriting OCR can use. The renderer sees only that each
 * exists (`settings.remarkable.connected`, `hasAnthropicKey`); main's
 * reMarkable handlers read them here.
 *
 * Storage follows `llmKeys.ts`: `credentialStore` (OS safeStorage) when secure
 * storage is available, else this module's memory for the session, never
 * written to disk.
 */
import { credentialStore } from './credentialStore'
import { resolveProviderKey } from './llmKeys'

export const REMARKABLE_DEVICE_TOKEN = 'remarkable-device-token'
export const REMARKABLE_OCR_KEY = 'remarkable-anthropic-key'

/** Credentials held for this session only (secure storage unavailable). Never written. */
const sessionValues = new Map<string, string>()

async function read(name: string): Promise<string | null> {
  if (credentialStore.isAvailable()) {
    const stored = await credentialStore.get(name)
    if (stored) return stored
  }
  return sessionValues.get(name) ?? null
}

async function write(name: string, value: string): Promise<void> {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Nothing to save')
  if (trimmed.length > 8192) throw new Error('Value is too long')
  if (credentialStore.isAvailable()) {
    await credentialStore.set(name, trimmed)
    sessionValues.delete(name)
  } else {
    sessionValues.set(name, trimmed)
  }
}

async function remove(name: string): Promise<void> {
  sessionValues.delete(name)
  // Unlinks the encrypted file only; never throws, needs no safeStorage.
  await credentialStore.delete(name)
}

export const resolveDeviceToken = (): Promise<string | null> => read(REMARKABLE_DEVICE_TOKEN)
export const setDeviceToken = (token: string): Promise<void> => write(REMARKABLE_DEVICE_TOKEN, token)
export const clearDeviceToken = (): Promise<void> => remove(REMARKABLE_DEVICE_TOKEN)

/**
 * A plaintext device token found in `settings.json` at load (an old build, a
 * hand edit) that secure storage could not take stays usable for the
 * session; the next settings write strips it from disk.
 */
export async function seedDeviceTokenFromDisk(raw: { remarkable?: { deviceToken?: unknown } }): Promise<void> {
  const plaintext = raw.remarkable?.deviceToken
  if (typeof plaintext !== 'string' || !plaintext.trim()) return
  if ((await resolveDeviceToken()) !== null) return
  sessionValues.set(REMARKABLE_DEVICE_TOKEN, plaintext.trim())
}

/**
 * The reMarkable-specific OCR key, migrating the pre-1.4 file once when
 * `legacyPath` is given (the caller owns that path).
 */
async function readOcrKey(legacyPath?: string): Promise<string | null> {
  const key = await read(REMARKABLE_OCR_KEY)
  if (key || !legacyPath) return key
  return credentialStore.migrateFromLegacyFile(legacyPath, REMARKABLE_OCR_KEY)
}

export async function hasOcrKey(legacyPath?: string): Promise<boolean> {
  return (await readOcrKey(legacyPath)) !== null
}

export const setOcrKey = (key: string): Promise<void> => write(REMARKABLE_OCR_KEY, key)
export const clearOcrKey = (): Promise<void> => remove(REMARKABLE_OCR_KEY)

/**
 * The key handwriting OCR uses: the LLM settings' Anthropic key (OCR is Claude
 * vision, whichever provider chat uses), else the reMarkable-specific one.
 */
export async function resolveOcrKey(legacyPath?: string): Promise<string | undefined> {
  return (await resolveProviderKey('anthropic')) ?? (await readOcrKey(legacyPath)) ?? undefined
}

type RemarkableShape = { deviceToken?: unknown; connected?: unknown; hasAnthropicKey?: unknown } & Record<string, unknown>

/** The reMarkable settings for the renderer: no token; whether one is held, and whether an OCR key is. */
export function remarkableForRenderer<T extends RemarkableShape>(
  remarkable: T,
  status: { connected: boolean; hasAnthropicKey: boolean }
): Omit<T, 'deviceToken'> & { connected: boolean; hasAnthropicKey: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deviceToken: _token, ...rest } = remarkable
  return { ...rest, connected: status.connected, hasAnthropicKey: status.hasAnthropicKey }
}

/** The reMarkable settings for `settings.json`: no token and no (derived) connection flag. */
export function stripRemarkableSecretsForDisk<T extends RemarkableShape>(remarkable: T): Omit<T, 'deviceToken' | 'connected'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deviceToken: _token, connected: _connected, ...rest } = remarkable
  return rest
}

/** Test seam: forget this session's in-memory credentials. */
export function resetRemarkableSessionForTest(): void {
  sessionValues.clear()
}
