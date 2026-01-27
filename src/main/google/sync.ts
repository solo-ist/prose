import { app } from 'electron'
import { mkdir, readFile, writeFile, access, readdir } from 'fs/promises'
import { join } from 'path'
import { createDoc, updateDoc, getDoc, getDocMetadata, docExists, extractDocId, listRecentDocs } from './client'

// --- Google Docs Sync Metadata ---

export interface GoogleDocEntry {
  title: string
  googleDocId: string
  localPath: string
  webViewLink: string
  syncedAt: string
  remoteModifiedTime: string
  status?: 'ok' | 'missing'
}

export interface GoogleSyncMetadata {
  lastSyncedAt: string
  documents: Record<string, GoogleDocEntry>
}

let cachedMetadata: GoogleSyncMetadata | null = null

function getMetadataDir(): string {
  const documentsPath = app.getPath('documents')
  return join(documentsPath, 'Google Docs', '.google')
}

function getMetadataPath(): string {
  return join(getMetadataDir(), 'sync-metadata.json')
}

async function loadMetadata(): Promise<GoogleSyncMetadata> {
  if (cachedMetadata) return cachedMetadata

  const metadataPath = getMetadataPath()
  try {
    const raw = await readFile(metadataPath, 'utf-8')
    cachedMetadata = JSON.parse(raw) as GoogleSyncMetadata
    return cachedMetadata
  } catch {
    // File doesn't exist — try migration
    cachedMetadata = await migrateFromFrontmatter()
    return cachedMetadata
  }
}

async function saveMetadata(metadata: GoogleSyncMetadata): Promise<void> {
  const dir = getMetadataDir()
  await mkdir(dir, { recursive: true })
  await writeFile(getMetadataPath(), JSON.stringify(metadata, null, 2), 'utf-8')
  cachedMetadata = metadata
}

/**
 * Migrate existing files in ~/Documents/Google Docs/ that have google_doc_id frontmatter
 * into a new sync-metadata.json. One-time operation on first load.
 */
async function migrateFromFrontmatter(): Promise<GoogleSyncMetadata> {
  const documentsPath = app.getPath('documents')
  const googleDocsDir = join(documentsPath, 'Google Docs')
  const metadata: GoogleSyncMetadata = {
    lastSyncedAt: new Date().toISOString(),
    documents: {}
  }

  try {
    const entries = await readdir(googleDocsDir, { withFileTypes: true })
    const matter = (await import('gray-matter')).default

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue

      const filePath = join(googleDocsDir, entry.name)
      try {
        const content = await readFile(filePath, 'utf-8')
        const parsed = matter(content)
        const docId = parsed.data.google_doc_id
        if (!docId) continue

        const title = entry.name.replace(/\.md$/, '')
        metadata.documents[String(docId)] = {
          title,
          googleDocId: String(docId),
          localPath: filePath,
          webViewLink: `https://docs.google.com/document/d/${docId}/edit`,
          syncedAt: parsed.data.google_synced_at
            ? String(parsed.data.google_synced_at)
            : new Date().toISOString(),
          remoteModifiedTime: parsed.data.google_synced_at
            ? String(parsed.data.google_synced_at)
            : new Date().toISOString(),
          status: 'ok'
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Google Docs directory doesn't exist yet — empty metadata is fine
  }

  await saveMetadata(metadata)
  return metadata
}

/**
 * Get sync metadata with file-existence checks.
 * Called by renderer via IPC.
 */
export async function getGoogleSyncMetadata(): Promise<GoogleSyncMetadata> {
  const metadata = await loadMetadata()

  // Verify each localPath still exists
  for (const [docId, entry] of Object.entries(metadata.documents)) {
    try {
      await access(entry.localPath)
      metadata.documents[docId] = { ...entry, status: 'ok' }
    } catch {
      metadata.documents[docId] = { ...entry, status: 'missing' }
    }
  }

  cachedMetadata = metadata
  return metadata
}

/**
 * Add or update a single document entry in the metadata.
 */
export async function updateGoogleSyncMetadataEntry(entry: GoogleDocEntry): Promise<void> {
  const metadata = await loadMetadata()
  metadata.documents[entry.googleDocId] = { ...entry, status: 'ok' }
  metadata.lastSyncedAt = new Date().toISOString()
  await saveMetadata(metadata)
}

/**
 * Remove a document entry from the metadata.
 */
export async function removeGoogleSyncMetadataEntry(googleDocId: string): Promise<void> {
  const metadata = await loadMetadata()
  delete metadata.documents[googleDocId]
  await saveMetadata(metadata)
}

export interface PushResult {
  success: boolean
  docId?: string
  webViewLink?: string
  error?: string
  isNew: boolean
}

export interface PullResult {
  success: boolean
  content?: string
  modifiedTime?: string
  error?: string
}

export interface SyncDocResult {
  success: boolean
  direction: 'push' | 'pull' | 'create'
  docId?: string
  webViewLink?: string
  content?: string
  modifiedTime?: string
  error?: string
}

export interface SyncAllResult {
  synced: number
  skipped: number
  errors: string[]
}

interface Frontmatter {
  google_doc_id?: string
  google_synced_at?: string
  [key: string]: unknown
}

/**
 * Push document to Google Docs
 * Creates new doc if no google_doc_id in frontmatter, updates existing otherwise
 */
export async function pushToGoogle(
  content: string,
  frontmatter: Frontmatter,
  title: string
): Promise<PushResult> {
  try {
    const rawDocId = frontmatter.google_doc_id
    const existingDocId = rawDocId ? extractDocId(String(rawDocId)) : undefined

    if (existingDocId) {
      // Check if doc still exists
      const exists = await docExists(existingDocId)
      if (!exists) {
        return {
          success: false,
          error: 'The linked Google Doc no longer exists. Would you like to create a new one?',
          isNew: false
        }
      }

      // Update existing document
      await updateDoc(existingDocId, content)
      const metadata = await getDocMetadata(existingDocId)

      return {
        success: true,
        docId: existingDocId,
        webViewLink: metadata.webViewLink,
        isNew: false
      }
    } else {
      // Create new document
      const docId = await createDoc(title, content)
      const metadata = await getDocMetadata(docId)

      return {
        success: true,
        docId,
        webViewLink: metadata.webViewLink,
        isNew: true
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage,
      isNew: false
    }
  }
}

/**
 * Pull document content from Google Docs
 */
export async function pullFromGoogle(rawDocId: string): Promise<PullResult> {
  try {
    const docId = extractDocId(rawDocId)
    // Check if doc exists
    const exists = await docExists(docId)
    if (!exists) {
      return {
        success: false,
        error: 'The linked Google Doc no longer exists or you no longer have access to it.'
      }
    }

    // Get document content
    const content = await getDoc(docId)
    const metadata = await getDocMetadata(docId)

    return {
      success: true,
      content,
      modifiedTime: metadata.modifiedTime
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Import a Google Doc by ID
 */
export async function importFromGoogle(rawDocId: string): Promise<{
  success: boolean
  content?: string
  title?: string
  docId?: string
  error?: string
}> {
  try {
    const docId = extractDocId(rawDocId)
    const content = await getDoc(docId)
    const metadata = await getDocMetadata(docId)

    return {
      success: true,
      content,
      title: metadata.title,
      docId
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Ensure the ~/Documents/Google Docs/ folder exists
 * Returns the absolute path
 */
export async function ensureGoogleDocsFolder(): Promise<string> {
  const documentsPath = app.getPath('documents')
  const googleDocsPath = join(documentsPath, 'Google Docs')
  await mkdir(googleDocsPath, { recursive: true })
  return googleDocsPath
}

/**
 * Unified sync: determines direction automatically based on timestamps
 */
export async function syncDocument(
  content: string,
  frontmatter: Frontmatter,
  title: string
): Promise<SyncDocResult> {
  try {
    const rawDocId = frontmatter.google_doc_id
    const existingDocId = rawDocId ? extractDocId(String(rawDocId)) : undefined

    if (!existingDocId) {
      // No google_doc_id → create new doc
      const docId = await createDoc(title, content)
      const metadata = await getDocMetadata(docId)

      return {
        success: true,
        direction: 'create',
        docId,
        webViewLink: metadata.webViewLink,
        modifiedTime: metadata.modifiedTime
      }
    }

    // Has google_doc_id → check if doc still exists
    const exists = await docExists(existingDocId)
    if (!exists) {
      return {
        success: false,
        direction: 'push',
        error: 'The linked Google Doc no longer exists. Remove the google_doc_id from frontmatter to create a new one.'
      }
    }

    // Compare timestamps to decide direction
    const metadata = await getDocMetadata(existingDocId)
    const remoteMod = new Date(metadata.modifiedTime).getTime()
    const localSyncedAt = frontmatter.google_synced_at
      ? new Date(String(frontmatter.google_synced_at)).getTime()
      : 0

    if (remoteMod > localSyncedAt) {
      // Remote is newer → pull
      const remoteContent = await getDoc(existingDocId)
      return {
        success: true,
        direction: 'pull',
        docId: existingDocId,
        webViewLink: metadata.webViewLink,
        content: remoteContent,
        modifiedTime: metadata.modifiedTime
      }
    } else {
      // Local is newer or same → push
      await updateDoc(existingDocId, content)
      const updatedMetadata = await getDocMetadata(existingDocId)

      return {
        success: true,
        direction: 'push',
        docId: existingDocId,
        webViewLink: updatedMetadata.webViewLink,
        modifiedTime: updatedMetadata.modifiedTime
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      direction: 'push',
      error: errorMessage
    }
  }
}

/**
 * Sync all tracked Google Docs by pulling remote changes for documents
 * already in our sync metadata. Does NOT discover new docs from the API —
 * documents enter the metadata only through explicit user actions
 * (push, import, create).
 */
export async function syncAllGoogleDocs(_syncDir: string): Promise<SyncAllResult> {
  let synced = 0
  let skipped = 0
  const errors: string[] = []

  try {
    const metadata = await loadMetadata()
    const entries = Object.values(metadata.documents)

    if (entries.length === 0) {
      return { synced: 0, skipped: 0, errors: [] }
    }

    const matter = (await import('gray-matter')).default

    for (const entry of entries) {
      try {
        // Get remote metadata to check if doc has been modified
        const remoteMeta = await getDocMetadata(entry.googleDocId)
        const remoteMod = new Date(remoteMeta.modifiedTime).getTime()
        const localSyncedAt = new Date(entry.syncedAt).getTime()

        if (remoteMod <= localSyncedAt) {
          skipped++
          continue
        }

        // Remote is newer — pull content and update local file
        const content = await getDoc(entry.googleDocId)

        // Read existing file to preserve/update frontmatter
        let localContent = ''
        let localExists = false
        try {
          localContent = await readFile(entry.localPath, 'utf-8')
          localExists = true
        } catch {
          // File missing — will recreate
        }

        if (localExists) {
          const parsed = matter(localContent)
          parsed.data.google_synced_at = remoteMeta.modifiedTime
          parsed.data.google_doc_id = entry.googleDocId
          const serialized = matter.stringify(content, parsed.data)
          await writeFile(entry.localPath, serialized, 'utf-8')
        } else {
          // Recreate missing file with frontmatter
          const frontmatterBlock = [
            '---',
            `google_doc_id: "${entry.googleDocId}"`,
            `google_synced_at: "${remoteMeta.modifiedTime}"`,
            '---',
            ''
          ].join('\n')
          await mkdir(entry.localPath.substring(0, entry.localPath.lastIndexOf('/')), { recursive: true })
          await writeFile(entry.localPath, frontmatterBlock + content, 'utf-8')
        }

        // Update metadata entry
        await updateGoogleSyncMetadataEntry({
          ...entry,
          syncedAt: new Date().toISOString(),
          remoteModifiedTime: remoteMeta.modifiedTime,
          webViewLink: remoteMeta.webViewLink || entry.webViewLink
        })

        synced++
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`${entry.title}: ${msg}`)
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    errors.push(`Failed to sync: ${msg}`)
  }

  return { synced, skipped, errors }
}
