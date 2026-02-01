/**
 * AI Suggestion persistence store
 *
 * Manages saving/loading pending AI suggestions to IndexedDB,
 * allowing them to persist across tab switches.
 */

import { create } from 'zustand'
import type { AISuggestionData } from './types'
import {
  saveSuggestions as persistSuggestions,
  loadSuggestions as fetchSuggestions,
  deleteSuggestions as removeSuggestions
} from '../../lib/persistence'

interface SuggestionPersistenceState {
  /** Current document ID being tracked */
  documentId: string | null

  /** Pending suggestions for the current document (loaded from IndexedDB) */
  pendingSuggestions: AISuggestionData[]

  /** Set the current document ID and clear pending suggestions */
  setDocumentId: (documentId: string) => void

  /** Save current suggestions to IndexedDB */
  saveSuggestions: (suggestions: AISuggestionData[]) => Promise<void>

  /** Load suggestions from IndexedDB for a document */
  loadSuggestions: (documentId: string) => Promise<void>

  /** Clear pending suggestions from memory (not from IndexedDB) */
  clearSuggestions: () => void

  /** Delete suggestions from IndexedDB for a document */
  deleteSuggestions: (documentId: string) => Promise<void>
}

export const useSuggestionStore = create<SuggestionPersistenceState>((set, get) => ({
  documentId: null,
  pendingSuggestions: [],

  setDocumentId: (documentId: string) => {
    set({ documentId, pendingSuggestions: [] })
  },

  saveSuggestions: async (suggestions: AISuggestionData[]) => {
    const { documentId } = get()
    if (!documentId) {
      console.warn('[SuggestionStore] No documentId set, skipping save')
      return
    }

    console.log('[SuggestionStore] Saving suggestions:', {
      documentId,
      count: suggestions.length
    })

    await persistSuggestions(documentId, suggestions)
  },

  loadSuggestions: async (documentId: string) => {
    console.log('[SuggestionStore] Loading suggestions for:', documentId)

    const suggestions = await fetchSuggestions(documentId)

    set({
      documentId,
      pendingSuggestions: suggestions
    })

    console.log('[SuggestionStore] Loaded suggestions:', {
      documentId,
      count: suggestions.length
    })
  },

  clearSuggestions: () => {
    set({ pendingSuggestions: [] })
  },

  deleteSuggestions: async (documentId: string) => {
    await removeSuggestions(documentId)

    // Clear from memory if it's the current document
    const state = get()
    if (state.documentId === documentId) {
      set({ pendingSuggestions: [] })
    }
  }
}))
