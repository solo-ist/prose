/**
 * Centralized settings directory paths.
 *
 * All main-process code that reads/writes user data should import from here
 * instead of computing paths independently.
 */
import { join, normalize, resolve, sep, dirname, basename } from 'path'
import { homedir } from 'os'
import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { realpath, stat } from 'fs/promises'
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

// ---------------------------------------------------------------------------
// Filesystem path handling for IPC handlers
//
// Two very different tools live here. Read both docblocks before picking one.
// ---------------------------------------------------------------------------

/** Expand a leading `~` to the user's home directory. */
export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  if (path === '~') {
    return homedir()
  }
  return path
}

/**
 * Normalize a filesystem path for a USER-CHOSEN source (dialog result, a file
 * explorer entry, a settings root, the current tab's path).
 *
 * This is a NORMALIZER, NOT CONTAINMENT. `normalize()` resolves `..` before the
 * traversal check runs, so `/docs/a/../../etc/x` comes back as `/etc/x` and
 * passes clean. That is acceptable only because the user named the path.
 * Any handler whose path can be influenced by DOCUMENT CONTENT, an imported
 * artifact, a deep link, or an LLM/MCP tool argument must use `resolveWithin()`
 * with an explicit root instead (audit H-03, #918).
 */
export function normalizePath(inputPath: string): string {
  const expanded = expandPath(inputPath)
  const normalized = normalize(expanded)
  if (normalized.includes('..')) {
    throw new Error('Path traversal not allowed')
  }
  return normalized
}

/** Image extensions the `local-file:` protocol and `file:readBase64` will serve. */
export const IMAGE_EXTENSIONS: readonly string[] = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'
]

/**
 * Text extensions the LLM / MCP file tools may read or write. Keeps a
 * prompt-injected `read_file` from pulling keys, databases or binaries into the
 * model context.
 */
export const TOOL_TEXT_EXTENSIONS: readonly string[] = [
  'md', 'markdown', 'mdx', 'txt', 'html', 'htm', 'json', 'yaml', 'yml', 'csv'
]

export interface ContainmentOptions {
  /** Allowed file extensions (lowercase, no dot). Omit to allow any. */
  extensions?: readonly string[]
  /** Short noun for the extension error, e.g. 'image' → "limited to image files". */
  kind?: string
  /** Allow the target to be a directory (`list_files`). Default false. */
  allowDirectory?: boolean
  /** Allow segments below root that start with `.` (hidden folders/files). Default true. */
  allowDotSegments?: boolean
  /** Allow a target that does not exist yet (writes). Its parent must exist and be contained. */
  allowMissing?: boolean
  /** Human label for the root in error messages, e.g. 'the document directory'. */
  label?: string
}

/** Error thrown by `resolveWithin()`; `code` feeds `toFileOperationFailure()`. */
export class PathContainmentError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'PathContainmentError'
  }
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep)
}

function assertNoDotSegments(path: string, root: string, label: string): void {
  if (path === root) return
  const relative = path.slice(root.length + 1)
  if (relative.split(sep).some((segment) => segment.startsWith('.'))) {
    throw new PathContainmentError(
      `Hidden files and folders are not accessible under ${label}`,
      'EOUTSIDE'
    )
  }
}

/**
 * Resolve `candidate` against `root` and prove the REAL target stays inside it.
 *
 * Steps: expand `~` → resolve → lexical prefix check (fast reject for `..`) →
 * realpath both sides (readFile follows symlinks, so a lexically-contained
 * `inline.png` that links to `~/.ssh/id_rsa` would otherwise leak) → prefix
 * check again → optional hidden-segment, directory and extension rules, all
 * evaluated on the real path (defeats `inline.png` → `secret.key`).
 *
 * Returns the canonical path to operate on. Throws `PathContainmentError`.
 */
export async function resolveWithin(
  root: string,
  candidate: string,
  options: ContainmentOptions = {}
): Promise<string> {
  const label = options.label ?? 'the allowed directory'
  if (typeof root !== 'string' || !root) {
    throw new PathContainmentError('A containment root is required', 'EOUTSIDE')
  }
  const resolvedRoot = resolve(expandPath(root))
  const resolved = resolve(resolvedRoot, expandPath(String(candidate ?? '')))
  if (!isInside(resolved, resolvedRoot)) {
    throw new PathContainmentError(`Path resolves outside ${label}`, 'EOUTSIDE')
  }
  // Lexical hidden-segment check first, so a probe for a non-existent file
  // under `.ssh/` is refused as hidden rather than reported as not found.
  if (options.allowDotSegments === false) assertNoDotSegments(resolved, resolvedRoot, label)

  let realRoot: string
  try {
    realRoot = await realpath(resolvedRoot)
  } catch {
    throw new PathContainmentError(`${label} does not exist`, 'ENOENT')
  }

  let realTarget: string
  let exists = true
  try {
    realTarget = await realpath(resolved)
  } catch {
    if (!options.allowMissing) {
      throw new PathContainmentError('Target not found', 'ENOENT')
    }
    // A write to a new file: canonicalize the parent, keep the final segment.
    let realParent: string
    try {
      realParent = await realpath(dirname(resolved))
    } catch {
      throw new PathContainmentError('Target directory not found', 'ENOENT')
    }
    realTarget = join(realParent, basename(resolved))
    exists = false
  }

  if (!isInside(realTarget, realRoot)) {
    throw new PathContainmentError(`Path resolves outside ${label}`, 'EOUTSIDE')
  }

  // Again on the REAL path: a visible symlink may resolve into a hidden folder.
  if (options.allowDotSegments === false) assertNoDotSegments(realTarget, realRoot, label)

  let isDirectory = false
  if (exists) {
    try {
      isDirectory = (await stat(realTarget)).isDirectory()
    } catch {
      isDirectory = false
    }
  }
  if (isDirectory) {
    if (!options.allowDirectory) {
      throw new PathContainmentError('Expected a file but found a directory', 'EISDIR')
    }
    return realTarget
  }

  if (options.extensions) {
    const ext = basename(realTarget).includes('.')
      ? realTarget.split('.').pop()?.toLowerCase() ?? ''
      : ''
    if (!options.extensions.includes(ext)) {
      throw new PathContainmentError(
        `Access is limited to ${options.kind ?? 'allowed'} files`,
        'ENOTALLOWED'
      )
    }
  }

  return realTarget
}

/**
 * Containment policy for LLM / MCP tool file access: text files under the
 * user's home folder, never inside a hidden folder. Chosen 2026-10-10 (#918):
 * "open ~/notes/x.md" keeps working for the chat and for Claude Desktop, while
 * a prompt-injected `read_file ~/.ssh/id_rsa` or `save_file /etc/...` is refused.
 */
export function resolveToolPath(
  candidate: string,
  options: Pick<ContainmentOptions, 'allowDirectory' | 'allowMissing'> = {}
): Promise<string> {
  return resolveWithin(homedir(), candidate, {
    extensions: options.allowDirectory ? undefined : TOOL_TEXT_EXTENSIONS,
    kind: 'text',
    allowDotSegments: false,
    label: 'your home folder',
    ...options
  })
}
