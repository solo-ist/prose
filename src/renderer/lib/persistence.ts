import type { Document, ChatMessage } from '../types'
import type { AIAnnotation } from '../types/annotations'

// Types for persistence
export interface ChatConversation {
  id: string
  documentId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  title?: string
}

export interface FileListState {
  viewMode: 'recent' | 'folder' | 'notebooks'
  rootPath: string | null
  expandedFolders: string[] // Serialized from Set<string>
  selectedPath: string | null
}

export interface DraftState {
  document: Document
  cursorPosition?: { line: number; column: number }
  activeChatId: string | null
  savedAt: number
  fileList?: FileListState
}

// Tab state for session persistence
export interface TabDraft {
  tabId: string
  documentId: string
  path: string | null
  title: string
  content: string
  isDirty: boolean
  frontmatter?: Record<string, unknown>
  cursorPosition?: { line: number; column: number }
  activeChatId: string | null
}

// Session state for multi-tab persistence
export interface SessionState {
  tabs: TabDraft[]
  activeTabId: string | null
  fileList?: FileListState
  savedAt: number
}

// Database constants
const DB_NAME = 'prose-db'
const DB_VERSION = 3
const STORES = {
  DRAFTS: 'drafts',
  CONVERSATIONS: 'conversations',
  ANNOTATIONS: 'annotations',
  COMMAND_HISTORY: 'command_history'
} as const

// Recovery types
export interface RecoveryResult {
  recovered: boolean
  timestamp: number
  error?: string
  recoveredStores: string[]
  lostStores: string[]
  backupPath?: string
}

export interface DatabaseBackup {
  version: number
  timestamp: number
  stores: {
    [storeName: string]: Array<{ key: IDBValidKey; value: any }>
  }
}

/**
 * IndexedDB Version History
 * -------------------------
 * v1: Initial schema (drafts, conversations)
 * v2: Added annotations store
 * v3: Added command_history store
 *
 * When bumping version:
 * 1. Update DB_VERSION above
 * 2. Add store creation in onupgradeneeded (idempotent check)
 * 3. Document the change here
 * 4. Test with existing data before committing
 */

// Singleton database connection
let dbPromise: Promise<IDBDatabase> | null = null
let recoveryAttempted = false
let lastRecoveryResult: RecoveryResult | null = null

/**
 * Get the last recovery result if recovery occurred.
 */
export function getLastRecoveryResult(): RecoveryResult | null {
  return lastRecoveryResult
}

/**
 * Clear the recovery result (call after user acknowledges).
 */
export function clearRecoveryResult(): void {
  lastRecoveryResult = null
}

/**
 * Attempt to export database contents before deletion.
 * This tries to read whatever is accessible and save it.
 */
async function exportDatabaseToBackup(
  db?: IDBDatabase
): Promise<DatabaseBackup | null> {
  try {
    const backup: DatabaseBackup = {
      version: DB_VERSION,
      timestamp: Date.now(),
      stores: {}
    }

    // If no DB provided, try to open in readonly mode
    if (!db) {
      try {
        const request = indexedDB.open(DB_NAME)
        db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
          // Don't handle onupgradeneeded - we're just reading
        })
      } catch (error) {
        console.error('Cannot open DB for backup:', error)
        return null
      }
    }

    // Try to export each store
    for (const storeName of Object.values(STORES)) {
      if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`Store ${storeName} not found, skipping`)
        continue
      }

      try {
        const transaction = db.transaction(storeName, 'readonly')
        const store = transaction.objectStore(storeName)
        const allKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const request = store.getAllKeys()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })

        const entries: Array<{ key: IDBValidKey; value: any }> = []
        for (const key of allKeys) {
          const value = await new Promise<any>((resolve, reject) => {
            const request = store.get(key)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          entries.push({ key, value })
        }

        backup.stores[storeName] = entries
        console.log(`Backed up ${entries.length} entries from ${storeName}`)
      } catch (error) {
        console.error(`Failed to backup store ${storeName}:`, error)
        // Continue with other stores
      }
    }

    return backup
  } catch (error) {
    console.error('Failed to create backup:', error)
    return null
  }
}

/**
 * Save backup to localStorage as fallback storage.
 * IndexedDB is corrupted, so we use localStorage temporarily.
 */
function saveBackupToLocalStorage(backup: DatabaseBackup): void {
  try {
    const backupKey = `prose-backup-${backup.timestamp}`
    localStorage.setItem(backupKey, JSON.stringify(backup))
    console.log(`Backup saved to localStorage: ${backupKey}`)

    // Keep only last 3 backups in localStorage to avoid quota issues
    const allBackupKeys = Object.keys(localStorage)
      .filter((key) => key.startsWith('prose-backup-'))
      .sort()
    if (allBackupKeys.length > 3) {
      const toRemove = allBackupKeys.slice(0, allBackupKeys.length - 3)
      toRemove.forEach((key) => localStorage.removeItem(key))
    }
  } catch (error) {
    console.error('Failed to save backup to localStorage:', error)
  }
}

/**
 * Restore data from backup into a freshly created database.
 */
async function restoreFromBackup(
  db: IDBDatabase,
  backup: DatabaseBackup
): Promise<string[]> {
  const restoredStores: string[] = []

  for (const [storeName, entries] of Object.entries(backup.stores)) {
    if (!db.objectStoreNames.contains(storeName)) {
      console.warn(`Cannot restore ${storeName} - store doesn't exist`)
      continue
    }

    try {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      for (const entry of entries) {
        await new Promise<void>((resolve, reject) => {
          const request = store.put(entry.value, entry.key)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      }

      restoredStores.push(storeName)
      console.log(`Restored ${entries.length} entries to ${storeName}`)
    } catch (error) {
      console.error(`Failed to restore store ${storeName}:`, error)
    }
  }

  return restoredStores
}

/**
 * Delete the database and reset state for fresh creation.
 */
function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => {
      console.log('IndexedDB deleted successfully for recovery')
      resolve()
    }
    request.onerror = () => {
      console.error('Failed to delete IndexedDB:', request.error)
      reject(request.error)
    }
    request.onblocked = () => {
      console.warn('IndexedDB deletion blocked - other connections open')
      // Resolve anyway, next open attempt will retry
      resolve()
    }
  })
}

/**
 * Initialize and return the IndexedDB database connection.
 * Handles upgrade blocking and version change events to ensure
 * the database schema is properly migrated.
 *
 * If opening fails (e.g., corrupted database), attempts recovery
 * by deleting and recreating the database once.
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = async () => {
      console.error('Failed to open IndexedDB:', request.error)
      dbPromise = null

      // Attempt recovery once by backing up, deleting, and recreating
      if (!recoveryAttempted) {
        recoveryAttempted = true
        console.log('Attempting IndexedDB recovery with backup...')

        const recoveryResult: RecoveryResult = {
          recovered: false,
          timestamp: Date.now(),
          error: request.error?.message || 'Unknown error',
          recoveredStores: [],
          lostStores: []
        }

        try {
          // Step 1: Try to backup existing data
          console.log('Step 1: Creating backup...')
          const backup = await exportDatabaseToBackup()

          if (backup && Object.keys(backup.stores).length > 0) {
            saveBackupToLocalStorage(backup)
            console.log(
              `Backup created with ${Object.keys(backup.stores).length} stores`
            )
          } else {
            console.warn('Could not create backup - database may be unreadable')
          }

          // Step 2: Delete corrupted database
          console.log('Step 2: Deleting corrupted database...')
          await deleteDatabase()

          // Step 3: Reopen (will trigger onupgradeneeded to create fresh schema)
          console.log('Step 3: Creating fresh database...')
          const freshDb = await new Promise<IDBDatabase>((resolve, reject) => {
            const retryRequest = indexedDB.open(DB_NAME, DB_VERSION)
            retryRequest.onerror = () => reject(retryRequest.error)
            retryRequest.onsuccess = () => resolve(retryRequest.result)
            retryRequest.onupgradeneeded = (event) => {
              const db = (event.target as IDBOpenDBRequest).result
              // Create stores (same as original onupgradeneeded)
              if (!db.objectStoreNames.contains(STORES.DRAFTS)) {
                db.createObjectStore(STORES.DRAFTS)
              }
              if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
                db.createObjectStore(STORES.CONVERSATIONS)
              }
              if (!db.objectStoreNames.contains(STORES.ANNOTATIONS)) {
                db.createObjectStore(STORES.ANNOTATIONS)
              }
              if (!db.objectStoreNames.contains(STORES.COMMAND_HISTORY)) {
                db.createObjectStore(STORES.COMMAND_HISTORY)
              }
            }
          })

          // Step 4: Restore from backup if available
          if (backup && Object.keys(backup.stores).length > 0) {
            console.log('Step 4: Restoring data from backup...')
            const restoredStores = await restoreFromBackup(freshDb, backup)
            recoveryResult.recoveredStores = restoredStores

            const allStores = Object.values(STORES)
            recoveryResult.lostStores = allStores.filter(
              (store) => !restoredStores.includes(store)
            )

            console.log(`Restored stores: ${restoredStores.join(', ')}`)
            if (recoveryResult.lostStores.length > 0) {
              console.warn(`Lost stores: ${recoveryResult.lostStores.join(', ')}`)
            }
          } else {
            recoveryResult.lostStores = Object.values(STORES)
            console.warn('No backup available - starting with empty database')
          }

          recoveryResult.recovered = true
          lastRecoveryResult = recoveryResult

          resolve(freshDb)
        } catch (retryError) {
          console.error('IndexedDB recovery failed:', retryError)
          recoveryResult.error =
            retryError instanceof Error ? retryError.message : 'Recovery failed'
          lastRecoveryResult = recoveryResult
          reject(request.error)
        }
      } else {
        reject(request.error)
      }
    }

    request.onblocked = () => {
      // This fires when an older version of the DB is open in another tab/window
      // The upgrade will proceed once those connections close
      console.warn('IndexedDB upgrade blocked - waiting for other connections to close')
    }

    request.onsuccess = () => {
      const db = request.result

      // Handle version change requests from other tabs/windows
      db.onversionchange = () => {
        db.close()
        dbPromise = null
        console.log('IndexedDB closed due to version change in another tab')
      }

      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object stores if they don't exist (idempotent)
      if (!db.objectStoreNames.contains(STORES.DRAFTS)) {
        db.createObjectStore(STORES.DRAFTS)
      }
      if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
        db.createObjectStore(STORES.CONVERSATIONS)
      }
      if (!db.objectStoreNames.contains(STORES.ANNOTATIONS)) {
        db.createObjectStore(STORES.ANNOTATIONS)
      }
      if (!db.objectStoreNames.contains(STORES.COMMAND_HISTORY)) {
        db.createObjectStore(STORES.COMMAND_HISTORY)
      }
    }
  })

  return dbPromise
}

/**
 * Initialize the database connection early to ensure schema
 * migrations complete before any other DB operations.
 * Call this before rendering the app.
 */
export async function initDB(): Promise<void> {
  await getDB()
}

/**
 * Generate a UUID for document and conversation IDs
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Generate a stable document ID from a file path.
 * For saved files, this ensures chat history persists across sessions.
 */
export async function generateIdFromPath(path: string): Promise<string> {
  // Use SHA-256 hash of the path to generate a stable ID
  const encoder = new TextEncoder()
  const data = encoder.encode(path)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  // Return first 36 chars to match UUID length
  return hashHex.substring(0, 36)
}

// ============ Draft Operations ============

/**
 * Save the current draft state
 */
export async function saveDraft(state: DraftState): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.DRAFTS, 'readwrite')
      const store = transaction.objectStore(STORES.DRAFTS)
      const request = store.put(state, 'current')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save draft:', error)
  }
}

/**
 * Load the saved draft state
 */
export async function loadDraft(): Promise<DraftState | null> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.DRAFTS, 'readonly')
      const store = transaction.objectStore(STORES.DRAFTS)
      const request = store.get('current')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result ?? null)
    })
  } catch (error) {
    console.error('Failed to load draft:', error)
    return null
  }
}

/**
 * Clear the saved draft
 */
export async function clearDraft(): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.DRAFTS, 'readwrite')
      const store = transaction.objectStore(STORES.DRAFTS)
      const request = store.delete('current')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to clear draft:', error)
  }
}

// ============ Session State Operations (Multi-Tab) ============

/**
 * Save the entire session state (all tabs)
 */
export async function saveSession(state: SessionState): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.DRAFTS, 'readwrite')
      const store = transaction.objectStore(STORES.DRAFTS)
      const request = store.put(state, 'session')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save session:', error)
  }
}

/**
 * Load the saved session state
 */
export async function loadSession(): Promise<SessionState | null> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.DRAFTS, 'readonly')
      const store = transaction.objectStore(STORES.DRAFTS)
      const request = store.get('session')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result ?? null)
    })
  } catch (error) {
    console.error('Failed to load session:', error)
    return null
  }
}

/**
 * Clear the saved session state
 */
export async function clearSession(): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.DRAFTS, 'readwrite')
      const store = transaction.objectStore(STORES.DRAFTS)
      const request = store.delete('session')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to clear session:', error)
  }
}

// ============ Conversation Operations ============

/**
 * Save conversations for a document
 */
export async function saveConversations(
  documentId: string,
  conversations: ChatConversation[]
): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CONVERSATIONS, 'readwrite')
      const store = transaction.objectStore(STORES.CONVERSATIONS)
      const request = store.put(conversations, documentId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save conversations:', error)
  }
}

/**
 * Load conversations for a document
 */
export async function loadConversations(
  documentId: string
): Promise<ChatConversation[]> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CONVERSATIONS, 'readonly')
      const store = transaction.objectStore(STORES.CONVERSATIONS)
      const request = store.get(documentId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result ?? [])
    })
  } catch (error) {
    console.error('Failed to load conversations:', error)
    return []
  }
}

/**
 * Delete conversations for a document (used when discarding unsaved drafts)
 */
export async function deleteConversations(documentId: string): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.CONVERSATIONS, 'readwrite')
      const store = transaction.objectStore(STORES.CONVERSATIONS)
      const request = store.delete(documentId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to delete conversations:', error)
  }
}

/**
 * Generate a title from the first user message in a conversation
 */
export function generateConversationTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user')
  if (!firstUserMessage) return 'New Chat'

  const content = firstUserMessage.content.trim()
  if (content.length <= 40) return content

  return content.substring(0, 37) + '...'
}

// ============ Annotation Operations ============

/**
 * Save annotations for a document
 */
export async function saveAnnotations(
  documentId: string,
  annotations: AIAnnotation[]
): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.ANNOTATIONS, 'readwrite')
      const store = transaction.objectStore(STORES.ANNOTATIONS)
      const request = store.put(annotations, documentId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save annotations:', error)
  }
}

/**
 * Load annotations for a document
 */
export async function loadAnnotations(
  documentId: string
): Promise<AIAnnotation[]> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.ANNOTATIONS, 'readonly')
      const store = transaction.objectStore(STORES.ANNOTATIONS)
      const request = store.get(documentId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result ?? [])
    })
  } catch (error) {
    console.error('Failed to load annotations:', error)
    return []
  }
}

/**
 * Delete annotations for a document
 */
export async function deleteAnnotations(documentId: string): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.ANNOTATIONS, 'readwrite')
      const store = transaction.objectStore(STORES.ANNOTATIONS)
      const request = store.delete(documentId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to delete annotations:', error)
  }
}

// ============ Command History Operations ============

/**
 * Save command history
 */
export async function saveCommandHistory(
  history: Record<string, string[]>
): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.COMMAND_HISTORY, 'readwrite')
      const store = transaction.objectStore(STORES.COMMAND_HISTORY)
      const request = store.put(history, 'history')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Failed to save command history:', error)
  }
}

/**
 * Load command history
 */
export async function loadCommandHistory(): Promise<Record<string, string[]>> {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.COMMAND_HISTORY, 'readonly')
      const store = transaction.objectStore(STORES.COMMAND_HISTORY)
      const request = store.get('history')

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result ?? {})
    })
  } catch (error) {
    console.error('Failed to load command history:', error)
    return {}
  }
}
