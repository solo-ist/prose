/**
 * Types for the Suggested Edit mark extension.
 *
 * Mark-based suggestions track through document changes automatically,
 * unlike position-based approaches that require manual position mapping.
 */

import type { Command } from '@tiptap/core'

export interface SuggestedEditAttributes {
  /** Unique identifier for this suggestion */
  id: string
  /** The replacement text to use if accepted */
  suggestedText: string
  /** Optional explanation from the LLM */
  comment: string
  /** AI model that generated this suggestion */
  provenanceModel: string
  /** Conversation ID for provenance tracking */
  provenanceConversationId: string
  /** Message ID for provenance tracking */
  provenanceMessageId: string
  /** Document ID for annotation creation */
  documentId: string
}

export interface SuggestedEditMeta {
  id: string
  originalText: string
  suggestedText: string
  comment?: string
  accepted: boolean
}

export interface SuggestedEditOptions {
  HTMLAttributes: Record<string, unknown>
  /** CSS class name for the mark */
  className?: string
  /** Callback when a suggestion is accepted */
  onAccept?: (meta: SuggestedEditMeta) => void
  /** Callback when a suggestion is rejected */
  onReject?: (meta: SuggestedEditMeta) => void
  /** Custom accept handler */
  handleAccept?: Command
  /** Custom reject handler */
  handleReject?: Command
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    suggestedEdit: {
      /**
       * Set a suggested edit mark on the current selection.
       */
      setSuggestedEdit: (attributes: Partial<SuggestedEditAttributes>) => ReturnType
      /**
       * Remove the suggested edit mark from the current selection.
       */
      unsetSuggestedEdit: () => ReturnType
      /**
       * Accept the suggested edit at the current selection or by ID.
       * Replaces the marked text with the suggested text.
       */
      acceptSuggestedEdit: (id?: string) => ReturnType
      /**
       * Reject the suggested edit at the current selection or by ID.
       * Removes the mark and keeps the original text.
       */
      rejectSuggestedEdit: (id?: string) => ReturnType
      /**
       * Accept all suggested edits in the document.
       */
      acceptAllSuggestedEdits: () => ReturnType
      /**
       * Reject all suggested edits in the document.
       */
      rejectAllSuggestedEdits: () => ReturnType
    }
  }
}
