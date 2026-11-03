/**
 * AI suggestion persistence facade.
 *
 * Suggestions live as marks in their document's session state; they are
 * restored when a session opens and persisted from the marks by the session
 * layer's projection (document/session.ts). This store keeps only the active
 * document's id, set by the session layer, and the two writers the panels
 * and tools call, which route through `persistRecords` (#1145).
 */

import { create } from 'zustand'
import type { AISuggestionData } from './types'
import { persistRecords, deleteRecords } from '../../document/session'

interface SuggestionPersistenceState {
  /** The document the active session holds */
  documentId: string | null

  /** Persist a suggestion list under a document id (both from one synchronous read). */
  saveSuggestions: (documentId: string, suggestions: AISuggestionData[]) => Promise<void>

  /** Delete a document's stored suggestions */
  deleteSuggestions: (documentId: string) => Promise<void>
}

export const useSuggestionStore = create<SuggestionPersistenceState>(() => ({
  documentId: null,

  saveSuggestions: async (documentId: string, suggestions: AISuggestionData[]) => {
    if (!documentId) {
      console.warn('[SuggestionStore] No documentId provided, skipping save')
      return
    }
    await persistRecords('suggestions', documentId, suggestions)
  },

  deleteSuggestions: async (documentId: string) => {
    await deleteRecords('suggestions', documentId)
  }
}))
