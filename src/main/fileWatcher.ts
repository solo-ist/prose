/**
 * fileWatcher.ts
 *
 * Manages a single chokidar watcher for the directory currently displayed in
 * the File Explorer. When the watched directory changes, the old watcher is
 * disposed and a new one is started. File-system events are forwarded to the
 * renderer via IPC push events:
 *
 *   file:watch:event  — { type: 'created' | 'deleted' | 'changed', path: string }
 *
 * Renames are reported as an unlink + add pair by chokidar (no native rename
 * event), so we don't model them separately. The renderer just reloads on
 * any event regardless of type.
 */

import { ipcMain, BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import { basename, isAbsolute, relative } from 'path'
import { validatePath } from './ipc'

export interface FileWatchEvent {
  // chokidar emits 'unlink' + 'add' for renames rather than a 'rename' event,
  // so we don't model 'renamed' explicitly — the renderer just reloads on any
  // event regardless of type.
  type: 'created' | 'deleted' | 'changed'
  path: string
}

type ChokidarWatcher = ReturnType<typeof chokidar.watch>

// The single active root watcher (null when no directory is being watched).
// Single-window assumption: state is global; if Prose ever opens multiple
// windows with different File Explorer roots, both will share one watcher
// and broadcast each other's events. Revisit when adding multi-window.
let activeWatcher: ChokidarWatcher | null = null
let watchedDirectory: string | null = null

// Additional shallow watchers for expanded folders beneath watchedDirectory.
// This keeps work bounded to visible tree state instead of recursively watching
// the entire root directory.
const expandedFolderWatchers = new Map<string, ChokidarWatcher>()

/**
 * Serialize lifecycle operations on the watcher. Without this, fire-and-forget
 * IPC calls from the renderer can interleave at the main process — e.g., a
 * `null → B` transition where `start(B)` resolves before `stop(null)` would
 * leave the watcher torn down. The queue makes lifecycle ordering deterministic.
 */
let watcherOpQueue: Promise<void> = Promise.resolve()

function enqueueWatcherOp(op: () => Promise<void>): Promise<void> {
  // Chain on settled (not just resolved) so a failed op doesn't poison the queue.
  watcherOpQueue = watcherOpQueue.then(op, op)
  return watcherOpQueue
}

/**
 * Send a file-watch event to every open BrowserWindow renderer.
 */
function sendEvent(event: FileWatchEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('file:watch:event', event)
    }
  }
}

function createShallowWatcher(normalized: string): ChokidarWatcher {
  const watcher = chokidar.watch(normalized, {
    // Watch only the immediate children of this directory, not subdirectories.
    // The File Explorer uses lazy loading for subdirectories; expanded folders
    // get their own shallow watcher when needed.
    depth: 0,
    // Ignore dotfiles — match only the LEAF segment, never an ancestor.
    // A naive `/(^|[/\\])\../` regex would suppress every event when the
    // watched root sits beneath a hidden parent (e.g., `/Users/me/.config/notes`).
    // The `!== normalized` guard preserves events on the watched root itself.
    ignored: (filePath: string) =>
      filePath !== normalized && basename(filePath).startsWith('.'),
    // Don't report the initial scan as added events
    ignoreInitial: true,
    // Don't wait for write-finish; the renderer-side debounce coalesces bursts.
    awaitWriteFinish: false,
    // Use native OS events where available (FSEvents on macOS)
    usePolling: false,
    // Persist the watcher even when the watched directory is temporarily
    // inaccessible (e.g., network drive goes offline)
    persistent: true,
  })

  watcher.on('add', (filePath) => {
    sendEvent({ type: 'created', path: filePath })
  })

  watcher.on('addDir', (dirPath) => {
    sendEvent({ type: 'created', path: dirPath })
  })

  watcher.on('change', (filePath) => {
    sendEvent({ type: 'changed', path: filePath })
  })

  watcher.on('unlink', (filePath) => {
    sendEvent({ type: 'deleted', path: filePath })
  })

  watcher.on('unlinkDir', (dirPath) => {
    sendEvent({ type: 'deleted', path: dirPath })
  })

  // chokidar fires 'unlink' + 'add' for renames; we map that via the events
  // above. No native 'rename' event needed — the renderer just reloads.

  watcher.on('error', (error) => {
    console.error('[FileWatcher] Watcher error:', error)
  })

  return watcher
}

async function closeExpandedFolderWatchers(): Promise<void> {
  const closes = Array.from(expandedFolderWatchers.values()).map(async (watcher) => {
    try {
      await watcher.close()
    } catch {
      // Ignore close errors
    }
  })
  expandedFolderWatchers.clear()
  await Promise.all(closes)
}

function isWatchableExpandedFolder(dirPath: string): boolean {
  if (!watchedDirectory || dirPath === watchedDirectory) return false
  const relativePath = relative(watchedDirectory, dirPath)
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

async function syncExpandedFolderWatchers(expandedFolders: string[]): Promise<void> {
  if (!watchedDirectory) {
    await closeExpandedFolderWatchers()
    return
  }

  const nextExpandedFolders = new Set(
    expandedFolders.filter(isWatchableExpandedFolder)
  )

  const closeRemoved = Array.from(expandedFolderWatchers.entries()).map(
    async ([dirPath, watcher]) => {
      if (nextExpandedFolders.has(dirPath)) return
      expandedFolderWatchers.delete(dirPath)
      try {
        await watcher.close()
      } catch {
        // Ignore close errors
      }
      console.log('[FileWatcher] Expanded folder watcher stopped:', dirPath)
    }
  )
  await Promise.all(closeRemoved)

  for (const dirPath of nextExpandedFolders) {
    if (expandedFolderWatchers.has(dirPath)) continue
    console.log('[FileWatcher] Starting expanded folder watcher for:', dirPath)
    expandedFolderWatchers.set(dirPath, createShallowWatcher(dirPath))
  }
}

/**
 * Stop and dispose the current watcher, if any.
 */
async function stopWatcher(): Promise<void> {
  await closeExpandedFolderWatchers()
  if (activeWatcher) {
    try {
      await activeWatcher.close()
    } catch {
      // Ignore close errors
    }
    activeWatcher = null
    watchedDirectory = null
    console.log('[FileWatcher] Watcher stopped')
  }
}

/**
 * Start watching a new directory. Disposes any existing watcher first.
 * Caller is responsible for path validation; this function takes an already-
 * normalized absolute path (the IPC handler runs validatePath upstream).
 */
async function startWatcher(normalized: string): Promise<void> {
  // No-op if we're already watching this exact directory
  if (watchedDirectory === normalized) return

  await stopWatcher()

  console.log('[FileWatcher] Starting watcher for:', normalized)

  activeWatcher = createShallowWatcher(normalized)
  watchedDirectory = normalized
}

/**
 * Register IPC handlers for watcher lifecycle control.
 * Called once from src/main/index.ts after the window is created.
 *
 * Channels:
 *   file:watch:start  (invokable) — start watching a directory
 *   file:watch:stop   (invokable) — stop the current watcher
 *   file:watch:set-expanded-folders (invokable) — sync expanded folder paths
 */
export function setupFileWatcherHandlers(): void {
  ipcMain.handle('file:watch:start', async (_event, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string') return
    // Project security rule: every filesystem IPC handler must validatePath().
    // Expands ~ and blocks traversal sequences in one shared helper.
    let normalized: string
    try {
      normalized = validatePath(dirPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[FileWatcher] Rejected path:', dirPath, '—', message)
      return
    }
    await enqueueWatcherOp(() => startWatcher(normalized))
  })

  ipcMain.handle('file:watch:stop', async () => {
    await enqueueWatcherOp(() => stopWatcher())
  })

  ipcMain.handle('file:watch:set-expanded-folders', async (_event, folderPaths: string[]) => {
    if (!Array.isArray(folderPaths)) return
    const normalizedPaths: string[] = []
    for (const folderPath of folderPaths) {
      if (!folderPath || typeof folderPath !== 'string') continue
      try {
        normalizedPaths.push(validatePath(folderPath))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[FileWatcher] Rejected expanded folder path:', folderPath, '—', message)
      }
    }
    await enqueueWatcherOp(() => syncExpandedFolderWatchers(normalizedPaths))
  })
}

/**
 * Stop the active watcher on app quit. Called from the app 'will-quit' event
 * in src/main/index.ts. Routes through the same queue so it can't race with
 * an in-flight start/stop. IPC handler registrations are left in place — they
 * get reclaimed by the process exit a moment later.
 */
export async function teardownFileWatcher(): Promise<void> {
  await enqueueWatcherOp(() => stopWatcher())
}
