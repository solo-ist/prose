import { app, BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { mkdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { IS_MAS_BUILD } from './env'
import { markQuitting } from './quitState'

// Persistent updater logger. electron-updater accepts any object with
// info/warn/error/debug methods. We mirror to the console (visible in dev /
// terminal) AND append to a file under the OS logs dir, because previously
// updater output went to the console only and was lost on packaged builds —
// making field failures like "downloaded but never applied" undiagnosable.
function createUpdaterLogger(): {
  info: (...a: unknown[]) => void
  warn: (...a: unknown[]) => void
  error: (...a: unknown[]) => void
  debug: (...a: unknown[]) => void
} {
  let logPath: string | null = null
  try {
    logPath = join(app.getPath('logs'), 'updater.log')
    mkdirSync(dirname(logPath), { recursive: true })
  } catch {
    // No writable logs dir — fall back to console-only logging.
    logPath = null
  }

  const write = (level: string, args: unknown[]): void => {
    if (!logPath) return
    const msg = args
      .map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    // Fire-and-forget; logging must never crash or block the updater.
    void appendFile(logPath, `${new Date().toISOString()} [${level}] ${msg}\n`).catch(() => {})
  }

  return {
    info: (...args) => {
      console.log('[Updater]', ...args)
      write('info', args)
    },
    warn: (...args) => {
      console.warn('[Updater]', ...args)
      write('warn', args)
    },
    error: (...args) => {
      console.error('[Updater]', ...args)
      write('error', args)
    },
    debug: (...args) => {
      write('debug', args)
    }
  }
}

export async function initAutoUpdater(mainWindow: BrowserWindow): Promise<void> {
  if (IS_MAS_BUILD) {
    console.log('[Updater] Disabled in Mac App Store build')
    return
  }

  if (is.dev) {
    console.log('[Updater] Skipping auto-updater in dev mode')
    return
  }

  try {
    // electron-updater 6.8.x defines `autoUpdater` as a property getter, which
    // Node's ESM↔CJS interop does not expose as a named import. Reach through
    // `.default` (the CJS module.exports) so the getter resolves.
    const updaterModule = await import('electron-updater')
    const autoUpdater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater
    if (!autoUpdater) {
      throw new Error('electron-updater: autoUpdater export not found')
    }

    const logger = createUpdaterLogger()
    autoUpdater.logger = logger

    autoUpdater.autoDownload = false
    // We apply staged updates ourselves (see the before-quit handler below) so
    // that both the explicit "Restart" button and the install-on-quit path run
    // through the SAME guarded `installUpdate()`. electron-updater's built-in
    // autoInstallOnAppQuit fires from the `quit` event — too late on macOS,
    // where the app is already terminating so Squirrel never stages the
    // relaunch — and it bypasses both the markQuitting() hide-on-close guard
    // and the re-entrancy guard. Disabling it makes our before-quit handler the
    // single source of truth.
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false

    let updateDownloaded = false
    let installInvoked = false
    // Set if quitAndInstall() throws before it can quit/relaunch. Gates the
    // before-quit auto-apply so a persistently failing install can't trap the
    // user in a can't-quit loop — the staged update simply retries on next
    // launch instead.
    let installFailed = false

    // Single guarded entry point for applying a staged update. Both the explicit
    // install button (updater:install) and the auto-install-on-quit path funnel
    // through here so the macOS quit/relaunch hardening is applied uniformly.
    // Returns true once quitAndInstall has been handed off, false if it could
    // not start (no update, re-entrant call, or a thrown failure).
    const installUpdate = (): boolean => {
      if (!updateDownloaded) return false
      // Re-entrancy guard: a second QuitAndInstall double-registers an observer
      // in Electron's native auto-updater and trips a NOTREACHED
      // (electron_api_auto_updater.cc:118), which bails out before the actual
      // quit/relaunch — see Sentry PROSE-H.
      if (installInvoked) {
        logger.warn('install ignored — already invoked')
        return false
      }
      installInvoked = true
      // electron-updater calls Electron's native autoUpdater.quitAndInstall(),
      // which closes all windows BEFORE firing `before-quit`. Our macOS
      // hide-on-close handler would otherwise swallow the close and leave the
      // app running in the background, with the user seeing the window vanish
      // but no relaunch.
      markQuitting()
      logger.info('Applying staged update via quitAndInstall')
      try {
        autoUpdater.quitAndInstall()
        return true
      } catch (err) {
        // quitAndInstall threw before it could quit/relaunch. Re-arm so an
        // explicit "Restart" can retry this session, and flag the failure so the
        // before-quit handler stops intercepting (the user must still be able to
        // quit). The staged update stays in pending/ and retries on next launch.
        installInvoked = false
        installFailed = true
        logger.error('quitAndInstall failed:', err instanceof Error ? err.message : String(err))
        return false
      }
    }

    autoUpdater.on('update-available', (info) => {
      logger.info('Update available:', info.version)
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:update-available', {
          version: info.version,
          releaseNotes: info.releaseNotes
        })
      }
    })

    autoUpdater.on('download-progress', (progress) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:download-progress', {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total
        })
      }
    })

    autoUpdater.on('update-downloaded', (info) => {
      updateDownloaded = true
      logger.info('Update downloaded:', info.version)
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:update-downloaded', {
          version: info.version
        })
      }
    })

    autoUpdater.on('error', (error) => {
      logger.error('Error:', error.message)
    })

    // Apply a staged update when the user quits normally (Cmd+Q, menu Quit, dock
    // Quit, logout/shutdown). With autoInstallOnAppQuit disabled, this is what
    // applies the update in prose-updater/pending/ — otherwise the user would
    // relaunch on the old version. We run on `before-quit` (not `quit`) so we're
    // early enough for Squirrel.Mac to stage the relaunch, and preventDefault so
    // quitAndInstall can drive a clean quit+relaunch itself rather than racing a
    // half-finished termination.
    app.on('before-quit', (event) => {
      if (!updateDownloaded || installInvoked || installFailed) return
      event.preventDefault()
      // If quitAndInstall can't even start, honor the user's quit so they're
      // never left unable to exit; the update retries on next launch.
      if (!installUpdate()) {
        app.quit()
      }
    })

    // IPC handlers
    ipcMain.handle('updater:download', async () => {
      await autoUpdater.downloadUpdate()
      return { success: true }
    })

    ipcMain.handle('updater:install', () => {
      installUpdate()
    })

    ipcMain.handle('updater:check', async () => {
      try {
        const result = await autoUpdater.checkForUpdates()
        logger.info('Check result:', JSON.stringify(result?.updateInfo))
        return { updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('Check error:', message)
        return { updateAvailable: false, error: message }
      }
    })

    // Initial check after a short delay (don't slow startup)
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        logger.warn('Initial check failed:', err.message)
      })
    }, 10_000)

    // Periodic check every 4 hours
    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch((err) => {
          logger.warn('Periodic check failed:', err.message)
        })
      },
      4 * 60 * 60 * 1000
    )
  } catch (err) {
    console.error('[Updater] Failed to initialize auto-updater:', err)
    return
  }
}
