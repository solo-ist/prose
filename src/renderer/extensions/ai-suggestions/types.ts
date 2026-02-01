/**
 * AI Suggestion mark types
 */

export type SuggestionType = 'edit' | 'insertion'

export interface AISuggestionMark {
  id: string
  type: SuggestionType
  originalText: string
  suggestedText: string
  explanation: string
  createdAt: number
  userReply?: string
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
}

export interface AISuggestionOptions {
  HTMLAttributes?: Record<string, unknown>
  onSuggestionAdded?: (suggestion: AISuggestionData) => void
  onSuggestionAccepted?: (id: string) => void
  onSuggestionRejected?: (id: string) => void
}
