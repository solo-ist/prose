import type { Document, ChatMessage } from '../types'

// Types for persistence
export interface ChatConversation {
  id: string
  documentId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  title?: string
}

export interface DraftState {
  document: Document
  cursorPosition?: { line: number; column: number }
  activeChatId: string | null
  savedAt: number
}

// Database constants
const DB_NAME = 'prose-db'
const DB_VERSION = 1
const STORES = {
  DRAFTS: 'drafts',
  CONVERSATIONS: 'conversations'
} as const

// Singleton database connection
let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Initialize and return the IndexedDB database connection
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains(STORES.DRAFTS)) {
        db.createObjectStore(STORES.DRAFTS)
      }
      if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
        db.createObjectStore(STORES.CONVERSATIONS)
      }
    }
  })

  return dbPromise
}

/**
 * Generate a UUID for document and conversation IDs
 */
export function generateId(): string {
  return crypto.randomUUID()
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
