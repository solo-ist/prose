import { BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IS_MAS_BUILD } from './env'
import { markQuitting } from './quitState'

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

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false

    let updateDownloaded = false
    let installInvoked = false

    autoUpdater.on('update-available', (info) => {
      console.log('[Updater] Update available:', info.version)
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
      console.log('[Updater] Update downloaded:', info.version)
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:update-downloaded', {
          version: info.version
        })
      }
    })

    autoUpdater.on('error', (error) => {
      console.error('[Updater] Error:', error.message)
    })

    // IPC handlers
    ipcMain.handle('updater:download', async () => {
      await autoUpdater.downloadUpdate()
      return { success: true }
    })

    ipcMain.handle('updater:install', () => {
      if (!updateDownloaded) return
      // Re-entrancy guard: a second QuitAndInstall call double-registers an
      // observer in Electron's native auto-updater and trips a NOTREACHED
      // (electron_api_auto_updater.cc:118), which bails out before the actual
      // quit/relaunch — see Sentry PROSE-H.
      if (installInvoked) {
        console.warn('[Updater] install ignored — already invoked')
        return
      }
      installInvoked = true
      // electron-updater calls Electron's native autoUpdater.quitAndInstall(),
      // which closes all windows BEFORE firing `before-quit`. Our macOS
      // hide-on-close handler would otherwise swallow the close and leave the
      // app running in the background, with the user seeing the window vanish
      // but no relaunch.
      markQuitting()
      autoUpdater.quitAndInstall()
    })

    ipcMain.handle('updater:check', async () => {
      try {
        const result = await autoUpdater.checkForUpdates()
        console.log('[Updater] Check result:', JSON.stringify(result?.updateInfo))
        return { updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[Updater] Check error:', message)
        return { updateAvailable: false, error: message }
      }
    })

    // Initial check after a short delay (don't slow startup)
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[Updater] Initial check failed:', err.message)
      })
    }, 10_000)

    // Periodic check every 4 hours
    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.warn('[Updater] Periodic check failed:', err.message)
        })
      },
      4 * 60 * 60 * 1000
    )
  } catch (err) {
    console.error('[Updater] Failed to initialize auto-updater:', err)
    return
  }
}
