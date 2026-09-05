/**
 * Comment mark types for AI-assisted editing
 */

export interface CommentMark {
  id: string
  comment: string
  createdAt: number
}

/** A single reply within a comment thread. */
export interface CommentReply {
  id: string
  /** 'user' for human replies, 'ai' for AI-generated replies. */
  author: 'user' | 'ai'
  text: string
  createdAt: number
  /**
   * Display name for replies from share-link reviewers (#768/#769). Missing →
   * the reply came from this desktop (the author) or the AI.
   */
  authorName?: string
}

export interface CommentData {
  id: string
  markedText: string
  comment: string
  createdAt: number
  /**
   * Who authored the top-level comment. 'user' for human-created comments (the
   * UI path), 'ai' for comments the model leaves via `add_comment`. Missing in
   * older data → treated as 'user'.
   */
  author?: 'user' | 'ai'
  /** 0-based index of which occurrence of markedText this comment anchors to. Missing in older data → treated as 0. */
  occurrenceIndex?: number
  from: number
  to: number
  /** Ordered list of replies in the thread. Missing in older data → treated as []. */
  replies?: CommentReply[]
  /**
   * True when the comment has been resolved. Resolved threads persist in the
   * store (collapsed) rather than being deleted. Missing in older data → treated
   * as false (active thread).
   */
  resolved?: boolean
  /**
   * Publication this comment arrived from (#769 share sync). Missing → the
   * comment was created locally on this desktop.
   */
  shareId?: string
  /**
   * True when restore could not find markedText in the document (the anchored
   * text was edited away). The thread is kept and surfaced as "anchor lost"
   * instead of being dropped (#769). Missing → anchored normally.
   */
  anchorLost?: boolean
  /**
   * Artifact revision (content hash) this comment was anchored against at
   * publish time (#768). Missing → created locally, never published.
   */
  publishRev?: string
}

export interface CommentOptions {
  HTMLAttributes?: Record<string, unknown>
  onCommentAdded?: (comment: CommentData) => void
  onCommentRemoved?: (id: string) => void
  onCommentResolved?: (id: string) => void
  onCommentReplied?: (id: string, reply: CommentReply) => void
  /**
   * Fired when setComment refuses to add a comment because the target range
   * fully covers one or more existing comment marks (which setMark would
   * silently replace, orphaning their threads — #830). Receives the ids of the
   * threads that blocked the add.
   */
  onCommentBlocked?: (existingIds: string[]) => void
}
