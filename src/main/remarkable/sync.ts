/**
 * reMarkable sync logic - downloads notebooks to local filesystem
 */
import { mkdir, writeFile, readFile } from 'fs/promises'
import { join, dirname, resolve, sep } from 'path'
import { homedir } from 'os'
import { connect, type RemarkableNotebook } from './client'
import JSZip from 'jszip'

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  if (path === '~') {
    return homedir()
  }
  return path
}

/**
 * Sanitize a filename to prevent path traversal attacks
 * Removes path separators, null bytes, and traversal sequences
 */
function sanitizeName(name: string): string {
  return name
    .replace(/\0/g, '') // Remove null bytes
    .replace(/\.\./g, '_') // Replace traversal sequences
    .replace(/[\/\\]/g, '_') // Replace path separators
    .trim() || 'unnamed'
}

/**
 * Verify a resolved path is within the expected base directory
 */
function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const resolvedBase = resolve(baseDir)
  const resolvedTarget = resolve(targetPath)
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep)
}

export interface SyncMetadata {
  lastSyncedAt: string
  notebooks: Record<string, NotebookMetadata>
}

export interface NotebookMetadata {
  name: string
  parent: string | null
  type: 'folder' | 'notebook'
  fileType?: 'epub' | 'pdf' | 'notebook'
  lastModified: string
  hash: string
  localPath: string
}

export interface SyncResult {
  syncedAt: string
  synced: number
  skipped: number
  errors: string[]
}

const META_FILE = '.remarkable-meta.json'

/**
 * Load sync metadata from the sync directory
 */
async function loadMetadata(syncDirectory: string): Promise<SyncMetadata | null> {
  try {
    const metaPath = join(syncDirectory, META_FILE)
    const content = await readFile(metaPath, 'utf-8')
    return JSON.parse(content) as SyncMetadata
  } catch {
    return null
  }
}

/**
 * Save sync metadata to the sync directory
 */
async function saveMetadata(syncDirectory: string, metadata: SyncMetadata): Promise<void> {
  const metaPath = join(syncDirectory, META_FILE)
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8')
}

/**
 * Build the folder path for a notebook based on its parent hierarchy
 * Names are sanitized to prevent path traversal attacks
 */
function buildPath(
  notebook: RemarkableNotebook,
  notebooks: RemarkableNotebook[],
  visited: Set<string> = new Set()
): string {
  // Sanitize the notebook name to prevent path traversal
  const safeName = sanitizeName(notebook.name)

  // Prevent infinite loops from circular references
  if (visited.has(notebook.id)) {
    return safeName
  }
  visited.add(notebook.id)

  if (!notebook.parent) {
    return safeName
  }

  const parent = notebooks.find(n => n.id === notebook.parent)
  if (!parent) {
    return safeName
  }

  return join(buildPath(parent, notebooks, visited), safeName)
}

/**
 * Sync all notebooks from reMarkable cloud to local filesystem
 */
export async function syncAll(
  deviceToken: string,
  syncDirectory: string,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  // Expand ~ to home directory
  const resolvedDir = expandPath(syncDirectory)

  const result: SyncResult = {
    syncedAt: new Date().toISOString(),
    synced: 0,
    skipped: 0,
    errors: []
  }

  try {
    onProgress?.('Connecting to reMarkable cloud...')
    const client = await connect(deviceToken)

    onProgress?.('Fetching notebook list...')
    const notebooks = await client.listNotebooks()

    // Load existing metadata to check what's changed
    const existingMeta = await loadMetadata(resolvedDir)
    const newMeta: SyncMetadata = {
      lastSyncedAt: result.syncedAt,
      notebooks: {}
    }

    // Ensure sync directory exists
    await mkdir(resolvedDir, { recursive: true })

    // First, create all folders
    const folders = notebooks.filter(n => n.type === 'folder')
    for (const folder of folders) {
      const folderPath = buildPath(folder, notebooks)
      const fullPath = join(resolvedDir, folderPath)
      await mkdir(fullPath, { recursive: true })

      newMeta.notebooks[folder.id] = {
        name: folder.name,
        parent: folder.parent,
        type: 'folder',
        lastModified: folder.lastModified,
        hash: folder.hash,
        localPath: folderPath
      }
    }

    // Then, sync notebooks (documents)
    const documents = notebooks.filter(n => n.type === 'notebook')

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      onProgress?.(`Syncing ${i + 1}/${documents.length}: ${doc.name}`)

      try {
        const docPath = buildPath(doc, notebooks)
        const fullPath = join(resolvedDir, docPath)

        // Check if we need to download (hash changed or doesn't exist)
        const existingEntry = existingMeta?.notebooks[doc.id]
        if (existingEntry && existingEntry.hash === doc.hash) {
          result.skipped++
          newMeta.notebooks[doc.id] = existingEntry
          continue
        }

        // Ensure parent directory exists
        await mkdir(dirname(fullPath), { recursive: true })

        // Download the notebook
        const zipData = await client.downloadNotebook(doc.id, doc.hash)

        // Extract the zip contents
        const zip = await JSZip.loadAsync(zipData)
        const notebookDir = fullPath
        await mkdir(notebookDir, { recursive: true })

        // Extract all files from the zip (with path traversal protection)
        const files = Object.keys(zip.files)
        for (const filename of files) {
          const file = zip.files[filename]
          const targetPath = join(notebookDir, filename)

          // Defense-in-depth: verify path stays within notebook directory
          if (!isWithinDirectory(notebookDir, targetPath)) {
            console.warn(`[reMarkable] Skipping suspicious path in zip: ${filename}`)
            continue
          }

          if (file.dir) {
            // Create directory
            await mkdir(targetPath, { recursive: true })
          } else {
            // Extract file
            const content = await file.async('nodebuffer')
            await mkdir(dirname(targetPath), { recursive: true })
            await writeFile(targetPath, content)
          }
        }

        // Also save the raw zip for backup
        const zipPath = `${fullPath}.zip`
        await writeFile(zipPath, zipData)

        newMeta.notebooks[doc.id] = {
          name: doc.name,
          parent: doc.parent,
          type: 'notebook',
          fileType: doc.fileType,
          lastModified: doc.lastModified,
          hash: doc.hash,
          localPath: docPath
        }

        result.synced++
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Failed to sync "${doc.name}": ${message}`)
      }
    }

    // Save updated metadata
    await saveMetadata(resolvedDir, newMeta)

    onProgress?.(`Sync complete: ${result.synced} synced, ${result.skipped} unchanged`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(`Sync failed: ${message}`)
  }

  return result
}

/**
 * Get the current sync status
 */
export async function getSyncStatus(syncDirectory: string): Promise<SyncMetadata | null> {
  return loadMetadata(syncDirectory)
}
