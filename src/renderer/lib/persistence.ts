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

// Database constants
const DB_NAME = 'prose-db'
const DB_VERSION = 3
const STORES = {
  DRAFTS: 'drafts',
  CONVERSATIONS: 'conversations',
  ANNOTATIONS: 'annotations',
  COMMAND_HISTORY: 'command_history'
} as const

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

      // Attempt recovery once by deleting and recreating
      if (!recoveryAttempted) {
        recoveryAttempted = true
        console.log('Attempting IndexedDB recovery...')
        try {
          await deleteDatabase()
          // Retry opening
          const retryDb = await getDB()
          resolve(retryDb)
        } catch (retryError) {
          console.error('IndexedDB recovery failed:', retryError)
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
