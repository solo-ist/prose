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

  /**
   * Comments for the current document — the single source of truth for rich
   * comment data (replies + resolved state) that the editor marks don't carry.
   * Loaded from IndexedDB and kept live; the editor marks are just anchors.
   */
  pendingComments: CommentData[]

  /**
   * One-shot signal that the marks for the current document still need to be
   * restored into the editor. Set true by loadComments, cleared by markRestored
   * once the Editor has re-applied the marks. This is the restore loop-breaker —
   * it lets pendingComments stay populated (so replies/resolved survive) instead
   * of clearing it after restore.
   */
  needsRestore: boolean

  /** Set the current document ID and clear pending comments */
  setDocumentId: (documentId: string) => void

  /** Save current comments to IndexedDB */
  saveComments: (documentId: string, comments: CommentData[]) => Promise<void>

  /** Load comments from IndexedDB for a document */
  loadComments: (documentId: string) => Promise<void>

  /** Mark the current document's comment marks as restored into the editor. */
  markRestored: () => void

  /** Clear pending comments from memory (not from IndexedDB) */
  clearComments: () => void

  /** Delete comments from IndexedDB for a document */
  deleteComments: (documentId: string) => Promise<void>
}

/**
 * Open (unresolved) comment threads. The one predicate every counting surface
 * (status bar, chat chips, Comment Review) derives from, so the UI can't render
 * contradictory totals (#830). The store is the source of truth — new marks are
 * mirrored in on creation (onCommentAdded) and it stays populated across
 * restores — so counts must come from here, not from live editor marks.
 */
export function countOpenThreads(comments: CommentData[]): number {
  return comments.filter((c) => !c.resolved).length
}

export const useCommentStore = create<CommentPersistenceState>((set, get) => ({
  documentId: null,
  pendingComments: [],
  needsRestore: false,

  setDocumentId: (documentId: string) => {
    set({ documentId, pendingComments: [], needsRestore: false })
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
      pendingComments: comments,
      // Marks aren't serialized into the document, so the Editor must re-apply
      // them after each load. Flag it; the Editor restore effect consumes this.
      needsRestore: true
    })

    console.log('[CommentStore] Loaded comments:', {
      documentId,
      count: comments.length
    })
  },

  markRestored: () => {
    set({ needsRestore: false })
  },

  clearComments: () => {
    set({ pendingComments: [], needsRestore: false })
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
