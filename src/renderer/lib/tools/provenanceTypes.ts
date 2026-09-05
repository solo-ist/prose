/**
 * Shared provenance type for AI-generated content tracking.
 * Extracted here to break the circular-import between file.ts and index.ts.
 */

/** Provenance context for AI-generated content tracking */
export interface ToolProvenance {
  model: string
  conversationId: string
  messageId: string
  documentId: string
}
