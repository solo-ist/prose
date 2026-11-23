/**
 * IPC for the App Store edition import (#1243). The mechanics and the reasons
 * behind them are in `appStoreImport.ts`; every handler here reports
 * "unavailable" on an App Store build, which never imports from itself.
 */
import { app, ipcMain, safeStorage } from 'electron'
import { IS_MAS_BUILD } from './env'
import { credentialStore } from './credentialStore'
import {
  acknowledgeImport,
  appStoreAvailable,
  appStoreSource,
  declineImport,
  discardStagedKeys,
  importStagedKeys,
  importStatus,
  isAppStoreEditionRunning,
  listStagedCredentials,
  requestImport,
  type ImportStatus
} from './appStoreImport'

const UNAVAILABLE: ImportStatus = { available: false, offer: false, result: null, stagedCredentials: [] }

export function setupAppStoreImportHandlers(): void {
  const userData = (): string => app.getPath('userData')

  ipcMain.handle('appStoreImport:status', (): ImportStatus => {
    if (IS_MAS_BUILD) return UNAVAILABLE
    return importStatus(userData(), appStoreSource(), app.isPackaged)
  })

  // Stage the import and restart: the copy runs at the next launch, before
  // anything opens the profile (LevelDB is never copied or replaced while open).
  ipcMain.handle('appStoreImport:start', (): { ok: true } | { ok: false; reason: 'unavailable' | 'running' } => {
    if (IS_MAS_BUILD) return { ok: false, reason: 'unavailable' }
    const source = appStoreSource()
    if (!appStoreAvailable(source, app.isPackaged)) return { ok: false, reason: 'unavailable' }
    if (isAppStoreEditionRunning(source.dataDir)) return { ok: false, reason: 'running' }
    requestImport(userData())
    console.log('[AppStoreImport] Import requested; restarting')
    // After the reply has gone back. The e2e seam quits without relaunching,
    // so a test run never leaves a second app behind.
    setImmediate(() => {
      if (process.env.PROSE_IMPORT_RELAUNCH !== '0') app.relaunch()
      app.quit()
    })
    return { ok: true }
  })

  ipcMain.handle('appStoreImport:decline', (): void => {
    if (IS_MAS_BUILD) return
    declineImport(userData())
  })

  ipcMain.handle('appStoreImport:acknowledge', (): void => {
    if (IS_MAS_BUILD) return
    acknowledgeImport(userData())
  })

  // On the user's say-so only: decrypting the App Store edition's key may raise
  // a keychain prompt, or fail because the two signatures read different items.
  ipcMain.handle('appStoreImport:importKeys', async () => {
    if (IS_MAS_BUILD || !safeStorage.isEncryptionAvailable()) {
      const staged = listStagedCredentials(userData())
      discardStagedKeys(userData())
      return { imported: [], failed: staged, skipped: [] }
    }
    const result = await importStagedKeys(userData(), {
      decrypt: (encrypted) => safeStorage.decryptString(encrypted),
      hasKey: async (key) => (await credentialStore.get(key)) !== null,
      store: (key, value) => credentialStore.set(key, value)
    })
    console.log(`[AppStoreImport] Keys: imported ${result.imported.length}, failed ${result.failed.length}, skipped ${result.skipped.length}`)
    return result
  })

  ipcMain.handle('appStoreImport:discardKeys', (): void => {
    discardStagedKeys(userData())
  })
}
