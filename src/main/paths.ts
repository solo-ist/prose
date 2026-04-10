/**
 * Centralized settings directory paths.
 *
 * All main-process code that reads/writes user data should import from here
 * instead of computing paths independently.
 */
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { app } from 'electron'

/**
 * Legacy settings directory (~/.prose/).
 * Used only for one-time migration and legacy file cleanup.
 */
export const LEGACY_SETTINGS_DIR = join(homedir(), '.prose')

/**
 * Compute the userData path without requiring app.whenReady().
 * Mirrors the logic Electron uses internally for app.getPath('userData').
 * Use this ONLY for code that runs before app.whenReady() (e.g., early Sentry init).
 */
export function getUserDataPath(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Prose')
    case 'win32':
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Prose')
    default: // linux, freebsd, etc.
      return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Prose')
  }
}

/**
 * Get the canonical settings directory (app.getPath('userData')).
 * Self-healing: creates the directory on first call, then caches.
 * Only call AFTER app.whenReady() — will throw if called too early.
 */
let _cachedSettingsDir: string | undefined
export function getSettingsDir(): string {
  if (!_cachedSettingsDir) {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    _cachedSettingsDir = dir
  }
  return _cachedSettingsDir
}

/**
 * Validate that getUserDataPath() agrees with app.getPath('userData').
 * Call once after app.whenReady() to catch divergence early.
 */
export function validatePathConsistency(): void {
  const manual = getUserDataPath()
  const electron = app.getPath('userData')
  if (manual !== electron) {
    console.error(
      `[Paths] WARNING: getUserDataPath() returned "${manual}" but app.getPath('userData') returned "${electron}". ` +
      `Early Sentry init may have read settings from the wrong location. ` +
      `Ensure "Prose" in paths.ts matches productName in package.json.`
    )
  }
}
