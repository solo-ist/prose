import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getSettingsDir } from './paths'

function getSettingsPath(): string { return join(getSettingsDir(), 'settings.json') }

/**
 * Load recent files from userData/settings.json (same source as the renderer's settingsStore).
 * Filters out files that no longer exist on disk.
 */
export function loadRecentFiles(): string[] {
  try {
    const data = readFileSync(getSettingsPath(), 'utf-8')
    const settings = JSON.parse(data)
    const files = settings?.recentFiles
    if (!Array.isArray(files)) return []
    return files.filter((f: unknown) => typeof f === 'string' && existsSync(f as string)) as string[]
  } catch {
    return []
  }
}

/**
 * Clear recent files in userData/settings.json.
 * Reads the full settings, removes recentFiles, and writes back.
 */
export function clearRecentFiles(): void {
  try {
    const data = readFileSync(getSettingsPath(), 'utf-8')
    const settings = JSON.parse(data)
    settings.recentFiles = []
    writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch {
    // Settings file doesn't exist or can't be parsed — nothing to clear
  }
}
