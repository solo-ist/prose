/**
 * One-time migration from legacy ~/.prose/ to app.getPath('userData').
 *
 * Copies settings.json and dictionary.json only.
 * Does NOT copy credentials/ — safeStorage encryption keys differ between
 * sandboxed and non-sandboxed app identities, so copied blobs would be garbage.
 * Users re-enter their API key on first launch after migration.
 */
import { join } from 'path'
import { existsSync, copyFileSync, writeFileSync, mkdirSync } from 'fs'
import { app } from 'electron'
import { LEGACY_SETTINGS_DIR } from './paths'

const SENTINEL = 'migration-v2.done'
const LOG_FILE = 'migration.log'

const FILES_TO_MIGRATE = ['settings.json', 'dictionary.json']

export async function migrateFromLegacyDir(): Promise<void> {
  try {
    const newDir = app.getPath('userData')
    mkdirSync(newDir, { recursive: true })

    const sentinelPath = join(newDir, SENTINEL)
    if (existsSync(sentinelPath)) {
      return
    }

    const log: string[] = []
    log.push(`[Migration] Started at ${new Date().toISOString()}`)
    log.push(`[Migration] Legacy dir: ${LEGACY_SETTINGS_DIR}`)
    log.push(`[Migration] New dir: ${newDir}`)

    if (!existsSync(LEGACY_SETTINGS_DIR)) {
      log.push('[Migration] Legacy dir does not exist — new user, nothing to migrate')
      writeLogs(newDir, log, sentinelPath)
      return
    }

    log.push('[Migration] Legacy dir exists — migrating files')

    for (const file of FILES_TO_MIGRATE) {
      const src = join(LEGACY_SETTINGS_DIR, file)
      const dest = join(newDir, file)

      if (!existsSync(src)) {
        log.push(`[Migration] Skipped ${file} — not found at legacy path`)
        continue
      }

      if (existsSync(dest)) {
        log.push(`[Migration] Skipped ${file} — already exists at destination`)
        continue
      }

      try {
        copyFileSync(src, dest)
        log.push(`[Migration] Copied ${file}`)
      } catch (err) {
        log.push(`[Migration] ERROR copying ${file}: ${err instanceof Error ? err.message : err}`)
      }
    }

    log.push('[Migration] NOTE: credentials/ not copied — safeStorage keys differ between sandbox identities')

    writeLogs(newDir, log, sentinelPath)

    for (const line of log) {
      console.log(line)
    }
  } catch (err) {
    console.error('[Migration] Fatal error:', err instanceof Error ? err.message : err)
    // Never throw — the app must still start even if migration fails
  }
}

function writeLogs(newDir: string, log: string[], sentinelPath: string): void {
  try {
    writeFileSync(join(newDir, LOG_FILE), log.join('\n') + '\n', 'utf-8')
  } catch {
    // Best-effort logging
  }
  try {
    writeFileSync(sentinelPath, JSON.stringify({ migratedAt: new Date().toISOString() }), 'utf-8')
  } catch {
    // Best-effort sentinel
  }
}
