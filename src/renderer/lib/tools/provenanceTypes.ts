/**
 * Shared provenance type for AI-generated content tracking.
 * Extracted here to break the circular-import between file.ts and index.ts.
 */

import type { Actor } from '../../../shared/review/actor'
import type { AIProvenance } from '../../types/annotations'

/** Provenance context for AI-generated content tracking */
export interface ToolProvenance {
  model: string
  conversationId: string
  messageId: string
  documentId: string
  /**
   * Who is calling (#1232): the in-app chat stamps a Prose Agent, the MCP
   * bridge an MCP agent. Never taken from tool arguments.
   */
  actor?: Actor
}

/** The annotation provenance for an edit a tool call made: the call's model, conversation, message and actor. */
export function annotationProvenance(provenance: ToolProvenance): AIProvenance {
  return {
    model: provenance.model,
    conversationId: provenance.conversationId,
    messageId: provenance.messageId,
    ...(provenance.actor ? { actor: provenance.actor } : {}),
  }
}
