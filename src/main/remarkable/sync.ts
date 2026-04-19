/**
 * reMarkable sync logic - downloads notebooks to local filesystem
 */
import { mkdir, writeFile, readFile, readdir, access, rm } from 'fs/promises'
import { join, dirname, resolve, sep } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
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

export interface PageOCRCacheEntry {
  /** Page modification timestamp from .content (primary cache key) */
  modifed?: string
  /** SHA-256 hash of .rm file bytes (fallback when modifed unavailable) */
  rmHash?: string
  /** OCR markdown result for this page */
  markdown: string
  /** OCR confidence score */
  confidence: number
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
  /** Per-page OCR cache keyed by page UUID — enables incremental OCR on resync */
  pageOCRCache?: Record<string, PageOCRCacheEntry>
}

export interface SyncResult {
  syncedAt: string
  synced: number
  skipped: number
  errors: string[]
}

export interface SyncProgressUpdate {
  message: string
  notebookId?: string
  notebookName?: string
  current?: number
  total?: number
  phase: 'connecting' | 'listing' | 'downloading' | 'ocr' | 'notebook-done' | 'skipped' | 'complete'
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
  // Snapshot synchronously before any await. With 3 concurrent workers, multiple
  // saveMetadata calls can be in-flight — last atomic writeFile wins, which is
  // acceptable because each worker adds its own notebook before calling save.
  const snapshot = JSON.stringify(metadata, null, 2)
  const hiddenDir = join(baseDirectory, HIDDEN_DIR)
  await mkdir(hiddenDir, { recursive: true })
  const metaPath = join(hiddenDir, META_FILE)
  await writeFile(metaPath, snapshot, 'utf-8')
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
 * @param anthropicApiKey - API key for the OCR service
 * @param existingCache - Per-page OCR cache from previous sync (enables incremental OCR)
 * @param onProgress - Progress callback
 * @returns Object with markdown content and updated page cache, or null if no .rm files found
 */
async function processNotebookWithOCR(
  notebookDir: string,
  notebookName: string,
  anthropicApiKey: string | null | undefined,
  existingCache?: Record<string, PageOCRCacheEntry>,
  onProgress?: (update: SyncProgressUpdate) => void
): Promise<{ markdown: string; pageOCRCache: Record<string, PageOCRCacheEntry> } | null> {
  console.log(`[OCR] processNotebookWithOCR called for "${notebookName}" at ${notebookDir}`)

  if (!isOCRConfigured()) {
    console.log(`[OCR] Skipping - not configured`)
    onProgress?.({ message: `Skipping OCR for "${notebookName}" - OCR service not configured`, notebookName, phase: 'ocr' })
    return null
  }

  if (!anthropicApiKey) {
    console.log(`[OCR] Skipping - no Anthropic API key`)
    onProgress?.({ message: `Skipping OCR for "${notebookName}" - please add Anthropic API key in Settings`, notebookName, phase: 'ocr' })
    return null
  }

  try {
    // Read page order and modification timestamps from .content file
    let pageOrder: string[] = []
    const pageTimestamps: Record<string, string> = {} // bare pageId → modifed timestamp
    const files = await readdir(notebookDir, { recursive: true })
    console.log(`[OCR] Found ${files.length} files in directory:`, files.slice(0, 10))

    const contentFile = files.find(f => typeof f === 'string' && f.endsWith('.content'))
    if (contentFile) {
      try {
        const contentJson = JSON.parse(await readFile(join(notebookDir, contentFile), 'utf-8'))
        if (contentJson.cPages?.pages) {
          // v6 format: cPages.pages[].id with modifed timestamps
          for (const p of contentJson.cPages.pages) {
            pageOrder.push(p.id)
            if (p.modifed) pageTimestamps[p.id] = String(p.modifed)
          }
        } else if (contentJson.pages) {
          // Legacy format: pages[] as string array of UUIDs (no timestamps)
          pageOrder = contentJson.pages
        }
        console.log(`[OCR] Page order from .content: ${pageOrder.length} pages, ${Object.keys(pageTimestamps).length} with timestamps`)
      } catch {
        console.warn(`[OCR] Failed to parse .content file, falling back to alphabetical`)
      }
    }
    const hasTimestamps = Object.keys(pageTimestamps).length > 0

    const rmFiles = files
      .filter(f => typeof f === 'string' && f.endsWith('.rm'))

    // Sort by .content page order if available, otherwise alphabetical
    if (pageOrder.length > 0) {
      rmFiles.sort((a, b) => {
        const aId = a.replace('.rm', '').replace(/.*\//, '')
        const bId = b.replace('.rm', '').replace(/.*\//, '')
        const aIdx = pageOrder.indexOf(aId)
        const bIdx = pageOrder.indexOf(bId)
        return (aIdx === -1 ? Infinity : aIdx) - (bIdx === -1 ? Infinity : bIdx)
      })
    } else {
      rmFiles.sort()
    }

    console.log(`[OCR] Found ${rmFiles.length} .rm files`)

    if (rmFiles.length === 0) {
      console.log(`[OCR] No .rm files found`)
      onProgress?.({ message: `No .rm files found in "${notebookName}"`, notebookName, phase: 'ocr' })
      return null
    }

    // Determine which pages need OCR — use modifed timestamps if available, else hash .rm bytes
    const pagesToOCR: Array<{ id: string; data: Buffer }> = []
    const pageHashes: Record<string, string> = {} // pageId → rmHash (computed on demand)
    const cachedPages: Record<string, PageOCRCacheEntry> = {}
    const allPageIds: string[] = []

    for (const rmFile of rmFiles) {
      const filePath = join(notebookDir, rmFile)
      const pageId = rmFile.replace('.rm', '').replace(/\//g, '_')
      const bareId = rmFile.replace('.rm', '').replace(/.*\//, '')
      allPageIds.push(pageId)
      const cached = existingCache?.[pageId]

      if (cached) {
        // Try timestamp comparison first (fast, no file I/O)
        const currentTimestamp = pageTimestamps[bareId]
        if (hasTimestamps && cached.modifed && currentTimestamp === cached.modifed) {
          cachedPages[pageId] = cached
          console.log(`[OCR] Cache hit for page ${bareId.slice(0, 8)} (timestamp match)`)
          continue
        }
        // Fallback: hash comparison (requires reading the file)
        if (cached.rmHash) {
          const data = await readFile(filePath)
          const rmHash = createHash('sha256').update(data).digest('hex')
          pageHashes[pageId] = rmHash
          if (rmHash === cached.rmHash) {
            cachedPages[pageId] = cached
            console.log(`[OCR] Cache hit for page ${bareId.slice(0, 8)} (hash match)`)
            continue
          }
        }
      }

      // Page is new or changed — needs OCR
      const data = pageHashes[pageId] ? undefined : await readFile(filePath)
      if (data) pageHashes[pageId] = createHash('sha256').update(data).digest('hex')
      const fileData = data || await readFile(filePath)
      console.log(`[OCR] ${cached ? 'Changed' : 'New'} page ${bareId.slice(0, 8)}: ${fileData.length} bytes`)
      pagesToOCR.push({ id: pageId, data: fileData })
    }

    const cachedCount = Object.keys(cachedPages).length
    const totalPages = rmFiles.length
    console.log(`[OCR] ${cachedCount} cached, ${pagesToOCR.length} need OCR out of ${totalPages} total`)

    if (pagesToOCR.length === 0) {
      onProgress?.({ message: `All ${totalPages} pages cached for "${notebookName}"`, notebookName, phase: 'ocr' })
    } else if (cachedCount > 0) {
      onProgress?.({ message: `OCR: ${pagesToOCR.length} changed, ${cachedCount} cached — "${notebookName}"`, notebookName, phase: 'ocr' })
    } else {
      onProgress?.({ message: `OCR: processing ${totalPages} pages — "${notebookName}"`, notebookName, phase: 'ocr' })
    }

    // OCR only the changed/new pages
    const newCache: Record<string, PageOCRCacheEntry> = { ...cachedPages }
    let ocrResults: Array<{ id: string; markdown: string; confidence: number }> = []

    if (pagesToOCR.length > 0) {
      console.log(`[OCR] Calling extractTextBatched with ${pagesToOCR.length} pages`)
      const result = await extractTextBatched(pagesToOCR, anthropicApiKey, (processed, total) => {
        console.log(`[OCR] Progress: ${processed}/${total}`)
        onProgress?.({ message: `OCR: page ${processed} of ${pagesToOCR.length} — "${notebookName}"`, notebookName, current: processed, total, phase: 'ocr' })
      })
      console.log(`[OCR] extractTextBatched returned: pages=${result.pages.length}, failed=${result.failedPages.length}`)

      if (result.failedPages.length > 0) {
        console.log(`[OCR] Failed pages:`, result.failedPages)
        onProgress?.({ message: `Warning: ${result.failedPages.length} pages failed OCR`, notebookName, phase: 'ocr' })
      }

      ocrResults = result.pages

      // Update cache with fresh OCR results
      for (const page of result.pages) {
        const bareId = page.id.replace(/.*_/, '')
        newCache[page.id] = {
          modifed: pageTimestamps[bareId],
          rmHash: pageHashes[page.id],
          markdown: page.markdown,
          confidence: page.confidence
        }
      }
    }

    // Assemble all pages in order — merge cached and fresh results
    const orderedPages = allPageIds.map(pageId => {
      const cached = newCache[pageId]
      if (cached) return { id: pageId, markdown: cached.markdown, confidence: cached.confidence }
      // Fallback: page was in OCR results (matched by id)
      const fresh = ocrResults.find(r => r.id === pageId)
      return fresh || { id: pageId, markdown: '', confidence: 0 }
    })

    console.log(`[OCR] Ordered ${orderedPages.length} pages`)

    // Combine all markdown with page separators
    const markdownParts = orderedPages.map((page, index) => {
      const pageHeader = orderedPages.length > 1 ? `<!-- Page ${index + 1} -->\n\n` : ''
      return pageHeader + page.markdown
    })

    const combinedMarkdown = markdownParts.join('\n\n---\n\n')
    console.log(`[OCR] Combined markdown length: ${combinedMarkdown.length}`)

    // Add metadata header
    const header = `---
title: ${notebookName}
source: reMarkable
pages: ${orderedPages.length}
extracted: ${new Date().toISOString()}
---

`

    return { markdown: header + combinedMarkdown, pageOCRCache: newCache }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[OCR] Error processing "${notebookName}":`, error)
    onProgress?.({ message: `OCR failed for "${notebookName}": ${message}`, notebookName, phase: 'ocr' })
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
  onProgress?: (update: SyncProgressUpdate) => void
): Promise<SyncResult> {
  console.log('[reMarkable] Starting sync...')
  console.log('[reMarkable] syncDirectory:', syncDirectory)
  console.log('[reMarkable] OCR configured:', isOCRConfigured())
  console.log('[reMarkable] Anthropic API key:', anthropicApiKey ? 'provided' : 'not provided')

  // Reuse cached connection if available — connect() handles re-auth if needed.
  // Previously called disconnect() here to force fresh data, but that caused
  // a slow full re-authentication on every sync. The cloud API returns fresh
  // data on each listNotebooks() call regardless of connection caching.

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
    onProgress?.({ message: 'Connecting to reMarkable cloud...', phase: 'connecting' })
    const client = await connect(deviceToken)
    console.log('[reMarkable] Connected successfully')

    console.log('[reMarkable] Fetching notebook list...')
    onProgress?.({ message: 'Fetching notebook list...', phase: 'listing' })
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

    // Track completed count for progress reporting
    let completed = 0
    const totalToSync = documentsToSync.length

    // Process a single notebook (used by the concurrent executor)
    async function syncOneNotebook(doc: RemarkableNotebook): Promise<void> {
      const idx = ++completed
      console.log(`[reMarkable] Processing ${idx}/${totalToSync}: ${doc.name} (type: ${doc.fileType})`)

      // Check if we need to download (hash changed or doesn't exist)
      const existingEntry = existingMeta?.notebooks[doc.id]
      const notebookDir = join(hiddenDir, doc.hash)
      const zipPath = join(hiddenDir, `${doc.hash}.zip`)

      console.log(`[reMarkable] ${doc.name} hash: cloud=${doc.hash}, local=${existingEntry?.hash || 'none'}`)

      // Check if local files actually exist
      let localFilesExist = false
      try {
        await access(notebookDir)
        localFilesExist = true
      } catch {
        localFilesExist = false
      }

      // Check if zip exists from a previous interrupted sync (resume support)
      let zipExists = false
      try {
        await access(zipPath)
        zipExists = true
      } catch {
        zipExists = false
      }

      const needsDownload = !existingEntry || existingEntry.hash !== doc.hash || !localFilesExist
      const needsOCR = doc.fileType === 'notebook' && isOCRConfigured() && !existingEntry?.ocrPath
      console.log(`[reMarkable] ${doc.name}: needsDownload=${needsDownload}, needsOCR=${needsOCR}, localFilesExist=${localFilesExist}, zipExists=${zipExists}`)

      if (!needsDownload && !needsOCR) {
        result.skipped++
        newMeta.notebooks[doc.id] = existingEntry!
        await saveMetadata(baseDir, newMeta)
        onProgress?.({ message: `Up to date: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, current: idx, total: totalToSync, phase: 'skipped' })
        return
      }

      // Only show sync indicator for notebooks that actually need work
      onProgress?.({ message: `Syncing ${idx}/${totalToSync}: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, current: idx, total: totalToSync, phase: 'downloading' })

      // Helper: run OCR and return ocrPath + page cache
      async function runOCR(sourceDir: string): Promise<{ ocrPath?: string; pageOCRCache?: Record<string, PageOCRCacheEntry> }> {
        let ocrPath: string | undefined
        let pageOCRCache: Record<string, PageOCRCacheEntry> | undefined
        console.log(`[reMarkable] Running OCR for ${doc.name} from ${sourceDir}`)
        const ocrResult = await processNotebookWithOCR(sourceDir, doc.name, anthropicApiKey, existingEntry?.pageOCRCache, onProgress)
        console.log(`[reMarkable] OCR result for ${doc.name}: ${ocrResult ? 'got markdown' : 'null'}`)
        if (ocrResult) {
          const ocrFileName = `${sanitizeName(doc.name)}.md`
          const ocrDir = join(hiddenDir, doc.id)
          const ocrFullPath = join(ocrDir, ocrFileName)
          await mkdir(ocrDir, { recursive: true })
          await writeFile(ocrFullPath, ocrResult.markdown, 'utf-8')
          ocrPath = join(doc.id, ocrFileName)
          pageOCRCache = ocrResult.pageOCRCache
          onProgress?.({ message: `Saved OCR: ${ocrPath}`, notebookName: doc.name, phase: 'ocr' })
        }
        // Fallback: reuse existing OCR file on disk
        if (!ocrPath) {
          const ocrFileName = `${sanitizeName(doc.name)}.md`
          const existingOcrFile = join(hiddenDir, doc.id, ocrFileName)
          try {
            await access(existingOcrFile)
            ocrPath = join(doc.id, ocrFileName)
            pageOCRCache = existingEntry?.pageOCRCache
            console.log(`[reMarkable] Reusing existing OCR file: ${ocrPath}`)
          } catch {
            // No existing file on disk either
          }
        }
        return { ocrPath, pageOCRCache }
      }

      // OCR-only path: hash matches, local files exist, just need OCR
      if (!needsDownload && needsOCR) {
        console.log(`[reMarkable] OCR-only path for ${doc.name}`)
        onProgress?.({ message: `Processing OCR for existing notebook: ${doc.name}`, notebookName: doc.name, phase: 'ocr' })
        const { ocrPath, pageOCRCache } = await runOCR(notebookDir)
        newMeta.notebooks[doc.id] = {
          ...existingEntry!,
          ocrPath,
          pageOCRCache,
          markdownPath: existingEntry?.markdownPath
        }
        result.synced++
        onProgress?.({ message: `Done: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, phase: 'notebook-done' })
        await saveMetadata(baseDir, newMeta)
        return
      }

      // Full download path — resume from zip if available, otherwise download
      let zipData: Buffer
      if (zipExists && !localFilesExist) {
        console.log(`[reMarkable] Resuming from cached zip for ${doc.name}`)
        onProgress?.({ message: `Resuming: ${doc.name} (extracting cached download)`, notebookId: doc.id, notebookName: doc.name, phase: 'downloading' })
        zipData = await readFile(zipPath)
      } else {
        zipData = await client.downloadNotebook(doc.id, doc.hash)
        await writeFile(zipPath, zipData)
      }

      // Extract zip contents
      const zip = await JSZip.loadAsync(zipData)
      await mkdir(notebookDir, { recursive: true })
      const files = Object.keys(zip.files)
      for (const filename of files) {
        const file = zip.files[filename]
        const targetPath = join(notebookDir, filename)
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

      // OCR for handwritten notebooks
      let ocrPath: string | undefined
      let pageOCRCache: Record<string, PageOCRCacheEntry> | undefined
      if (doc.fileType === 'notebook') {
        const ocrResult = await runOCR(notebookDir)
        ocrPath = ocrResult.ocrPath
        pageOCRCache = ocrResult.pageOCRCache
      }

      newMeta.notebooks[doc.id] = {
        ...existingEntry,
        name: doc.name,
        parent: doc.parent,
        type: 'notebook',
        fileType: doc.fileType,
        lastModified: doc.lastModified,
        hash: doc.hash,
        localPath: join(HIDDEN_DIR, doc.hash),
        ocrPath,
        pageOCRCache,
        markdownPath: existingEntry?.markdownPath
      }

      result.synced++
      onProgress?.({ message: `Done: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, phase: 'notebook-done' })
      // Incremental save: persist metadata after each successful notebook
      await saveMetadata(baseDir, newMeta)
    }

    // Concurrent executor: process up to 3 notebooks at a time.
    // A single failure does NOT abort the queue — errors are collected.
    const CONCURRENCY = 3
    const queue = [...documentsToSync]
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      async () => {
        let doc: RemarkableNotebook | undefined
        while ((doc = queue.shift())) {
          try {
            await syncOneNotebook(doc)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            result.errors.push(`Failed to sync "${doc.name}": ${message}`)
          }
        }
      }
    )
    await Promise.all(workers)

    // Record non-synced notebooks in metadata (but don't download them)
    const nonSyncedDocs = syncState
      ? allDocuments.filter(d => !syncState.selectedNotebooks.includes(d.id))
      : []
    for (const doc of nonSyncedDocs) {
      const existingEntry = existingMeta?.notebooks[doc.id]
      // Always update name/parent/hash from cloud (user may have moved or renamed)
      // but preserve local paths from existing entry
      newMeta.notebooks[doc.id] = {
        name: doc.name,
        parent: doc.parent,
        type: 'notebook',
        fileType: doc.fileType,
        lastModified: doc.lastModified,
        hash: doc.hash,
        localPath: existingEntry?.localPath || '',
        ocrPath: existingEntry?.ocrPath,
        markdownPath: existingEntry?.markdownPath
      }
    }

    // Save updated metadata
    await saveMetadata(baseDir, newMeta)

    onProgress?.({ message: `Sync complete: ${result.synced} synced, ${result.skipped} unchanged`, phase: 'complete' })
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
  // Reuse cached connection if available — syncAll() already forces fresh data before downloading.
  // No need to disconnect here; the selection dialog just needs the notebook list.
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
