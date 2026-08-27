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

// A document can be loaded by both the tab lifecycle and Editor's recovery
// effect. Keep only the newest request authoritative so an older response
// cannot replace live comments from the current document.
let latestLoadGeneration = 0

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

export const useCommentStore = create<CommentPersistenceState>((set, get) => ({
  documentId: null,
  pendingComments: [],
  needsRestore: false,

  setDocumentId: (documentId: string) => {
    latestLoadGeneration += 1
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

    // Changing document identity is an explicit lifecycle operation. A late
    // recovery/tab-load request for an inactive tab must not repoint the live
    // store before it awaits IndexedDB; doing so makes Activity hide a newly
    // created comment from the active document. All current callers establish
    // the identity with setDocumentId before starting a load.
    if (get().documentId !== documentId) {
      console.warn('[CommentStore] Ignoring load for inactive document:', {
        requestedDocumentId: documentId,
        currentDocumentId: get().documentId,
      })
      return
    }

    const generation = ++latestLoadGeneration

    const comments = await fetchComments(documentId)

    // A tab switch may have started a newer load while this one was pending.
    // Its result belongs to the old request and must not touch the current
    // document's Activity feed.
    if (generation !== latestLoadGeneration || get().documentId !== documentId) {
      return
    }

    // Preserve comments created while IndexedDB was being read. The persisted
    // snapshot can legitimately pre-date the live store by a few milliseconds.
    // Put the fetched snapshot first so a live entry with the same ID remains
    // authoritative for replies, resolution, and anchor positions.
    const mergedById = new Map(comments.map((comment) => [comment.id, comment]))
    for (const comment of get().pendingComments) {
      mergedById.set(comment.id, comment)
    }
    const mergedComments = Array.from(mergedById.values())

    set({
      documentId,
      pendingComments: mergedComments,
      // Marks aren't serialized into the document, so the Editor must re-apply
      // them after each load. Flag it; the Editor restore effect consumes this.
      needsRestore: true
    })

    console.log('[CommentStore] Loaded comments:', {
      documentId,
      count: mergedComments.length
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
