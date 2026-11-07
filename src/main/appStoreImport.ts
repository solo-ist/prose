/**
 * Import the App Store edition's data into the direct build (#1243).
 *
 * The App Store edition is being retired; before anything sends its users to
 * the direct download, this build has to bring their profile across. Both
 * editions share the bundle id, so the App Store edition's profile sits in
 * its sandbox container under the real home, readable by this unsandboxed
 * build.
 *
 * Only the renderer *asks* (`requestImport` + a relaunch): LevelDB must never
 * be copied or replaced while open, and this build's IndexedDB is open the
 * whole time it runs. The copy itself happens in `runPendingImport`, called
 * synchronously at the top of main right after the single-instance lock and
 * before anything opens the profile — the dev-profile seed's pattern
 * (`seedDevProfile` in paths.ts): built aside, renamed in.
 *
 * Deliberately free of `electron` imports so it unit-tests with real temp
 * directories; `appStoreImportIpc.ts` wires it to the app.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'fs'
import { homedir, hostname } from 'os'
import { join, sep } from 'path'
import type { AppStoreImportResult, AppStoreImportStatus } from '../shared/appStoreImport'

export const APP_STORE_BUNDLE_ID = 'ist.solo.prose'

/**
 * What crosses, by name. An allowlist, not a denylist: anything not named here
 * (the MCP token and socket, the singleton lock, caches, Chromium per-install
 * state, reMarkable and sharing state, the installed MCP bridge) stays behind.
 */
export const IMPORT_ITEMS = [
  'settings.json',
  'IndexedDB',
  'Local Storage',
  'dictionary.json',
  'Custom Dictionary.txt',
  'dialog-dirs.json',
  'migration-v2.done'
] as const

/** Credential files that may be offered to the user after the import. */
export const IMPORTABLE_CREDENTIALS = ['llm-api-key'] as const

export const PENDING_FILE = 'app-store-import.pending.json'
export const RESULT_FILE = 'app-store-import.json'
/** Where staged credentials wait for the user's say-so, never `credentials/`. */
export const STAGED_DIR = 'app-store-import'
/** A quit the user cancelled must not import days later. */
export const PENDING_TTL_MS = 10 * 60 * 1000

export interface AppStoreSource {
  /** The sandbox container root; null under the e2e seam. */
  containerDir: string | null
  /** The App Store edition's userData. */
  dataDir: string
}

export type ImportResult = AppStoreImportResult
export type ImportStatus = AppStoreImportStatus

type Env = Record<string, string | undefined>

/**
 * Where the App Store edition keeps its profile. Under the e2e isolation seam
 * (`PROSE_USER_DATA_DIR`) only `PROSE_APP_STORE_DATA_DIR` counts, so a test run
 * on a Mac that has the App Store edition installed never sees the real one.
 */
export function appStoreSource(env: Env = process.env, home: string = homedir()): AppStoreSource | null {
  if (env.PROSE_USER_DATA_DIR) {
    return env.PROSE_APP_STORE_DATA_DIR ? { containerDir: null, dataDir: env.PROSE_APP_STORE_DATA_DIR } : null
  }
  const containerDir = join(home, 'Library', 'Containers', APP_STORE_BUNDLE_ID)
  return { containerDir, dataDir: join(containerDir, 'Data', 'Library', 'Application Support', 'Prose') }
}

/**
 * Whether there is an App Store edition to import from. Checks only the
 * container's own directory entry: nothing inside it is read until the user
 * agrees, so a launch never raises macOS's "access data from other apps" prompt.
 */
export function appStoreAvailable(source: AppStoreSource | null, isPackaged: boolean): source is AppStoreSource {
  if (!source) return false
  if (source.containerDir === null) return existsSync(source.dataDir)
  return isPackaged && existsSync(source.containerDir)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export function readResult(userData: string): ImportResult | null {
  try {
    return readJson(join(userData, RESULT_FILE)) as ImportResult
  } catch {
    return null
  }
}

function writeResult(userData: string, result: ImportResult): void {
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, RESULT_FILE), JSON.stringify(result, null, 2), 'utf-8')
}

/** No settings, or settings without a consent record: onboarding never finished. */
export function isProfileFresh(userData: string): boolean {
  const path = join(userData, 'settings.json')
  if (!existsSync(path)) return true
  try {
    const settings = readJson(path) as { aiConsent?: unknown }
    return !settings?.aiConsent
  } catch {
    // Unreadable settings are not "fresh": never auto-offer over them.
    return false
  }
}

function stagedCredentialsDir(userData: string): string {
  return join(userData, STAGED_DIR, 'credentials')
}

export function listStagedCredentials(userData: string): string[] {
  try {
    const names = readdirSync(stagedCredentialsDir(userData))
    return names.filter((name) => (IMPORTABLE_CREDENTIALS as readonly string[]).includes(name))
  } catch {
    return []
  }
}

export function importStatus(userData: string, source: AppStoreSource | null, isPackaged: boolean): ImportStatus {
  const available = appStoreAvailable(source, isPackaged)
  const result = readResult(userData)
  return {
    available,
    offer: available && !result && isProfileFresh(userData),
    result,
    stagedCredentials: listStagedCredentials(userData)
  }
}

/**
 * Whether the App Store edition is running: Chromium's `SingletonLock` is a
 * symlink to `<hostname>-<pid>`. Copying a live LevelDB would take a torn
 * snapshot, so a live lock refuses the import.
 */
export function isAppStoreEditionRunning(dataDir: string): boolean {
  const lock = join(dataDir, 'SingletonLock')
  let target: string
  try {
    if (!lstatSync(lock).isSymbolicLink()) return false
    target = readlinkSync(lock)
  } catch {
    return false
  }
  const dash = target.lastIndexOf('-')
  const host = target.slice(0, dash)
  const pid = Number(target.slice(dash + 1))
  if (dash <= 0 || !Number.isInteger(pid) || pid <= 0) return false
  if (host !== hostname()) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function requestImport(userData: string, now: number = Date.now()): void {
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, PENDING_FILE), JSON.stringify({ requestedAt: now }), 'utf-8')
}

export function declineImport(userData: string, now: number = Date.now()): void {
  writeResult(userData, { state: 'declined', at: new Date(now).toISOString() })
}

export function acknowledgeImport(userData: string): void {
  const result = readResult(userData)
  if (result) writeResult(userData, { ...result, acknowledged: true })
}

/**
 * The App Store edition's settings, made fit for this build: security-scoped
 * bookmarks mean nothing outside the sandbox, and secrets never travel in
 * settings. (The renderer records the version silently after an import, so the
 * post-update notes do not stack on the import summary.)
 */
export function transformSettings(raw: unknown): Record<string, unknown> {
  const settings = { ...(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) }
  delete settings.masDirectoryBookmark
  for (const key of ['projects', 'favorites'] as const) {
    const list = settings[key]
    if (Array.isArray(list)) {
      settings[key] = list.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry
        const { bookmark: _bookmark, ...rest } = entry as Record<string, unknown>
        return rest
      })
    }
  }
  const llm = settings.llm
  if (llm && typeof llm === 'object') settings.llm = { ...(llm as object), apiKey: '' }
  const remarkable = settings.remarkable
  if (remarkable && typeof remarkable === 'object') settings.remarkable = { ...(remarkable as object), deviceToken: '' }
  return settings
}

/** Paths the settings point at that only the App Store edition can see. */
export function filesInsideContainer(settings: Record<string, unknown>, containerDir: string | null): string[] {
  if (!containerDir) return []
  const prefix = containerDir.endsWith(sep) ? containerDir : containerDir + sep
  const paths: string[] = []
  const recent = settings.recentFiles
  if (Array.isArray(recent)) for (const p of recent) if (typeof p === 'string') paths.push(p)
  for (const key of ['projects', 'favorites'] as const) {
    const list = settings[key]
    if (Array.isArray(list)) {
      for (const entry of list) {
        const p = (entry as { path?: unknown } | null)?.path
        if (typeof p === 'string') paths.push(p)
      }
    }
  }
  if (typeof settings.defaultSaveDirectory === 'string') paths.push(settings.defaultSaveDirectory)
  return [...new Set(paths.filter((p) => p.startsWith(prefix)))]
}

function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}

/**
 * Run an import the renderer requested, if one is pending. Synchronous and
 * called before anything opens the profile. Copies every allowlisted item into
 * a staging folder; only when all copies succeeded does it move each replaced
 * item into a backup folder and rename the staged one into place, so a failed
 * copy changes nothing. The App Store container is only read.
 */
export function runPendingImport(
  userData: string,
  source: AppStoreSource | null,
  opts: { now?: number; log?: (message: string) => void } = {}
): ImportResult | null {
  const now = opts.now ?? Date.now()
  const log = opts.log ?? ((message: string) => console.log(`[AppStoreImport] ${message}`))
  const pendingPath = join(userData, PENDING_FILE)
  if (!existsSync(pendingPath)) return null

  let requestedAt = 0
  try {
    requestedAt = Number((readJson(pendingPath) as { requestedAt?: unknown }).requestedAt) || 0
  } catch {
    // An unreadable marker is treated as expired.
  }
  // Remove the marker before doing anything: a crash mid-import must not
  // retry on every launch.
  rmSync(pendingPath, { force: true })
  if (now - requestedAt > PENDING_TTL_MS || requestedAt > now) {
    log('Pending import expired; ignored')
    return null
  }

  const at = new Date(now).toISOString()
  const fail = (error: ImportResult['error'], message: string): ImportResult => {
    const result: ImportResult = { state: 'failed', at, error, message }
    writeResult(userData, result)
    log(`Import failed (${error}): ${message}`)
    return result
  }

  if (!source || !existsSync(source.dataDir)) return fail('nothing-to-import', 'No App Store edition data was found.')
  if (isAppStoreEditionRunning(source.dataDir)) return fail('running', 'The App Store edition of Prose is running.')

  const staging = join(userData, `.app-store-import-staging-${stamp(now)}`)
  const copied: string[] = []
  const skipped: string[] = []
  const stagedCredentials: string[] = []
  let containerFiles: string[] = []
  try {
    mkdirSync(staging, { recursive: true })
    for (const item of IMPORT_ITEMS) {
      const src = join(source.dataDir, item)
      if (!existsSync(src)) {
        skipped.push(item)
        continue
      }
      if (item === 'settings.json') {
        const settings = transformSettings(readJson(src))
        containerFiles = filesInsideContainer(settings, source.containerDir)
        writeFileSync(join(staging, item), JSON.stringify(settings, null, 2), 'utf-8')
      } else {
        cpSync(src, join(staging, item), { recursive: true })
      }
      copied.push(item)
    }
    for (const name of IMPORTABLE_CREDENTIALS) {
      const src = join(source.dataDir, 'credentials', name)
      if (!existsSync(src)) continue
      mkdirSync(join(staging, STAGED_DIR, 'credentials'), { recursive: true })
      cpSync(src, join(staging, STAGED_DIR, 'credentials', name))
      stagedCredentials.push(name)
    }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    return fail('copy-failed', err instanceof Error ? err.message : String(err))
  }

  if (copied.length === 0) {
    rmSync(staging, { recursive: true, force: true })
    return fail('nothing-to-import', 'The App Store edition has no data to import.')
  }

  // Swap: back up what is replaced, rename the staged copy in.
  const toSwap = [...copied, ...(stagedCredentials.length > 0 ? [STAGED_DIR] : [])]
  const backupDir = join(userData, `before-app-store-import-${stamp(now)}`)
  const backedUp: string[] = []
  const swapped: string[] = []
  try {
    for (const item of toSwap) {
      const dest = join(userData, item)
      if (existsSync(dest)) {
        mkdirSync(backupDir, { recursive: true })
        renameSync(dest, join(backupDir, item))
        backedUp.push(item)
      }
      renameSync(join(staging, item), dest)
      swapped.push(item)
    }
  } catch (err) {
    // Best-effort rollback: put back what was moved aside.
    for (const item of swapped) rmSync(join(userData, item), { recursive: true, force: true })
    for (const item of backedUp) {
      try { renameSync(join(backupDir, item), join(userData, item)) } catch { /* left in the backup */ }
    }
    rmSync(staging, { recursive: true, force: true })
    return fail('copy-failed', err instanceof Error ? err.message : String(err))
  }
  rmSync(staging, { recursive: true, force: true })

  const result: ImportResult = {
    state: 'imported',
    at,
    copied,
    skipped,
    ...(backedUp.length > 0 ? { backupDir } : {}),
    stagedCredentials,
    containerFiles
  }
  writeResult(userData, result)
  log(`Imported ${copied.join(', ')}${stagedCredentials.length ? `; staged ${stagedCredentials.join(', ')}` : ''}${backedUp.length ? `; backed up ${backedUp.join(', ')} to ${backupDir}` : ''}`)
  return result
}

/** Printable, no whitespace, plausibly a key: a wrong-key decrypt can yield garbage. */
function looksLikeSecret(value: string): boolean {
  return /^[\x21-\x7e]{8,}$/.test(value)
}

/**
 * Bring the staged credentials over, on the user's say-so only: decrypting may
 * raise a keychain prompt, and may fail outright because the App Store and
 * Developer ID signatures read different keychain items. The staged copies are
 * removed whatever happens.
 */
export async function importStagedKeys(
  userData: string,
  deps: {
    decrypt: (encrypted: Buffer) => string
    hasKey: (key: string) => Promise<boolean>
    store: (key: string, value: string) => Promise<void>
  }
): Promise<{ imported: string[]; failed: string[]; skipped: string[] }> {
  const imported: string[] = []
  const failed: string[] = []
  const skipped: string[] = []
  try {
    for (const name of listStagedCredentials(userData)) {
      try {
        if (await deps.hasKey(name)) {
          skipped.push(name)
          continue
        }
        const value = deps.decrypt(readFileSync(join(stagedCredentialsDir(userData), name)))
        if (!looksLikeSecret(value)) {
          failed.push(name)
          continue
        }
        await deps.store(name, value)
        imported.push(name)
      } catch {
        failed.push(name)
      }
    }
  } finally {
    discardStagedKeys(userData)
  }
  return { imported, failed, skipped }
}

export function discardStagedKeys(userData: string): void {
  rmSync(join(userData, STAGED_DIR), { recursive: true, force: true })
  const result = readResult(userData)
  if (result?.stagedCredentials?.length) writeResult(userData, { ...result, stagedCredentials: [] })
}
