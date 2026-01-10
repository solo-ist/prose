/**
 * reMarkable sync logic - downloads notebooks to local filesystem
 */
import { mkdir, writeFile, readFile, readdir } from 'fs/promises'
import { join, dirname, resolve, sep } from 'path'
import { homedir } from 'os'
import { connect, type RemarkableNotebook } from './client'
import { isOCRConfigured, extractTextBatched } from './ocr'
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
  /** Path to converted markdown file, if available */
  markdownPath?: string
}

export interface SyncResult {
  syncedAt: string
  synced: number
  skipped: number
  errors: string[]
}

const META_FILE = 'sync-metadata.json'
const SYNC_STATE_FILE = 'sync-state.json'
const HIDDEN_DIR = '.remarkable'

/**
 * Sync state tracks which notebooks are selected for sync
 */
export interface SyncState {
  selectedNotebooks: string[] // notebook IDs to sync
  lastUpdated: string
}

/**
 * Load sync state (which notebooks are selected)
 */
async function loadSyncState(baseDirectory: string): Promise<SyncState | null> {
  try {
    const statePath = join(baseDirectory, HIDDEN_DIR, SYNC_STATE_FILE)
    const content = await readFile(statePath, 'utf-8')
    return JSON.parse(content) as SyncState
  } catch {
    return null
  }
}

/**
 * Save sync state
 */
async function saveSyncState(baseDirectory: string, state: SyncState): Promise<void> {
  const hiddenDir = join(baseDirectory, HIDDEN_DIR)
  await mkdir(hiddenDir, { recursive: true })
  const statePath = join(hiddenDir, SYNC_STATE_FILE)
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Load sync metadata from the hidden directory
 */
async function loadMetadata(baseDirectory: string): Promise<SyncMetadata | null> {
  try {
    const metaPath = join(baseDirectory, HIDDEN_DIR, META_FILE)
    const content = await readFile(metaPath, 'utf-8')
    return JSON.parse(content) as SyncMetadata
  } catch {
    return null
  }
}

/**
 * Save sync metadata to the hidden directory
 */
async function saveMetadata(baseDirectory: string, metadata: SyncMetadata): Promise<void> {
  const hiddenDir = join(baseDirectory, HIDDEN_DIR)
  await mkdir(hiddenDir, { recursive: true })
  const metaPath = join(hiddenDir, META_FILE)
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
 * Process a notebook directory with OCR to extract markdown
 *
 * @param notebookDir - Path to extracted notebook directory (e.g., .remarkable/<hash>/)
 * @param notebookName - Display name for the notebook
 * @param onProgress - Progress callback
 * @returns Markdown content or null if no .rm files found
 */
async function processNotebookWithOCR(
  notebookDir: string,
  notebookName: string,
  onProgress?: (message: string) => void
): Promise<string | null> {
  if (!isOCRConfigured()) {
    onProgress?.(`Skipping OCR for "${notebookName}" - OCR service not configured`)
    return null
  }

  try {
    // Find all .rm files in the notebook directory
    console.log(`[OCR] Reading directory: ${notebookDir}`)
    const files = await readdir(notebookDir, { recursive: true })
    console.log(`[OCR] Found ${files.length} files, types:`, files.slice(0, 5).map(f => typeof f))
    console.log(`[OCR] Sample files:`, files.slice(0, 5))
    const rmFiles = files
      .filter(f => typeof f === 'string' && f.endsWith('.rm'))
      .sort() // Sort to ensure consistent page order
    console.log(`[OCR] Found ${rmFiles.length} .rm files`)

    if (rmFiles.length === 0) {
      onProgress?.(`No .rm files found in "${notebookName}"`)
      return null
    }

    onProgress?.(`Processing ${rmFiles.length} pages from "${notebookName}"...`)

    // Read all .rm files
    const pages: Array<{ id: string; data: Buffer }> = []
    for (const rmFile of rmFiles) {
      const filePath = join(notebookDir, rmFile)
      const data = await readFile(filePath)
      // Use the filename without extension as the page ID
      const pageId = rmFile.replace('.rm', '').replace(/\//g, '_')
      pages.push({ id: pageId, data })
    }

    // Process with OCR
    const result = await extractTextBatched(pages, (processed, total) => {
      onProgress?.(`OCR progress: ${processed}/${total} pages`)
    })

    if (result.failedPages.length > 0) {
      onProgress?.(`Warning: ${result.failedPages.length} pages failed OCR`)
    }

    // Sort results by page ID to maintain order
    const sortedPages = result.pages.sort((a, b) => a.id.localeCompare(b.id))

    // Combine all markdown with page separators
    const markdownParts = sortedPages.map((page, index) => {
      const pageHeader = sortedPages.length > 1 ? `<!-- Page ${index + 1} -->\n\n` : ''
      return pageHeader + page.markdown
    })

    const combinedMarkdown = markdownParts.join('\n\n---\n\n')

    // Add metadata header
    const header = `---
title: ${notebookName}
source: reMarkable
pages: ${sortedPages.length}
extracted: ${new Date().toISOString()}
---

`

    return header + combinedMarkdown
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    onProgress?.(`OCR failed for "${notebookName}": ${message}`)
    return null
  }
}

/**
 * Sync all notebooks from reMarkable cloud to local filesystem
 *
 * Directory structure:
 * - syncDirectory/.remarkable/          (hidden, raw data)
 *   - sync-state.json                   (which notebooks to sync)
 *   - sync-metadata.json                (full notebook metadata)
 *   - <hash>.zip                        (raw notebook ZIPs)
 *   - <hash>/                           (extracted notebook contents)
 * - syncDirectory/                       (visible, markdown files with folder hierarchy)
 *   - <folder>/<notebook-name>.md       (converted markdown via OCR)
 */
export async function syncAll(
  deviceToken: string,
  syncDirectory: string,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  console.log('[reMarkable] Starting sync...')
  console.log('[reMarkable] syncDirectory:', syncDirectory)
  console.log('[reMarkable] OCR configured:', isOCRConfigured())

  // Expand ~ to home directory - syncDirectory is where markdown files go
  const baseDir = expandPath(syncDirectory)
  const hiddenDir = join(baseDir, HIDDEN_DIR)
  // Visible files go directly in the sync directory (preserving folder hierarchy)
  const visibleDir = baseDir
  console.log('[reMarkable] baseDir:', baseDir)
  console.log('[reMarkable] hiddenDir:', hiddenDir)

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
    const existingMeta = await loadMetadata(baseDir)
    const newMeta: SyncMetadata = {
      lastSyncedAt: result.syncedAt,
      notebooks: {}
    }

    // Ensure directories exist (visibleDir is same as baseDir, created with hiddenDir's parent)
    await mkdir(hiddenDir, { recursive: true })

    // Load sync state to see which notebooks are selected
    const syncState = await loadSyncState(baseDir)

    // First, record all folders in metadata
    const folders = notebooks.filter(n => n.type === 'folder')
    for (const folder of folders) {
      const folderPath = buildPath(folder, notebooks)

      newMeta.notebooks[folder.id] = {
        name: folder.name,
        parent: folder.parent,
        type: 'folder',
        lastModified: folder.lastModified,
        hash: folder.hash,
        localPath: folderPath
      }
    }

    // Filter to only selected notebooks (if sync state exists)
    const allDocuments = notebooks.filter(n => n.type === 'notebook')
    const documentsToSync = syncState
      ? allDocuments.filter(d => syncState.selectedNotebooks.includes(d.id))
      : allDocuments // If no sync state, sync all (first-time behavior)

    console.log('[reMarkable] Documents to sync:', documentsToSync.length)

    for (let i = 0; i < documentsToSync.length; i++) {
      const doc = documentsToSync[i]
      console.log(`[reMarkable] Processing ${i + 1}/${documentsToSync.length}: ${doc.name} (type: ${doc.fileType})`)
      onProgress?.(`Syncing ${i + 1}/${documentsToSync.length}: ${doc.name}`)

      try {
        const docPath = buildPath(doc, notebooks)

        // Check if we need to download (hash changed or doesn't exist)
        const existingEntry = existingMeta?.notebooks[doc.id]
        const needsDownload = !existingEntry || existingEntry.hash !== doc.hash
        const needsOCR = doc.fileType === 'notebook' && isOCRConfigured() && !existingEntry?.markdownPath
        console.log(`[reMarkable] ${doc.name}: needsDownload=${needsDownload}, needsOCR=${needsOCR}, existingMarkdown=${existingEntry?.markdownPath}`)

        if (!needsDownload && !needsOCR) {
          result.skipped++
          newMeta.notebooks[doc.id] = existingEntry!
          continue
        }

        // If hash matches but OCR is needed, use existing files
        if (!needsDownload && needsOCR) {
          console.log(`[reMarkable] Entering OCR branch for: ${doc.name}`)
          onProgress?.(`Processing OCR for existing notebook: ${doc.name}`)
          const notebookDir = join(hiddenDir, doc.hash)
          console.log(`[reMarkable] Notebook dir: ${notebookDir}`)

          let markdownPath: string | undefined
          const markdown = await processNotebookWithOCR(notebookDir, doc.name, onProgress)
          if (markdown) {
            const docRelPath = buildPath(doc, notebooks)
            const mdFileName = `${sanitizeName(doc.name)}.md`
            const parentPath = dirname(docRelPath)
            const mdRelPath = parentPath === '.' ? mdFileName : join(parentPath, mdFileName)
            const mdPath = join(visibleDir, mdRelPath)

            await mkdir(dirname(mdPath), { recursive: true })
            await writeFile(mdPath, markdown, 'utf-8')
            markdownPath = mdRelPath
            onProgress?.(`Saved markdown: ${mdRelPath}`)
          }

          newMeta.notebooks[doc.id] = {
            ...existingEntry!,
            markdownPath
          }
          result.synced++
          continue
        }

        // Download the notebook
        const zipData = await client.downloadNotebook(doc.id, doc.hash)

        // Save raw ZIP to hidden directory
        const zipPath = join(hiddenDir, `${doc.hash}.zip`)
        await writeFile(zipPath, zipData)

        // Extract the zip contents to hidden directory
        const zip = await JSZip.loadAsync(zipData)
        const notebookDir = join(hiddenDir, doc.hash)
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
            await mkdir(targetPath, { recursive: true })
          } else {
            const content = await file.async('nodebuffer')
            await mkdir(dirname(targetPath), { recursive: true })
            await writeFile(targetPath, content)
          }
        }

        // Process with OCR for handwritten notebooks
        let markdownPath: string | undefined
        if (doc.fileType === 'notebook') {
          const markdown = await processNotebookWithOCR(notebookDir, doc.name, onProgress)
          if (markdown) {
            // Build the path preserving folder hierarchy from reMarkable
            const docRelPath = buildPath(doc, notebooks)
            const mdFileName = `${sanitizeName(doc.name)}.md`
            // docRelPath already includes the notebook name, so use dirname to get parent folders
            const parentPath = dirname(docRelPath)
            const mdRelPath = parentPath === '.' ? mdFileName : join(parentPath, mdFileName)
            const mdPath = join(visibleDir, mdRelPath)

            // Ensure parent directory exists
            await mkdir(dirname(mdPath), { recursive: true })
            await writeFile(mdPath, markdown, 'utf-8')

            // Store relative path from sync directory
            markdownPath = mdRelPath
            onProgress?.(`Saved markdown: ${mdRelPath}`)
          }
        }

        newMeta.notebooks[doc.id] = {
          name: doc.name,
          parent: doc.parent,
          type: 'notebook',
          fileType: doc.fileType,
          lastModified: doc.lastModified,
          hash: doc.hash,
          localPath: join(HIDDEN_DIR, doc.hash),
          markdownPath
        }

        result.synced++
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Failed to sync "${doc.name}": ${message}`)
      }
    }

    // Record non-synced notebooks in metadata (but don't download them)
    const nonSyncedDocs = syncState
      ? allDocuments.filter(d => !syncState.selectedNotebooks.includes(d.id))
      : []
    for (const doc of nonSyncedDocs) {
      const existingEntry = existingMeta?.notebooks[doc.id]
      if (existingEntry) {
        newMeta.notebooks[doc.id] = existingEntry
      } else {
        // Record metadata for cloud-only notebooks
        const docPath = buildPath(doc, notebooks)
        newMeta.notebooks[doc.id] = {
          name: doc.name,
          parent: doc.parent,
          type: 'notebook',
          fileType: doc.fileType,
          lastModified: doc.lastModified,
          hash: doc.hash,
          localPath: '' // Not synced locally
        }
      }
    }

    // Save updated metadata
    await saveMetadata(baseDir, newMeta)

    onProgress?.(`Sync complete: ${result.synced} synced, ${result.skipped} unchanged`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(`Sync failed: ${message}`)
  }

  return result
}

/**
 * Get the current sync metadata including all notebooks
 */
export async function getSyncStatus(syncDirectory: string): Promise<SyncMetadata | null> {
  const baseDir = expandPath(syncDirectory)
  return loadMetadata(baseDir)
}

/**
 * Get the current sync state (which notebooks are selected)
 */
export async function getSyncState(syncDirectory: string): Promise<SyncState | null> {
  const baseDir = expandPath(syncDirectory)
  return loadSyncState(baseDir)
}

/**
 * Update which notebooks are selected for sync
 */
export async function updateSyncSelection(
  syncDirectory: string,
  selectedNotebooks: string[]
): Promise<void> {
  const baseDir = expandPath(syncDirectory)
  const state: SyncState = {
    selectedNotebooks,
    lastUpdated: new Date().toISOString()
  }
  await saveSyncState(baseDir, state)
}

/**
 * List all notebooks from cloud (for selection UI)
 * Returns notebook list without downloading content
 */
export async function listCloudNotebooks(
  deviceToken: string
): Promise<{ id: string; name: string; type: 'folder' | 'notebook'; parent: string | null; fileType?: string }[]> {
  const client = await connect(deviceToken)
  const notebooks = await client.listNotebooks()

  return notebooks.map(n => ({
    id: n.id,
    name: n.name,
    type: n.type,
    parent: n.parent,
    fileType: n.fileType
  }))
}
