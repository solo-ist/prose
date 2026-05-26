/**
 * Comment mark persistence store
 *
 * Manages saving/loading pending comment marks to IndexedDB,
 * allowing them to persist across tab switches.
 */

import { create } from 'zustand'
import type { CommentData } from './types'
import {
  saveComments as persistComments,
  loadComments as fetchComments,
  deleteComments as removeComments
} from '../../lib/persistence'

interface CommentPersistenceState {
  /** Current document ID being tracked */
  documentId: string | null

  /** Pending comments for the current document (loaded from IndexedDB) */
  pendingComments: CommentData[]

  /** Set the current document ID and clear pending comments */
  setDocumentId: (documentId: string) => void

  /** Save current comments to IndexedDB */
  saveComments: (documentId: string, comments: CommentData[]) => Promise<void>

  /** Load comments from IndexedDB for a document */
  loadComments: (documentId: string) => Promise<void>

  /** Clear pending comments from memory (not from IndexedDB) */
  clearComments: () => void

  /** Delete comments from IndexedDB for a document */
  deleteComments: (documentId: string) => Promise<void>
}

export const useCommentStore = create<CommentPersistenceState>((set, get) => ({
  documentId: null,
  pendingComments: [],

  setDocumentId: (documentId: string) => {
    set({ documentId, pendingComments: [] })
  },

  saveComments: async (documentId: string, comments: CommentData[]) => {
    if (!documentId) {
      console.warn('[CommentStore] No documentId provided, skipping save')
      return
    }

    console.log('[CommentStore] Saving comments:', {
      documentId,
      count: comments.length
    })

    await persistComments(documentId, comments)
  },

  loadComments: async (documentId: string) => {
    console.log('[CommentStore] Loading comments for:', documentId)

    const comments = await fetchComments(documentId)

    set({
      documentId,
      pendingComments: comments
    })

    console.log('[CommentStore] Loaded comments:', {
      documentId,
      count: comments.length
    })
  },

  clearComments: () => {
    set({ pendingComments: [] })
  },

  deleteComments: async (documentId: string) => {
    await removeComments(documentId)

    // Clear from memory if it's the current document
    const state = get()
    if (state.documentId === documentId) {
      set({ pendingComments: [] })
    }
  }
}))
