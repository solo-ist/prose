import { safeStorage } from 'electron'
import { readFile, writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const SETTINGS_DIR = join(homedir(), '.prose')
const CREDENTIALS_DIR = join(SETTINGS_DIR, 'credentials')

function keyToFilename(key: string): string {
  // Convert key to a safe filename (alphanumeric, dashes, underscores only)
  // Dots are stripped to prevent path traversal (e.g. '..' escaping CREDENTIALS_DIR)
  return key.replace(/[^a-z0-9\-_]/gi, '-')
}

export const credentialStore = {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  },

  async set(key: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }
    await mkdir(CREDENTIALS_DIR, { recursive: true })
    const filename = keyToFilename(key)
    const encrypted = safeStorage.encryptString(value)
    await writeFile(join(CREDENTIALS_DIR, filename), encrypted)
  },

  async get(key: string): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) {
      return null
    }
    try {
      const filename = keyToFilename(key)
      const encrypted = await readFile(join(CREDENTIALS_DIR, filename))
      return safeStorage.decryptString(encrypted)
    } catch {
      return null
    }
  },

  async delete(key: string): Promise<void> {
    try {
      const filename = keyToFilename(key)
      await unlink(join(CREDENTIALS_DIR, filename))
    } catch {
      // File doesn't exist, ignore
    }
  }
}
