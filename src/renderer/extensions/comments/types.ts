/**
 * Comment mark types for AI-assisted editing
 */

export interface CommentMark {
  id: string
  comment: string
  createdAt: number
}

export interface CommentData {
  id: string
  markedText: string
  comment: string
  createdAt: number
  /** 0-based index of which occurrence of markedText this comment anchors to. Missing in older data → treated as 0. */
  occurrenceIndex?: number
  from: number
  to: number
}

export interface CommentOptions {
  HTMLAttributes?: Record<string, unknown>
  onCommentAdded?: (comment: CommentData) => void
  onCommentRemoved?: (id: string) => void
}
