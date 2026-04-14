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
import { access, copyFile, writeFile, mkdir, readdir } from 'fs/promises'
import { app } from 'electron'
import { LEGACY_SETTINGS_DIR } from './paths'

const SENTINEL = 'migration-v2.done'
const LOG_FILE = 'migration.log'

const FILES_TO_MIGRATE = ['settings.json', 'dictionary.json']

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function migrateFromLegacyDir(): Promise<void> {
  try {
    const newDir = app.getPath('userData')
    await mkdir(newDir, { recursive: true })

    const sentinelPath = join(newDir, SENTINEL)
    if (await exists(sentinelPath)) {
      return
    }

    const log: string[] = []
    let hasErrors = false
    log.push(`[Migration] Started at ${new Date().toISOString()}`)
    log.push(`[Migration] Legacy dir: ${LEGACY_SETTINGS_DIR}`)
    log.push(`[Migration] New dir: ${newDir}`)

    if (!(await exists(LEGACY_SETTINGS_DIR))) {
      log.push('[Migration] Legacy dir does not exist — new user, nothing to migrate')
      await writeLogs(newDir, log, sentinelPath)
      return
    }

    log.push('[Migration] Legacy dir exists — migrating files')

    for (const file of FILES_TO_MIGRATE) {
      const src = join(LEGACY_SETTINGS_DIR, file)
      const dest = join(newDir, file)

      if (!(await exists(src))) {
        log.push(`[Migration] Skipped ${file} — not found at legacy path`)
        continue
      }

      if (await exists(dest)) {
        log.push(`[Migration] Skipped ${file} — already exists at destination`)
        continue
      }

      try {
        await copyFile(src, dest)
        log.push(`[Migration] Copied ${file}`)
      } catch (err) {
        hasErrors = true
        log.push(`[Migration] ERROR copying ${file}: ${err instanceof Error ? err.message : err}`)
      }
    }

    // Copy credentials directory (safeStorage-encrypted blobs)
    const legacyCreds = join(LEGACY_SETTINGS_DIR, 'credentials')
    const newCreds = join(newDir, 'credentials')
    if (await exists(legacyCreds)) {
      try {
        await mkdir(newCreds, { recursive: true })
        const files = await readdir(legacyCreds)
        let copied = 0
        for (const file of files) {
          const dest = join(newCreds, file)
          if (!(await exists(dest))) {
            await copyFile(join(legacyCreds, file), dest)
            copied++
          }
        }
        log.push(`[Migration] Copied credentials/ (${copied} files)`)
      } catch (err) {
        hasErrors = true
        log.push(`[Migration] ERROR copying credentials/: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      log.push('[Migration] Skipped credentials/ — not found at legacy path')
    }

    // Only write sentinel if all copies succeeded — allows retry on next launch
    await writeLogs(newDir, log, hasErrors ? null : sentinelPath)

    for (const line of log) {
      console.log(line)
    }

    if (hasErrors) {
      console.warn('[Migration] Completed with errors — will retry on next launch')
    }
  } catch (err) {
    console.error('[Migration] Fatal error:', err instanceof Error ? err.message : err)
    // Never throw — the app must still start even if migration fails
  }
}

async function writeLogs(newDir: string, log: string[], sentinelPath: string | null): Promise<void> {
  try {
    await writeFile(join(newDir, LOG_FILE), log.join('\n') + '\n', 'utf-8')
  } catch {
    // Best-effort logging
  }
  if (sentinelPath) {
    try {
      await writeFile(sentinelPath, JSON.stringify({ migratedAt: new Date().toISOString() }), 'utf-8')
    } catch {
      // Best-effort sentinel
    }
  }
}
