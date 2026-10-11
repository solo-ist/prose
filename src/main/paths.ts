/**
 * Centralized settings directory paths.
 *
 * All main-process code that reads/writes user data should import from here
 * instead of computing paths independently.
 */
import { join } from 'path'
import { homedir } from 'os'
import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
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
  // Test seam: e2e/QA harnesses set PROSE_USER_DATA_DIR to isolate the
  // profile (settings, IndexedDB, caches) from the developer's real one.
  // index.ts applies the same override to app.getPath('userData') via
  // app.setPath, keeping both resolution paths consistent.
  if (process.env.PROSE_USER_DATA_DIR) return process.env.PROSE_USER_DATA_DIR
  return join(appDataDir(), app.isPackaged ? 'prose' : DEV_PROFILE_NAME)
}

function appDataDir(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support')
    case 'win32':
      return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    default: // linux, freebsd, etc.
      return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  }
}

/**
 * Unpackaged (dev) launches get their own profile (#971). Electron would
 * otherwise name dev's userData after package.json's "prose", which on a
 * case-insensitive disk (macOS, Windows) IS the installed app's "Prose"
 * profile: the two shared the single-instance lock, settings, IndexedDB and
 * the MCP socket, so launching the installed app while dev ran made it quit
 * and drop the file it was asked to open. Worktree dev instances still share
 * this one dev profile (and lock) with each other.
 *
 * The app name is deliberately left alone: safeStorage's keychain item is
 * named after it ("prose Safe Storage"), so the seeded credentials below keep
 * decrypting.
 */
export const DEV_PROFILE_NAME = 'Prose Dev'

// Copied on the first dev launch so the dev profile starts where the shared
// one left off. Tabs (IndexedDB) and Chromium state start fresh.
const DEV_SEED_FILES = ['settings.json', 'dictionary.json', 'share-sync.json', 'Custom Dictionary.txt', 'migration-v2.done']

/**
 * One-time seed of the dev profile from the profile dev used to share with
 * the installed app. Synchronous: runs at the top of main, before the early
 * Sentry settings read. Builds the profile in a temp dir and renames it into
 * place, so a crash mid-copy (or a second worktree launching at the same
 * moment) never leaves a half-seeded profile that would block a retry.
 */
export function seedDevProfile(): void {
  if (app.isPackaged || process.env.PROSE_USER_DATA_DIR) return
  const dest = getUserDataPath()
  if (existsSync(dest)) return
  const src = join(appDataDir(), 'prose')
  const tmp = `${dest}.seeding-${process.pid}`
  try {
    mkdirSync(tmp, { recursive: true })
    const copied: string[] = []
    for (const file of DEV_SEED_FILES) {
      if (!existsSync(join(src, file))) continue
      copyFileSync(join(src, file), join(tmp, file))
      copied.push(file)
    }
    if (existsSync(join(src, 'credentials'))) {
      cpSync(join(src, 'credentials'), join(tmp, 'credentials'), { recursive: true })
      copied.push('credentials/')
    }
    renameSync(tmp, dest)
    console.log(`[Paths] Seeded dev profile ${dest} from ${src}: ${copied.join(', ') || 'nothing to copy'}`)
  } catch (err) {
    console.warn('[Paths] Could not seed the dev profile:', err)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
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
      `Ensure paths.ts getUserDataPath() mirrors the app.setPath('userData') call in index.ts.`
    )
  }
}
