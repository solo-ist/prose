/**
 * Comment thread mirror for the active document.
 *
 * The threads live with their document's session (document/session.ts);
 * this store mirrors the active session's set for the popovers, the review
 * panel, the status bar and the share sync. Its id is set only by the session
 * layer, together with the threads, so there is never a moment with the next
 * document's id and the previous document's threads (#1145). Writes to
 * IndexedDB go through the session layer's `persistRecords`, which keeps the
 * owning session's records in step.
 */

import { create } from 'zustand'
import type { CommentData } from './types'
import { persistRecords, deleteRecords } from '../../document/session'

interface CommentPersistenceState {
  /** The document whose threads are mirrored here */
  documentId: string | null

  /**
   * Comments for the current document — the single source of truth for rich
   * comment data (replies + resolved state) that the editor marks don't carry.
   * The editor marks are just anchors.
   */
  pendingComments: CommentData[]

  /** Persist a thread list under a document id (both from one synchronous read). */
  saveComments: (documentId: string, comments: CommentData[]) => Promise<void>

  /** Delete a document's stored threads */
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

export const useCommentStore = create<CommentPersistenceState>(() => ({
  documentId: null,
  pendingComments: [],

  saveComments: async (documentId: string, comments: CommentData[]) => {
    if (!documentId) {
      console.warn('[CommentStore] No documentId provided, skipping save')
      return
    }
    await persistRecords('comments', documentId, comments)
  },

  deleteComments: async (documentId: string) => {
    await deleteRecords('comments', documentId)
  }
}))
