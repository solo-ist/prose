/**
 * reMarkable sync logic - downloads notebooks to local filesystem
 */
import { mkdir, writeFile, readFile, readdir, access, rm, rename } from 'fs/promises'
import { join, dirname, resolve, sep } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import { connect, disconnect, type RemarkableNotebook } from './client'
import { isOCRConfigured, extractTextBatched } from './ocr'
import { parseRmPageForText, paragraphsToMarkdown } from './rm-scene-parser'
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
  /**
   * Page modification timestamp from the device's .content JSON (primary cache
   * key). Note: the upstream field name is `modifed` (sic — typo in the
   * reMarkable cloud schema). We normalize to `modified` internally; legacy
   * on-disk caches with `modifed` are migrated by loadMetadata.
   */
  modified?: string
  /** SHA-256 hash of .rm file bytes (fallback when modified is unavailable) */
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
  /**
   * Sentinel set when OCR fails for a given notebook hash. Suppresses retry on
   * every subsequent sync until the notebook's content changes (hash differs).
   * Cleared on successful OCR.
   */
  ocrAttempt?: { hash: string; failedAt: string }
  /**
   * How this notebook's content was derived. `typed-text` = digital text pulled
   * from the v6 .rm scene (no OCR); `ocr` = handwriting transcribed by OCR;
   * `mixed` = both. `undefined` marks entries synced before typed-text support
   * existed, which triggers a one-time re-extraction (see needsExtraction).
   */
  extraction?: 'typed-text' | 'ocr' | 'mixed'
}

export interface SyncResult {
  syncedAt: string
  synced: number
  skipped: number
  errors: string[]
  cancelled?: boolean
}

export interface SyncProgressUpdate {
  message: string
  notebookId?: string
  notebookName?: string
  current?: number
  total?: number
  phase: 'connecting' | 'listing' | 'downloading' | 'ocr' | 'extracting' | 'notebook-done' | 'skipped' | 'complete'
}

const META_FILE = 'sync-metadata.json'
const SYNC_STATE_FILE = 'sync-state.json'
const HIDDEN_DIR = '.remarkable'

// How long the OCR-failure sentinel suppresses retries for the same content
// hash. Longer than a typical sync session (so flipping between tabs in the
// same minute doesn't re-hammer a failing OCR Lambda) but short enough that a
// new sync the next day picks up where transient failures left off.
const FAIL_RETRY_AFTER_MS = 30 * 60 * 1000

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
 * Load sync metadata from the hidden directory.
 *
 * Migrates legacy on-disk caches that use the upstream `modifed` typo to our
 * canonical `modified` field. Writes back once when migration occurs so
 * subsequent loads short-circuit (no per-sync migration cost).
 */
async function loadMetadata(baseDirectory: string): Promise<SyncMetadata | null> {
  let metadata: SyncMetadata
  try {
    const metaPath = join(baseDirectory, HIDDEN_DIR, META_FILE)
    const content = await readFile(metaPath, 'utf-8')
    metadata = JSON.parse(content) as SyncMetadata
  } catch {
    return null
  }

  let migrated = false
  for (const entry of Object.values(metadata.notebooks ?? {})) {
    for (const page of Object.values(entry.pageOCRCache ?? {}) as Array<PageOCRCacheEntry & { modifed?: string }>) {
      if (page.modifed != null && page.modified == null) {
        page.modified = page.modifed
        migrated = true
      }
      if ('modifed' in page) {
        delete page.modifed
        migrated = true
      }
    }
  }
  if (migrated) await saveMetadata(baseDirectory, metadata)
  return metadata
}

/**
 * Single-element promise queue serializing saveMetadata calls. With concurrent
 * sync workers, naive read-modify-write would lose entries when two workers
 * snapshot the same in-memory state and overwrite each other. enqueueSave
 * forces them to run sequentially.
 *
 * saveTail is module-level singleton state intentionally — it has no per-sync
 * scope because the queue must outlive any single syncAll invocation (the
 * sync's final save and any updateNotebookParent call landing during shutdown
 * both go through the same chain). Concurrent syncAll calls cannot occur in
 * practice: useRemarkableSync.sync uses a ref-based lock and the IPC handler
 * uses currentRemarkableSyncAbort to enforce one in-flight sync at a time.
 * If those locks are ever bypassed the queue still serializes correctly; it
 * just blends saves from both runs onto the same tail.
 */
let saveTail: Promise<void> = Promise.resolve()
function enqueueSave<T>(fn: () => Promise<T>): Promise<T> {
  const result = saveTail.then(fn, fn)
  saveTail = result.then(() => undefined, () => undefined)
  return result
}

/**
 * Escape a string into a safe YAML double-quoted scalar. reMarkable notebook
 * names are user-controlled and may contain colons, newlines, or quotes — any
 * of which would malform an unquoted YAML value. Double-quoted YAML escapes
 * backslash + double-quote, and escapes the characters YAML treats as line
 * breaks: ASCII CR/LF/TAB plus Unicode NEXT LINE (U+0085), LINE SEPARATOR
 * (U+2028), and PARAGRAPH SEPARATOR (U+2029). Uses \u escapes for the three
 * Unicode code points so the source file itself stays pure ASCII.
 */
function yamlDoubleQuote(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\u0085/g, '\\N')
    .replace(/\u2028/g, '\\L')
    .replace(/\u2029/g, '\\P')
  return `"${escaped}"`
}

async function writeMetadataToDisk(baseDirectory: string, metadata: SyncMetadata): Promise<void> {
  const snapshot = JSON.stringify(metadata, null, 2)
  const hiddenDir = join(baseDirectory, HIDDEN_DIR)
  await mkdir(hiddenDir, { recursive: true })
  const metaPath = join(hiddenDir, META_FILE)
  const tmpPath = join(hiddenDir, `${META_FILE}.${process.pid}.tmp`)
  await writeFile(tmpPath, snapshot, 'utf-8')
  await rename(tmpPath, metaPath)
}

/**
 * Save sync metadata to the hidden directory.
 *
 * Writes via temp-file-then-rename (POSIX-atomic on the same filesystem) so a
 * crash or kill mid-write cannot corrupt sync-metadata.json. Serialized via
 * enqueueSave so concurrent workers don't race on read-modify-write.
 */
async function saveMetadata(baseDirectory: string, metadata: SyncMetadata): Promise<void> {
  // The `metadata` object is captured by reference (not snapshotted) and the
  // JSON.stringify inside writeMetadataToDisk runs when the queue reaches this
  // call — NOT when saveMetadata was invoked. That's intentional: concurrent
  // workers mutate `newMeta.notebooks[doc.id]` in parallel, and each enqueued
  // save gets the latest state at serialize-time, not whatever was present
  // when it was queued. A save enqueued early still includes updates from
  // workers that finished while it was waiting its turn.
  return enqueueSave(() => writeMetadataToDisk(baseDirectory, metadata))
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

/** Outcome of deriving markdown content from a notebook directory. */
type ContentResult =
  | {
      markdown: string
      pageOCRCache: Record<string, PageOCRCacheEntry>
      extraction: 'typed-text' | 'ocr' | 'mixed'
    }
  // markdown === null: no content was produced. `isFailure` distinguishes a
  // genuine OCR failure (→ stamp the retry sentinel) from a graceful skip such
  // as a pure-handwriting notebook while OCR is unconfigured (→ no sentinel).
  // `extraction` is carried even on a skip so the caller can persist the
  // classification and avoid re-parsing an unchanged notebook every sync.
  | { markdown: null; isFailure: boolean; extraction?: 'typed-text' | 'ocr' | 'mixed' }

/**
 * Derive markdown for a notebook directory.
 *
 * Two content sources are merged per page:
 *  - **Typed text** ("Type Folio" keyboard input) is pulled locally from each
 *    page's v6 `.rm` scene (RootTextBlock) — no OCR, no API key required. Typed
 *    text wins for a page even if it also carries strokes.
 *  - **Handwriting** strokes are transcribed by the OCR Lambda, with the
 *    existing per-page cache to avoid repeat (expensive) API calls.
 *
 * Every page's bytes are read and parsed for typed text on each sync — this is
 * cheap and, crucially, bypasses the OCR cache, which may hold stale blank
 * results for typed pages synced before typed-text support existed.
 *
 * @param notebookDir - Path to extracted notebook directory (e.g., .remarkable/<hash>/)
 * @param notebookName - Display name for the notebook
 * @param anthropicApiKey - API key for the OCR service (handwriting only)
 * @param existingCache - Per-page OCR cache from previous sync (enables incremental OCR)
 * @param onProgress - Progress callback
 */
export async function processNotebookContent(
  notebookDir: string,
  notebookName: string,
  anthropicApiKey: string | null | undefined,
  existingCache?: Record<string, PageOCRCacheEntry>,
  onProgress?: (update: SyncProgressUpdate) => void,
  signal?: AbortSignal
): Promise<ContentResult> {
  const ocrAvailable = isOCRConfigured() && !!anthropicApiKey
  console.log(`[content] processNotebookContent for "${notebookName}" (ocrAvailable=${ocrAvailable})`)

  try {
    // Read page order and modification timestamps from .content file
    let pageOrder: string[] = []
    const pageTimestamps: Record<string, string> = {} // bare pageId → modifed timestamp
    const files = await readdir(notebookDir, { recursive: true })

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
      } catch {
        console.warn(`[content] Failed to parse .content file, falling back to alphabetical`)
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

    if (rmFiles.length === 0) {
      console.log(`[content] No .rm files found in "${notebookName}"`)
      // Nothing to transcribe — graceful skip, not a failure.
      return { markdown: null, isFailure: false }
    }

    const pageMarkdown: Record<string, string> = {} // final markdown per pageId
    const pageKind: Record<string, 'typed' | 'ocr' | 'empty'> = {}
    const pagesToOCR: Array<{ id: string; data: Buffer }> = []
    const pageHashes: Record<string, string> = {} // pageId → rmHash
    const newCache: Record<string, PageOCRCacheEntry> = {}
    const allPageIds: string[] = []
    // pageId → bareId lookup (bareId = the page UUID without directory prefix),
    // used to key the .content timestamp map for the OCR cache.
    const bareIdByPageId: Record<string, string> = {}

    for (const rmFile of rmFiles) {
      const filePath = join(notebookDir, rmFile)
      const pageId = rmFile.replace('.rm', '').replace(/\//g, '_')
      const bareId = rmFile.replace('.rm', '').replace(/.*\//, '')
      allPageIds.push(pageId)
      bareIdByPageId[pageId] = bareId

      // Always read + parse each page: typed-text extraction is local and cheap,
      // and must run every sync (the OCR cache can hold stale blank results for
      // typed pages synced before typed-text support existed). The OCR cache is
      // still consulted below to avoid repeat OCR API calls for stroke pages.
      const fileData = await readFile(filePath)
      pageHashes[pageId] = createHash('sha256').update(fileData).digest('hex')
      const parsed = parseRmPageForText(fileData)

      if (parsed.hasTypedText) {
        // Typed text wins for this page — no OCR, even if strokes are present.
        pageKind[pageId] = 'typed'
        pageMarkdown[pageId] = paragraphsToMarkdown(parsed.paragraphs)
        continue
      }

      if (!parsed.hasStrokes) {
        // Empty page — neither typed text nor strokes.
        pageKind[pageId] = 'empty'
        pageMarkdown[pageId] = ''
        continue
      }

      // Stroke page → OCR, reusing the per-page cache when the content is unchanged.
      pageKind[pageId] = 'ocr'
      const cached = existingCache?.[pageId]
      if (cached) {
        const currentTimestamp = pageTimestamps[bareId]
        const timestampHit = !!(hasTimestamps && cached.modified && currentTimestamp === cached.modified)
        const hashHit = !!(cached.rmHash && cached.rmHash === pageHashes[pageId])
        if (timestampHit || hashHit) {
          newCache[pageId] = cached
          pageMarkdown[pageId] = cached.markdown
          continue
        }
      }
      // New/changed stroke page — OCR it if the service is available; otherwise
      // leave it blank (graceful — the notebook still shows any typed content).
      if (ocrAvailable) {
        pagesToOCR.push({ id: pageId, data: fileData })
      } else {
        pageMarkdown[pageId] = ''
      }
    }

    const typedCount = allPageIds.filter(id => pageKind[id] === 'typed' && (pageMarkdown[id] ?? '').trim() !== '').length
    const strokePageCount = allPageIds.filter(id => pageKind[id] === 'ocr').length
    const cachedStrokeCount = strokePageCount - pagesToOCR.length

    if (pagesToOCR.length > 0) {
      onProgress?.({ message: `OCR: ${pagesToOCR.length} handwritten page(s) — "${notebookName}"`, notebookName, phase: 'ocr' })
    } else if (typedCount > 0) {
      onProgress?.({ message: `Extracting text — "${notebookName}"`, notebookName, phase: 'extracting' })
    }

    // OCR the stroke pages that need it. extractTextBatched degrades gracefully
    // (a failed batch retries page-by-page); failedPageIds are pages that failed
    // even in isolation, marked inline so the gap is visible and recoverable.
    let ocrResults: Array<{ id: string; markdown: string; confidence: number }> = []
    const failedPageIds = new Set<string>()

    if (pagesToOCR.length > 0 && anthropicApiKey) {
      const result = await extractTextBatched(pagesToOCR, anthropicApiKey, (processed, total) => {
        onProgress?.({ message: `OCR: page ${processed} of ${pagesToOCR.length} — "${notebookName}"`, notebookName, current: processed, total, phase: 'ocr' })
      }, signal)

      if (result.failedPages.length > 0) {
        for (const id of result.failedPages) failedPageIds.add(id)
        onProgress?.({ message: `Warning: ${result.failedPages.length} pages failed OCR`, notebookName, phase: 'ocr' })
      }

      ocrResults = result.pages
      for (const page of result.pages) {
        const bareId = bareIdByPageId[page.id]
        newCache[page.id] = {
          modified: bareId ? pageTimestamps[bareId] : undefined,
          rmHash: pageHashes[page.id],
          markdown: page.markdown,
          confidence: page.confidence
        }
        pageMarkdown[page.id] = page.markdown
      }

      // Total OCR failure: we attempted OCR, every page failed, and there is no
      // cached OCR content and no typed text to fall back on. Signal a failure
      // so the caller stamps the retry sentinel. A partial failure falls through
      // and saves a usable notebook (a gap beats no notebook).
      if (ocrResults.length === 0 && cachedStrokeCount === 0 && typedCount === 0) {
        console.warn(`[content] All ${pagesToOCR.length} OCR pages failed for "${notebookName}"`)
        onProgress?.({ message: `OCR failed for all pages of "${notebookName}"`, notebookName, phase: 'ocr' })
        return { markdown: null, isFailure: true }
      }
    }

    // Classify how content was derived. Computed BEFORE the no-content check so a
    // graceful skip persists it too — otherwise an unchanged handwriting notebook
    // (OCR unconfigured) would be re-read and re-parsed on every sync, since its
    // metadata would never record an extraction outcome.
    const extraction: 'typed-text' | 'ocr' | 'mixed' =
      typedCount > 0 && strokePageCount > 0 ? 'mixed'
        : typedCount > 0 ? 'typed-text'
          : 'ocr'

    // No content at all (no typed text and no OCR output) — graceful skip, not a
    // failure. e.g. a handwriting notebook synced while OCR is unconfigured.
    const anyContent = allPageIds.some(id => (pageMarkdown[id] ?? '').trim() !== '')
    if (!anyContent) {
      return { markdown: null, isFailure: false, extraction }
    }

    // Assemble all pages in order.
    const markdownParts = allPageIds.map((pageId, index) => {
      const pageHeader = allPageIds.length > 1 ? `<!-- Page ${index + 1} -->\n\n` : ''
      const body = failedPageIds.has(pageId)
        ? '*[This page could not be transcribed. Use “Retry Sync” to try again.]*'
        : (pageMarkdown[pageId] ?? '')
      return pageHeader + body
    })
    const combinedMarkdown = markdownParts.join('\n\n---\n\n')

    // Add metadata header. Notebook names come from the reMarkable cloud and
    // can contain colons, newlines, or quotes — values that would malform an
    // unquoted YAML scalar. yamlDoubleQuote escapes the content into a safe
    // double-quoted YAML string so the frontmatter parses cleanly regardless
    // of what the user named the notebook.
    const header = `---
title: ${yamlDoubleQuote(notebookName)}
source: reMarkable
pages: ${allPageIds.length}
extraction: ${extraction}
extracted: ${new Date().toISOString()}
---

`

    return { markdown: header + combinedMarkdown, pageOCRCache: newCache, extraction }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[content] Error processing "${notebookName}":`, error)
    onProgress?.({ message: `Sync failed for "${notebookName}": ${message}`, notebookName, phase: 'ocr' })
    return { markdown: null, isFailure: true }
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
  onProgress?: (update: SyncProgressUpdate) => void,
  signal?: AbortSignal
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

    // Track start + completion counts separately. Under CONCURRENCY=3 these diverge —
    // `started` is monotonic in kickoff order, `finished` is monotonic in completion order.
    // Start-phase events (downloading) use `started`; completion events (skipped, notebook-done)
    // use `finished` so any downstream progress indicator sees a monotonically advancing count.
    let started = 0
    let finished = 0
    const totalToSync = documentsToSync.length

    // Process a single notebook (used by the concurrent executor)
    async function syncOneNotebook(doc: RemarkableNotebook): Promise<void> {
      const idx = ++started
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
      // The OCR-failure sentinel expires after FAIL_RETRY_AFTER_MS so transient
      // failures (Lambda cold start, OCR rate limits hit by concurrent workers,
      // network blips) self-heal on the next sync instead of leaving a wall of
      // red triangles that the user has to clear one-by-one via Retry Sync.
      // Hash equality still short-circuits within the window — same content,
      // same OCR call, no point hammering the service. The user-triggered
      // clearOcrSentinel path remains for forcing a retry inside the window.
      const failedAt = existingEntry?.ocrAttempt?.failedAt
      const failedAtMs = failedAt ? Date.parse(failedAt) : 0
      const failureIsFresh = failedAtMs > 0 && (Date.now() - failedAtMs) < FAIL_RETRY_AFTER_MS
      const ocrPreviouslyFailed = existingEntry?.ocrAttempt?.hash === doc.hash && failureIsFresh
      // A notebook needs content extraction when it has no recorded extraction
      // outcome yet — it's new, or predates typed-text support (a one-time heal so
      // already-synced typed docs with empty bodies fill in). Typed-text extraction
      // needs no OCR service, so this does NOT gate on isOCRConfigured().
      //
      // The second clause re-triggers a handwriting notebook that was gracefully
      // skipped while OCR was unconfigured (extraction:'ocr' recorded, but no
      // ocrPath) once OCR later becomes available — otherwise it would never get
      // transcribed. A content change re-triggers everything anyway via needsDownload.
      // Recording the outcome (even on a skip) is what stops an unchanged handwriting
      // notebook from being re-parsed on every sync.
      const needsExtraction = doc.fileType === 'notebook' && !ocrPreviouslyFailed && (
        existingEntry?.extraction === undefined ||
        (!existingEntry?.ocrPath && existingEntry?.extraction === 'ocr' && isOCRConfigured())
      )
      console.log(`[reMarkable] ${doc.name}: needsDownload=${needsDownload}, needsExtraction=${needsExtraction}, localFilesExist=${localFilesExist}, zipExists=${zipExists}`)

      if (!needsDownload && !needsExtraction) {
        result.skipped++
        // Carry the existing entry into newMeta so it survives the final
        // sync-metadata.json write at the end of syncAll. No incremental
        // save here — the entry is unchanged from disk, and the post-sync
        // final saveMetadata will persist this branch alongside any work
        // other workers actually did.
        newMeta.notebooks[doc.id] = existingEntry!
        const done = ++finished
        onProgress?.({ message: `Up to date: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, current: done, total: totalToSync, phase: 'skipped' })
        return
      }

      // Only show sync indicator for notebooks that actually need work
      onProgress?.({ message: `Syncing ${idx}/${totalToSync}: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, current: idx, total: totalToSync, phase: 'downloading' })

      // Helper: derive content (typed text and/or OCR) and return ocrPath +
      // page cache + freshSucceeded + isFailure + extraction.
      //
      // freshSucceeded reports whether THIS sync produced a new markdown file.
      // ocrPath may instead be populated by the stale-file fallback below, so
      // callers key the retry sentinel off isFailure (a genuine OCR failure),
      // not ocrPath — otherwise the fallback would silently mask failures.
      async function runExtraction(sourceDir: string): Promise<{
        ocrPath?: string
        pageOCRCache?: Record<string, PageOCRCacheEntry>
        freshSucceeded: boolean
        isFailure: boolean
        extraction?: 'typed-text' | 'ocr' | 'mixed'
      }> {
        let ocrPath: string | undefined
        let pageOCRCache: Record<string, PageOCRCacheEntry> | undefined
        let freshSucceeded = false
        console.log(`[reMarkable] Extracting content for ${doc.name} from ${sourceDir}`)
        const result = await processNotebookContent(sourceDir, doc.name, anthropicApiKey, existingEntry?.pageOCRCache, onProgress, signal)
        // Capture the classification even when no fresh file was written (a graceful
        // skip) so the caller persists it and the notebook isn't re-parsed next sync.
        let extraction: 'typed-text' | 'ocr' | 'mixed' | undefined = result.extraction
        if (result.markdown !== null) {
          const ocrFileName = `${sanitizeName(doc.name)}.md`
          const ocrDir = join(hiddenDir, doc.id)
          const ocrFullPath = join(ocrDir, ocrFileName)
          await mkdir(ocrDir, { recursive: true })
          await writeFile(ocrFullPath, result.markdown, 'utf-8')
          ocrPath = join(doc.id, ocrFileName)
          pageOCRCache = result.pageOCRCache
          freshSucceeded = true
          onProgress?.({ message: `Saved: ${ocrPath}`, notebookName: doc.name, phase: 'notebook-done' })
        }
        // Fallback: keep referencing the existing on-disk file so the user can
        // still read what was extracted previously. Does NOT flip freshSucceeded
        // — the sentinel tracks the most recent fresh attempt, independent of
        // stale content.
        if (!ocrPath) {
          const ocrFileName = `${sanitizeName(doc.name)}.md`
          const existingOcrFile = join(hiddenDir, doc.id, ocrFileName)
          try {
            await access(existingOcrFile)
            ocrPath = join(doc.id, ocrFileName)
            pageOCRCache = existingEntry?.pageOCRCache
            extraction = existingEntry?.extraction ?? result.extraction
            console.log(`[reMarkable] Reusing existing content file: ${ocrPath}`)
          } catch {
            // No existing file on disk either
          }
        }
        const isFailure = result.markdown === null ? result.isFailure : false
        return { ocrPath, pageOCRCache, freshSucceeded, isFailure, extraction }
      }

      // Extraction-only path: hash matches, local files exist, just (re)derive content
      if (!needsDownload && needsExtraction) {
        console.log(`[reMarkable] Extraction-only path for ${doc.name}`)
        onProgress?.({ message: `Processing existing notebook: ${doc.name}`, notebookName: doc.name, phase: 'extracting' })
        const { ocrPath, pageOCRCache, isFailure, extraction } = await runExtraction(notebookDir)
        newMeta.notebooks[doc.id] = {
          ...existingEntry!,
          ocrPath,
          pageOCRCache,
          extraction: extraction ?? existingEntry?.extraction,
          markdownPath: existingEntry?.markdownPath,
          // Sentinel fires only on a genuine OCR failure (isFailure), never on a
          // graceful skip; a successful extraction clears any prior sentinel.
          ocrAttempt: isFailure ? { hash: doc.hash, failedAt: new Date().toISOString() } : undefined
        }
        result.synced++
        const done = ++finished
        onProgress?.({ message: `Done: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, current: done, total: totalToSync, phase: 'notebook-done' })
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

      // Extraction succeeded — drop the cached zip. It's only kept across
      // runs so an interrupted sync can resume without re-downloading; once
      // the extracted files are on disk, the zip is dead weight.
      await rm(zipPath, { force: true })

      // Derive content (typed text and/or OCR) for notebooks.
      let ocrPath: string | undefined
      let pageOCRCache: Record<string, PageOCRCacheEntry> | undefined
      let extraction: 'typed-text' | 'ocr' | 'mixed' | undefined
      let extractionFailed = false
      if (doc.fileType === 'notebook') {
        const contentResult = await runExtraction(notebookDir)
        ocrPath = contentResult.ocrPath
        pageOCRCache = contentResult.pageOCRCache
        extraction = contentResult.extraction
        extractionFailed = contentResult.isFailure
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
        extraction: extraction ?? existingEntry?.extraction,
        markdownPath: existingEntry?.markdownPath,
        // Sentinel fires only on a genuine OCR failure for a notebook; a
        // graceful skip, a successful extraction, or a non-notebook file type
        // all clear it. Keys off extractionFailed, NOT ocrPath — ocrPath can
        // come from the stale-file fallback even when this sync's OCR failed.
        // The explicit `undefined` on success deliberately overrides any
        // ocrAttempt carried in by the existingEntry spread; JSON.stringify
        // then drops the key.
        ocrAttempt: doc.fileType === 'notebook' && extractionFailed
          ? { hash: doc.hash, failedAt: new Date().toISOString() }
          : undefined
      }

      result.synced++
      const done = ++finished
      onProgress?.({ message: `Done: ${doc.name}`, notebookId: doc.id, notebookName: doc.name, current: done, total: totalToSync, phase: 'notebook-done' })
      // Incremental save: persist metadata after each successful notebook
      await saveMetadata(baseDir, newMeta)
    }

    // Concurrent executor: process up to 3 notebooks at a time.
    // A single failure does NOT abort the queue — errors are collected.
    // Cancellation: if signal.aborted flips to true, workers drain the
    // remaining queue without starting new notebook work. Notebooks already
    // in flight run to completion — mid-download/mid-OCR interruption would
    // require propagating the signal into rmapi-js/fetch, which is out of
    // scope for this iteration.
    //
    // Concurrency safety of the shared `client`: rmapi-js's raw layer uses an
    // LRU cache keyed by content hash. Concurrent getText/getHash calls with
    // the same key will fetch twice (benign duplicate work — a limitation the
    // library acknowledges inline); our workers operate on distinct notebook
    // hashes so they never collide on the same cache key. No shared
    // request-in-flight state, so parallel downloadNotebook calls are safe.
    const CONCURRENCY = 3
    const queue = [...documentsToSync]
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      async () => {
        let doc: RemarkableNotebook | undefined
        while ((doc = queue.shift())) {
          if (signal?.aborted) break
          try {
            await syncOneNotebook(doc)
          } catch (error) {
            // AbortError propagates from OCR when the user cancels mid-retry —
            // that's cancellation, not a sync failure, so don't surface it
            // as an error. The signal.aborted check at the top of the next
            // loop iteration ends the worker cleanly.
            if ((error as { name?: string })?.name === 'AbortError') break
            const message = error instanceof Error ? error.message : 'Unknown error'
            result.errors.push(`Failed to sync "${doc.name}": ${message}`)
          }
        }
      }
    )
    await Promise.all(workers)

    if (signal?.aborted) {
      result.cancelled = true
      onProgress?.({ message: 'Sync cancelled', phase: 'complete' })
      console.log('[reMarkable] Sync cancelled by user')
      return result
    }

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
 * Clear the OCR-failure sentinel AND the cached ocrPath for a single notebook
 * so the next sync will run a fresh OCR attempt. Used by the "Retry Sync"
 * context-menu action when the user has fixed an external condition (e.g.
 * wrong OCR service URL) that caused the prior failure.
 *
 * Why both fields: syncOneNotebook short-circuits as "skipped" when the hash
 * matches AND `existingEntry.ocrPath` is populated. After a failed OCR the
 * stale-fallback in runExtraction may have set ocrPath to point at a previously-
 * transcribed file from an older hash, so leaving ocrPath alone would let
 * the retry skip without doing anything — flipping the UI from "failed" to
 * a fake "success" backed by stale text.
 *
 * Clearing ocrPath is safe: the on-disk file isn't deleted, and runExtraction's
 * stale-fallback re-discovers it via filesystem access if the retry also
 * fails. So the worst case (retry still broken) lands back at exactly the
 * same observable state as before retry.
 */
export async function clearOcrSentinel(
  notebookId: string,
  syncDirectory: string
): Promise<boolean> {
  const baseDir = expandPath(syncDirectory)
  // Serialize through enqueueSave for the same reason updateNotebookParent
  // does: avoid racing the read with a sync's pending writes.
  return enqueueSave(async () => {
    const metadata = await loadMetadata(baseDir)
    if (!metadata) return false

    const notebook = metadata.notebooks[notebookId]
    if (!notebook) return false
    // No-op if there's nothing to clear (defensive — UI already gates the
    // menu item on ocrFailed, but a stray call shouldn't dirty the file).
    if (!notebook.ocrAttempt && !notebook.ocrPath) return false

    delete notebook.ocrAttempt
    delete notebook.ocrPath
    await writeMetadataToDisk(baseDir, metadata)
    console.log(`[reMarkable] Cleared OCR sentinel + ocrPath for notebook ${notebookId}`)
    return true
  })
}

/**
 * Update the cloud parent ID (and optionally the content hash) of a notebook
 * in local sync metadata. Called after successfully moving a notebook on the
 * reMarkable cloud so the local view stays consistent with the cloud state.
 *
 * The optional newHash parameter is critical for the move flow: the cloud
 * assigns a fresh hash to an entry every time its metadata changes, so the
 * pre-move hash becomes invalid the moment api.move() succeeds. Without
 * persisting the new hash here, the next move attempt for the same notebook
 * passes a stale hash to the cloud and fails with "not found in root hash"
 * until the next full sync rewrites the metadata file.
 *
 * @param notebookId - The notebook ID to update
 * @param newParentId - The new cloud folder ID (empty string for root)
 * @param syncDirectory - Base sync directory
 * @param newHash - Optional new content hash to persist alongside the parent
 * @returns true if updated successfully, false if notebook not found
 */
export async function updateNotebookParent(
  notebookId: string,
  newParentId: string,
  syncDirectory: string,
  newHash?: string
): Promise<boolean> {
  const baseDir = expandPath(syncDirectory)
  // Serialize read+modify+write through enqueueSave so we don't race with a
  // sync's pending writes. Without this, we could read pre-sync metadata from
  // disk before the sync's tail save lands, then write our parent update on
  // top of stale data — clobbering the sync result. Doing the load inside
  // the queue forces this op to wait for any pending sync writes to flush
  // before reading. Calls writeMetadataToDisk directly rather than going
  // through saveMetadata to avoid recursive enqueueing.
  return enqueueSave(async () => {
    const metadata = await loadMetadata(baseDir)
    if (!metadata) return false

    const notebook = metadata.notebooks[notebookId]
    if (!notebook) return false

    notebook.parent = newParentId || null
    if (newHash) notebook.hash = newHash

    await writeMetadataToDisk(baseDir, metadata)
    console.log(`[reMarkable] Updated parent for notebook ${notebookId} to "${newParentId}"${newHash ? ` (hash → ${newHash.slice(0, 12)}...)` : ''}`)
    return true
  })
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
