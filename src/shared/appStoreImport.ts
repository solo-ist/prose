/**
 * Shapes shared by main, preload and renderer for the App Store edition
 * import (#1243). The mechanics live in `src/main/appStoreImport.ts`.
 */

export interface AppStoreImportResult {
  state: 'imported' | 'declined' | 'failed'
  at: string
  copied?: string[]
  skipped?: string[]
  /** Where this profile's replaced items were moved. */
  backupDir?: string
  /** Credential files waiting for the user's say-so. */
  stagedCredentials?: string[]
  /** Recent files, projects and favorites that live inside the App Store container. */
  containerFiles?: string[]
  error?: 'running' | 'nothing-to-import' | 'copy-failed'
  message?: string
  /** The summary has been shown. */
  acknowledged?: boolean
}

export interface AppStoreImportStatus {
  available: boolean
  /** Offer automatically: available, this profile is fresh, nothing decided yet. */
  offer: boolean
  result: AppStoreImportResult | null
  stagedCredentials: string[]
}

export type AppStoreImportStart = { ok: true } | { ok: false; reason: 'unavailable' | 'running' }

export interface AppStoreImportKeysResult {
  imported: string[]
  failed: string[]
  skipped: string[]
}
