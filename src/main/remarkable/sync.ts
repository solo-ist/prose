/**
 * reMarkable sync logic - downloads notebooks to local filesystem
 */
import { mkdir, writeFile, readFile, readdir, access, rm } from 'fs/promises'
import { join, dirname, resolve, sep } from 'path'
import { homedir } from 'os'
import { connect, disconnect, type RemarkableNotebook } from './client'
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
  /** Path to read-only OCR output in hidden folder (relative to hidden dir) */
  ocrPath?: string
  /** Path to user's editable markdown in visible folder (relative to sync dir, created on demand) */
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
  anthropicApiKey: string | null | undefined,
  onProgress?: (message: string) => void
): Promise<string | null> {
  console.log(`[OCR] processNotebookWithOCR called for "${notebookName}" at ${notebookDir}`)

  if (!isOCRConfigured()) {
    console.log(`[OCR] Skipping - not configured`)
    onProgress?.(`Skipping OCR for "${notebookName}" - OCR service not configured`)
    return null
  }

  if (!anthropicApiKey) {
    console.log(`[OCR] Skipping - no Anthropic API key`)
    onProgress?.(`Skipping OCR for "${notebookName}" - please add Anthropic API key in Settings`)
    return null
  }

  try {
    // Find all .rm files in the notebook directory
    const files = await readdir(notebookDir, { recursive: true })
    console.log(`[OCR] Found ${files.length} files in directory:`, files.slice(0, 10))

    const rmFiles = files
      .filter(f => typeof f === 'string' && f.endsWith('.rm'))
      .sort() // Sort to ensure consistent page order

    console.log(`[OCR] Found ${rmFiles.length} .rm files:`, rmFiles)

    if (rmFiles.length === 0) {
      console.log(`[OCR] No .rm files found`)
      onProgress?.(`No .rm files found in "${notebookName}"`)
      return null
    }

    onProgress?.(`Processing ${rmFiles.length} pages from "${notebookName}"...`)
    console.log(`[OCR] Processing ${rmFiles.length} pages...`)

    // Read all .rm files
    const pages: Array<{ id: string; data: Buffer }> = []
    for (const rmFile of rmFiles) {
      const filePath = join(notebookDir, rmFile)
      console.log(`[OCR] Reading file: ${filePath}`)
      const data = await readFile(filePath)
      console.log(`[OCR] Read ${data.length} bytes from ${rmFile}`)
      // Use the filename without extension as the page ID
      const pageId = rmFile.replace('.rm', '').replace(/\//g, '_')
      pages.push({ id: pageId, data })
    }

    console.log(`[OCR] Calling extractTextBatched with ${pages.length} pages`)
    // Process with OCR
    const result = await extractTextBatched(pages, anthropicApiKey, (processed, total) => {
      console.log(`[OCR] Progress: ${processed}/${total}`)
      onProgress?.(`OCR progress: ${processed}/${total} pages`)
    })
    console.log(`[OCR] extractTextBatched returned: pages=${result.pages.length}, failed=${result.failedPages.length}`)

    if (result.failedPages.length > 0) {
      console.log(`[OCR] Failed pages:`, result.failedPages)
      onProgress?.(`Warning: ${result.failedPages.length} pages failed OCR`)
    }

    // Sort results by page ID to maintain order
    const sortedPages = result.pages.sort((a, b) => a.id.localeCompare(b.id))
    console.log(`[OCR] Sorted ${sortedPages.length} pages`)

    // Combine all markdown with page separators
    const markdownParts = sortedPages.map((page, index) => {
      const pageHeader = sortedPages.length > 1 ? `<!-- Page ${index + 1} -->\n\n` : ''
      return pageHeader + page.markdown
    })

    const combinedMarkdown = markdownParts.join('\n\n---\n\n')
    console.log(`[OCR] Combined markdown length: ${combinedMarkdown.length}`)

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
    console.error(`[OCR] Error processing "${notebookName}":`, error)
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
  anthropicApiKey?: string,
  onProgress?: (message: string) => void
): Promise<SyncResult> {
  console.log('[reMarkable] Starting sync...')
  console.log('[reMarkable] syncDirectory:', syncDirectory)
  console.log('[reMarkable] OCR configured:', isOCRConfigured())
  console.log('[reMarkable] Anthropic API key:', anthropicApiKey ? 'provided' : 'not provided')

  // Clear cached API connection to ensure fresh data from cloud
  disconnect()

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
    console.log('[reMarkable] Connecting to cloud...')
    onProgress?.('Connecting to reMarkable cloud...')
    const client = await connect(deviceToken)
    console.log('[reMarkable] Connected successfully')

    console.log('[reMarkable] Fetching notebook list...')
    onProgress?.('Fetching notebook list...')
    const notebooks = await client.listNotebooks()
    console.log(`[reMarkable] Found ${notebooks.length} notebooks`)

    // Load existing metadata to check what's changed
    const existingMeta = await loadMetadata(baseDir)
    const newMeta: SyncMetadata = {
      lastSyncedAt: result.syncedAt,
      notebooks: {}
    }

    // Ensure directories exist - create baseDir first, then hiddenDir
    await mkdir(baseDir, { recursive: true })
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
        const notebookDir = join(hiddenDir, doc.hash)

        // Debug: log hash comparison
        console.log(`[reMarkable] ${doc.name} hash comparison:`)
        console.log(`[reMarkable]   cloud hash: ${doc.hash}`)
        console.log(`[reMarkable]   local hash: ${existingEntry?.hash || 'none'}`)

        // Check if local files actually exist
        let localFilesExist = false
        try {
          await access(notebookDir)
          localFilesExist = true
        } catch {
          localFilesExist = false
        }

        const needsDownload = !existingEntry || existingEntry.hash !== doc.hash || !localFilesExist
        const needsOCR = doc.fileType === 'notebook' && isOCRConfigured() && !existingEntry?.ocrPath
        console.log(`[reMarkable] ${doc.name}: needsDownload=${needsDownload}, needsOCR=${needsOCR}, localFilesExist=${localFilesExist}, existingOCR=${existingEntry?.ocrPath}`)

        if (!needsDownload && !needsOCR) {
          result.skipped++
          newMeta.notebooks[doc.id] = existingEntry!
          continue
        }

        // If hash matches and local files exist but OCR is needed, use existing files
        if (!needsDownload && needsOCR) {
          console.log(`[reMarkable] OCR-only path for ${doc.name}`)
          onProgress?.(`Processing OCR for existing notebook: ${doc.name}`)

          let ocrPath: string | undefined
          console.log(`[reMarkable] Running OCR for ${doc.name} from ${notebookDir}`)
          const markdown = await processNotebookWithOCR(notebookDir, doc.name, anthropicApiKey, onProgress)
          console.log(`[reMarkable] OCR result for ${doc.name}: ${markdown ? 'got markdown' : 'null'}`)
          if (markdown) {
            // Save OCR output to hidden folder (read-only source of truth)
            const ocrFileName = `${sanitizeName(doc.name)}.md`
            const ocrDir = join(hiddenDir, doc.id)
            const ocrFullPath = join(ocrDir, ocrFileName)

            await mkdir(ocrDir, { recursive: true })
            await writeFile(ocrFullPath, markdown, 'utf-8')
            ocrPath = join(doc.id, ocrFileName)
            onProgress?.(`Saved OCR: ${ocrPath}`)
          }

          // If OCR failed but a previous OCR file exists on disk, reuse it
          if (!ocrPath) {
            const ocrFileName = `${sanitizeName(doc.name)}.md`
            const existingOcrFile = join(hiddenDir, doc.id, ocrFileName)
            try {
              await access(existingOcrFile)
              ocrPath = join(doc.id, ocrFileName)
              console.log(`[reMarkable] Reusing existing OCR file: ${ocrPath}`)
            } catch {
              // No existing file on disk either
            }
          }

          newMeta.notebooks[doc.id] = {
            ...existingEntry!,
            ocrPath,
            // Preserve existing markdownPath if user has already created editable version
            markdownPath: existingEntry?.markdownPath
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
        let ocrPath: string | undefined
        if (doc.fileType === 'notebook') {
          console.log(`[reMarkable] Running OCR for ${doc.name} from ${notebookDir}`)
          const markdown = await processNotebookWithOCR(notebookDir, doc.name, anthropicApiKey, onProgress)
          console.log(`[reMarkable] OCR result for ${doc.name}: ${markdown ? 'got markdown' : 'null'}`)
          if (markdown) {
            // Save OCR output to hidden folder (read-only source of truth)
            const ocrFileName = `${sanitizeName(doc.name)}.md`
            const ocrDir = join(hiddenDir, doc.id)
            const ocrFullPath = join(ocrDir, ocrFileName)

            await mkdir(ocrDir, { recursive: true })
            await writeFile(ocrFullPath, markdown, 'utf-8')
            ocrPath = join(doc.id, ocrFileName)
            onProgress?.(`Saved OCR: ${ocrPath}`)
          }

          // If OCR failed but a previous OCR file exists on disk, reuse it
          if (!ocrPath) {
            const ocrFileName = `${sanitizeName(doc.name)}.md`
            const existingOcrFile = join(hiddenDir, doc.id, ocrFileName)
            try {
              await access(existingOcrFile)
              ocrPath = join(doc.id, ocrFileName)
              console.log(`[reMarkable] Reusing existing OCR file: ${ocrPath}`)
            } catch {
              // No existing file on disk either
            }
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
          ocrPath
          // markdownPath is not set yet - created on demand when user transforms to edit mode
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
    console.error('[reMarkable] Sync error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(`Sync failed: ${message}`)
  }

  console.log('[reMarkable] Sync finished. Result:', JSON.stringify(result, null, 2))
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
  // Clear cache to get fresh data
  disconnect()
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

/**
 * Create an editable copy of a reMarkable notebook's OCR output.
 * Called when user triggers "transform to edit mode".
 *
 * @param notebookId - The notebook ID
 * @param syncDirectory - Base sync directory
 * @returns Path to the editable markdown file, or null if failed
 */
export async function createEditableVersion(
  notebookId: string,
  syncDirectory: string
): Promise<string | null> {
  const baseDir = expandPath(syncDirectory)
  const hiddenDir = join(baseDir, HIDDEN_DIR)

  // Load metadata to get notebook info
  const metadata = await loadMetadata(baseDir)
  if (!metadata) {
    console.error('[reMarkable] No metadata found')
    return null
  }

  const notebook = metadata.notebooks[notebookId]
  if (!notebook) {
    console.error(`[reMarkable] Notebook ${notebookId} not found in metadata`)
    return null
  }

  if (!notebook.ocrPath) {
    console.error(`[reMarkable] No OCR path for notebook ${notebookId}`)
    return null
  }

  // If editable version already exists, return its path
  if (notebook.markdownPath) {
    const existingPath = join(baseDir, notebook.markdownPath)
    try {
      await access(existingPath)
      return existingPath
    } catch {
      // File doesn't exist, continue to create it
    }
  }

  // Read OCR content from hidden folder
  const ocrFullPath = join(hiddenDir, notebook.ocrPath)
  let ocrContent: string
  try {
    ocrContent = await readFile(ocrFullPath, 'utf-8')
  } catch (error) {
    console.error(`[reMarkable] Failed to read OCR file: ${ocrFullPath}`, error)
    return null
  }

  // Build path for editable version using folder hierarchy
  // We need to reconstruct the path from metadata
  const mdFileName = `${sanitizeName(notebook.name)}.md`
  let mdRelPath: string

  // Build folder path from parent chain
  const parentPath = buildPathFromMetadata(notebookId, metadata)
  if (parentPath) {
    mdRelPath = join(parentPath, mdFileName)
  } else {
    mdRelPath = mdFileName
  }

  const mdFullPath = join(baseDir, mdRelPath)

  // Create parent directories and write file
  try {
    await mkdir(dirname(mdFullPath), { recursive: true })
    await writeFile(mdFullPath, ocrContent, 'utf-8')
    console.log(`[reMarkable] Created editable version: ${mdFullPath}`)

    // Update metadata with markdownPath
    notebook.markdownPath = mdRelPath
    await saveMetadata(baseDir, metadata)

    return mdFullPath
  } catch (error) {
    console.error(`[reMarkable] Failed to create editable version`, error)
    return null
  }
}

/**
 * Build folder path from notebook metadata using parent chain
 */
function buildPathFromMetadata(notebookId: string, metadata: SyncMetadata, visited: Set<string> = new Set()): string {
  const notebook = metadata.notebooks[notebookId]
  if (!notebook || visited.has(notebookId)) return ''
  visited.add(notebookId)

  if (!notebook.parent) return ''

  const parent = metadata.notebooks[notebook.parent]
  if (!parent || parent.type !== 'folder') return ''

  const parentPath = buildPathFromMetadata(notebook.parent, metadata, visited)
  const safeName = sanitizeName(parent.name)

  return parentPath ? join(parentPath, safeName) : safeName
}

/**
 * Get the full path to a notebook's OCR file (read-only)
 */
export async function getOCRPath(
  notebookId: string,
  syncDirectory: string
): Promise<string | null> {
  const baseDir = expandPath(syncDirectory)
  const hiddenDir = join(baseDir, HIDDEN_DIR)

  const metadata = await loadMetadata(baseDir)
  if (!metadata) return null

  const notebook = metadata.notebooks[notebookId]
  if (!notebook?.ocrPath) return null

  return join(hiddenDir, notebook.ocrPath)
}

/**
 * Get the full path to a notebook's editable markdown file (if it exists)
 */
export async function getEditablePath(
  notebookId: string,
  syncDirectory: string
): Promise<string | null> {
  const baseDir = expandPath(syncDirectory)

  const metadata = await loadMetadata(baseDir)
  if (!metadata) return null

  const notebook = metadata.notebooks[notebookId]
  if (!notebook?.markdownPath) return null

  const fullPath = join(baseDir, notebook.markdownPath)

  // Verify file exists
  try {
    await access(fullPath)
    return fullPath
  } catch {
    return null
  }
}

/**
 * Find a notebook ID by its markdown file path (absolute path)
 * Returns the notebook ID if found, null otherwise
 */
export async function findNotebookByFilePath(
  filePath: string,
  syncDirectory: string
): Promise<string | null> {
  const baseDir = expandPath(syncDirectory)
  const metadata = await loadMetadata(baseDir)
  if (!metadata) return null

  // Normalize paths for comparison
  const normalizedFilePath = filePath.replace(/\\/g, '/')

  // Check if file is within sync directory
  const normalizedBaseDir = baseDir.replace(/\\/g, '/')
  if (!normalizedFilePath.startsWith(normalizedBaseDir)) {
    return null
  }

  // Get relative path from sync directory
  const relativePath = normalizedFilePath.slice(normalizedBaseDir.length + 1)

  // Search for notebook with matching markdownPath
  for (const [notebookId, notebook] of Object.entries(metadata.notebooks)) {
    if (notebook.markdownPath === relativePath) {
      return notebookId
    }
  }

  return null
}

/**
 * Clear the markdownPath from a notebook's metadata (unsync the editable version)
 * Called when the user deletes the local markdown file
 */
export async function clearNotebookMarkdownPath(
  notebookId: string,
  syncDirectory: string
): Promise<boolean> {
  const baseDir = expandPath(syncDirectory)
  const metadata = await loadMetadata(baseDir)
  if (!metadata) return false

  const notebook = metadata.notebooks[notebookId]
  if (!notebook) return false

  // Clear the markdown path
  delete notebook.markdownPath

  // Save updated metadata
  await saveMetadata(baseDir, metadata)
  console.log(`[reMarkable] Cleared markdownPath for notebook ${notebookId}`)
  return true
}

/**
 * Purge sync state and cached data (hidden .remarkable/ directory only).
 * Does NOT delete user-visible markdown files — those belong to the user.
 * Called on disconnect to ensure a clean slate for reconnection.
 */
export async function purgeSync(syncDirectory: string): Promise<void> {
  const baseDir = expandPath(syncDirectory)
  const hiddenDir = join(baseDir, HIDDEN_DIR)
  try {
    await rm(hiddenDir, { recursive: true, force: true })
  } catch {
    // Directory doesn't exist or permission error
  }
}
