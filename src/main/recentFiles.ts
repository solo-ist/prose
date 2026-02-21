import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const PROSE_DIR = join(homedir(), '.prose')
const RECENT_FILES_PATH = join(PROSE_DIR, 'recent-files.json')
const MAX_RECENT_FILES = 20

export function loadRecentFiles(): string[] {
  try {
    const data = readFileSync(RECENT_FILES_PATH, 'utf-8')
    const files = JSON.parse(data) as string[]
    if (!Array.isArray(files)) return []
    return files.filter(f => typeof f === 'string' && existsSync(f))
  } catch {
    return []
  }
}

function saveRecentFiles(files: string[]): void {
  try {
    mkdirSync(PROSE_DIR, { recursive: true })
    writeFileSync(RECENT_FILES_PATH, JSON.stringify(files, null, 2), 'utf-8')
  } catch (err) {
    console.error('[recentFiles] Failed to save recent files:', err)
  }
}

export function addRecentFile(filePath: string): void {
  const files = loadRecentFiles()
  // Remove if already in list (move to front)
  const filtered = files.filter(f => f !== filePath)
  filtered.unshift(filePath)
  saveRecentFiles(filtered.slice(0, MAX_RECENT_FILES))
}

export function clearRecentFiles(): void {
  saveRecentFiles([])
}
