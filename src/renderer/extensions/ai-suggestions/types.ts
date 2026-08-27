/**
 * AI Suggestion mark and lifecycle types.
 */

import type { ReviewActor } from '../review-events'

export type SuggestionType = 'edit' | 'insertion' | 'deletion'

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

export interface SuggestionFeedback {
  text: string
  createdAt: number
  actor: ReviewActor
}

export interface AISuggestionMark {
  id: string
  type: SuggestionType
  originalText: string
  suggestedText: string
  explanation: string
  createdAt: number
  userReply?: string
  insertionAnchorNodeId?: string
  insertionAnchorText?: string
  deletionNodeId?: string
  /** True for simple text changes captured from the local human editor. */
  humanInline?: boolean
}

export interface AISuggestionData {
  id: string
  type: SuggestionType
  originalText: string
  suggestedText: string
  explanation: string
  createdAt: number
  from: number
  to: number
  userReply?: string
  provenanceModel?: string
  provenanceConversationId?: string
  provenanceMessageId?: string
  documentId?: string
  /** Where the suggestion came from (kept on the active mark for restoration). */
  provenanceSource?: 'ui' | 'chat' | 'mcp' | 'unknown'
  /** MCP invocation identity, when the caller supplies one. */
  provenanceInvocationId?: string
  /** Anchor node ID for a pending block insertion. */
  insertionAnchorNodeId?: string
  /** Anchor text used to recover an insertion after node IDs are regenerated. */
  insertionAnchorText?: string
  /** Node ID whose complete block is proposed for deletion. */
  deletionNodeId?: string
  /** IDs of earlier suggestions this suggestion revises. */
  supersedes?: string[]
  /**
   * Simple local human text suggestions use inline accept/reject geometry rather
   * than the block insertion/deletion behaviour used by MCP tools.
   */
  humanInline?: boolean
  /**
   * Raw markdown of a block-type conversion (#673) — present when the
   * suggestion's content opened with block markup differing from the host
   * node (e.g. `# Title` on a paragraph). The accept path parses this and
   * replaces the whole host node, converting its type. Null/absent = plain
   * text replacement.
   */
  blockConversionIntent?: string | null
}

/**
 * Canonical persisted suggestion state. The TipTap mark is an active anchor;
 * this record remains after a decision and is the source for MCP history.
 */
export interface SuggestionRecord extends AISuggestionData {
  documentId: string
  status: SuggestionStatus
  feedback: SuggestionFeedback[]
  createdBy?: ReviewActor
  decisionActor?: ReviewActor
  decidedAt?: number
  supersededBy?: string[]
}

export interface AISuggestionOptions {
  HTMLAttributes?: Record<string, unknown>
  onSuggestionAdded?: (suggestion: AISuggestionData) => void
  onSuggestionFeedback?: (
    suggestion: AISuggestionData,
    feedback: SuggestionFeedback,
  ) => void
  onSuggestionAccepted?: (suggestion: AISuggestionData, actor: ReviewActor) => void
  onSuggestionRejected?: (suggestion: AISuggestionData, actor: ReviewActor) => void
}
