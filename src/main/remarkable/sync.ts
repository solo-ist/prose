/**
 * reMarkable sync logic - downloads notebooks to local filesystem
 */
import { mkdir, writeFile, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { connect, type RemarkableNotebook } from './client'
import JSZip from 'jszip'

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
 */
function buildPath(
  notebook: RemarkableNotebook,
  notebooks: RemarkableNotebook[],
  visited: Set<string> = new Set()
): string {
  // Prevent infinite loops from circular references
  if (visited.has(notebook.id)) {
    return notebook.name
  }
  visited.add(notebook.id)

  if (!notebook.parent) {
    return notebook.name
  }

  const parent = notebooks.find(n => n.id === notebook.parent)
  if (!parent) {
    return notebook.name
  }

  return join(buildPath(parent, notebooks, visited), notebook.name)
}

/**
 * Sync all notebooks from reMarkable cloud to local filesystem
 */
export async function syncAll(
  deviceToken: string,
  syncDirectory: string,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
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
    const existingMeta = await loadMetadata(syncDirectory)
    const newMeta: SyncMetadata = {
      lastSyncedAt: result.syncedAt,
      notebooks: {}
    }

    // Ensure sync directory exists
    await mkdir(syncDirectory, { recursive: true })

    // First, create all folders
    const folders = notebooks.filter(n => n.type === 'folder')
    for (const folder of folders) {
      const folderPath = buildPath(folder, notebooks)
      const fullPath = join(syncDirectory, folderPath)
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
        const fullPath = join(syncDirectory, docPath)

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

        // Save the raw zip file for now
        // Future: extract and convert to markdown
        const zipPath = `${fullPath}.zip`
        await writeFile(zipPath, zipData)

        // Also extract metadata for display
        const zip = await JSZip.loadAsync(zipData)
        const metadataFile = zip.file(`${doc.id}.metadata`)
        const contentFile = zip.file(`${doc.id}.content`)

        const notebookDir = fullPath
        await mkdir(notebookDir, { recursive: true })

        // Save metadata.json
        if (metadataFile) {
          const metadata = await metadataFile.async('string')
          await writeFile(join(notebookDir, 'metadata.json'), metadata, 'utf-8')
        }

        // Save content.json
        if (contentFile) {
          const content = await contentFile.async('string')
          await writeFile(join(notebookDir, 'content.json'), content, 'utf-8')

          // Try to extract page count for info
          try {
            const contentData = JSON.parse(content)
            const pageCount = contentData.pageCount || 0
            await writeFile(
              join(notebookDir, 'info.txt'),
              `Name: ${doc.name}\nPages: ${pageCount}\nType: ${doc.fileType}\nLast Modified: ${doc.lastModified}\n`,
              'utf-8'
            )
          } catch {
            // Ignore content parsing errors
          }
        }

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
    await saveMetadata(syncDirectory, newMeta)

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
