/**
 * Types for the Streaming Edit extension.
 *
 * This extension provides visual feedback during streaming edits,
 * showing original text struck through and new text appearing character-by-character.
 */

export interface StreamingEditAttributes {
  /** Unique identifier for this streaming edit */
  id: string
  /** The original text being replaced */
  originalText: string
  /** The current streamed replacement text (grows as chunks arrive) */
  streamedText: string
  /** Whether streaming is complete */
  isComplete: boolean
  /** AI model for provenance */
  provenanceModel?: string
  /** Conversation ID for provenance */
  provenanceConversationId?: string
  /** Message ID for provenance */
  provenanceMessageId?: string
  /** Document ID for annotation */
  documentId?: string
}

export interface StreamingEditOptions {
  HTMLAttributes: Record<string, unknown>
  /** CSS class name for the node */
  className?: string
  /** Callback when streaming completes */
  onComplete?: (id: string, finalText: string) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    streamingEdit: {
      /**
       * Insert a streaming edit placeholder at the current selection.
       */
      insertStreamingEdit: (attributes: Partial<StreamingEditAttributes>) => ReturnType
      /**
       * Update the streamed text for a streaming edit.
       */
      updateStreamingEdit: (id: string, text: string) => ReturnType
      /**
       * Complete a streaming edit, converting it to final text.
       */
      completeStreamingEdit: (id: string) => ReturnType
      /**
       * Cancel a streaming edit, restoring original text.
       */
      cancelStreamingEdit: (id: string) => ReturnType
    }
  }
}
