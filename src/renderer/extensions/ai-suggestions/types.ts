/**
 * AI Suggestion mark types
 */

import type { Actor } from '../../../shared/review/actor'

export type SuggestionType = 'edit' | 'insertion'

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
  /** Who proposed it (#1232); read through `actorOfProvenance(provenanceModel, actor)`. */
  actor?: Actor | null
  documentId?: string
  /**
   * Raw markdown of a block-type conversion (#673) — present when the
   * suggestion's content opened with block markup differing from the host
   * node (e.g. `# Title` on a paragraph). The accept path parses this and
   * replaces the whole host node, converting its type. Null/absent = plain
   * text replacement.
   */
  blockConversionIntent?: string | null
}

export interface AISuggestionOptions {
  HTMLAttributes?: Record<string, unknown>
  onSuggestionAdded?: (suggestion: AISuggestionData) => void
  onSuggestionAccepted?: (id: string) => void
  onSuggestionRejected?: (id: string) => void
}
