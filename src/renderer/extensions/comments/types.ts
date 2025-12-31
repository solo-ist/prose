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
  from: number
  to: number
}

export interface CommentOptions {
  HTMLAttributes?: Record<string, unknown>
  onCommentAdded?: (comment: CommentData) => void
  onCommentRemoved?: (id: string) => void
}
