/**
 * One-time migration from legacy ~/.prose/ to app.getPath('userData').
 *
 * Copies settings.json, dictionary.json, and credentials/.
 * Credentials (safeStorage-encrypted blobs) are copied for non-MAS builds where
 * the app identity stays the same. For MAS builds, the sandbox changes the app
 * identity so safeStorage decryption will fail — users re-enter their API key.
 * We copy anyway since it's harmless (credentialStore.get returns null on
 * decryption failure) and avoids needing IS_MAS_BUILD logic here.
 */
import { join } from 'path'
import { existsSync, copyFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
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

    // Copy credentials directory (safeStorage-encrypted blobs)
    const legacyCreds = join(LEGACY_SETTINGS_DIR, 'credentials')
    const newCreds = join(newDir, 'credentials')
    if (existsSync(legacyCreds)) {
      try {
        mkdirSync(newCreds, { recursive: true })
        const files = readdirSync(legacyCreds)
        let copied = 0
        for (const file of files) {
          const dest = join(newCreds, file)
          if (!existsSync(dest)) {
            copyFileSync(join(legacyCreds, file), dest)
            copied++
          }
        }
        log.push(`[Migration] Copied credentials/ (${copied} files)`)
      } catch (err) {
        log.push(`[Migration] ERROR copying credentials/: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      log.push('[Migration] Skipped credentials/ — not found at legacy path')
    }

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
