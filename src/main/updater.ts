import { BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'

export async function initAutoUpdater(mainWindow: BrowserWindow): Promise<void> {
  // @ts-expect-error — __IS_MAS_BUILD__ defined by electron-vite
  if (typeof __IS_MAS_BUILD__ !== 'undefined' && __IS_MAS_BUILD__) {
    console.log('[Updater] Disabled in Mac App Store build')
    return
  }

  if (is.dev) {
    console.log('[Updater] Skipping auto-updater in dev mode')
    return
  }

  try {
    const { autoUpdater } = await import('electron-updater')

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = true

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
