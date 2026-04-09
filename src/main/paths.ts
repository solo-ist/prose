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
 * Self-healing: creates the directory if it doesn't exist.
 * Only call AFTER app.whenReady() — will throw if called too early.
 */
export function getSettingsDir(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return dir
}
