import { create } from 'zustand'
import {
  loadSummary,
  saveSummary,
  simpleHash,
  type DocumentSummary
} from '../lib/persistence'
import { useSettingsStore } from './settingsStore'
import { getApi } from '../lib/browserApi'

interface SummaryState {
  summary: string | null
  isGenerating: boolean
  generatedAt: string | null
  isStale: boolean
  error: string | null

  loadForDocument: (documentId: string, content: string) => Promise<void>
  generateSummary: (documentId: string, content: string) => Promise<void>
  clearSummary: () => void
}

export const useSummaryStore = create<SummaryState>()((set, get) => ({
  summary: null,
  isGenerating: false,
  generatedAt: null,
  isStale: false,
  error: null,

  loadForDocument: async (documentId: string, content: string) => {
    const cached = await loadSummary(documentId)
    if (cached) {
      const currentHash = simpleHash(content)
      set({
        summary: cached.summary,
        generatedAt: cached.generatedAt,
        isStale: cached.contentHash !== currentHash,
        isGenerating: false,
        error: null
      })
    } else {
      set({
        summary: null,
        generatedAt: null,
        isStale: false,
        isGenerating: false,
        error: null
      })
    }
  },

  generateSummary: async (documentId: string, content: string) => {
    if (!content || content.trim().length === 0) return
    if (get().isGenerating) return

    const { settings } = useSettingsStore.getState()
    if (!settings.llm.apiKey) return

    set({ isGenerating: true, error: null })

    try {
      const api = getApi()
      const response = await api.llmChat({
        provider: settings.llm.provider,
        model: settings.llm.model,
        apiKey: settings.llm.apiKey,
        baseUrl: settings.llm.baseUrl,
        messages: [
          {
            role: 'user',
            content: 'Summarize this document in 1-3 concise sentences (under 200 characters total). State what it is and its main point. Be specific, accurate, and direct. No hedging or filler.'
          }
        ],
        system: content
      })

      const summaryData: DocumentSummary = {
        summary: response.content,
        generatedAt: new Date().toISOString(),
        contentHash: simpleHash(content)
      }

      await saveSummary(documentId, summaryData)

      set({
        summary: summaryData.summary,
        generatedAt: summaryData.generatedAt,
        isStale: false,
        isGenerating: false,
        error: null
      })
    } catch (error) {
      set({
        isGenerating: false,
        error: error instanceof Error ? error.message : 'Failed to generate summary'
      })
    }
  },

  clearSummary: () => {
    set({
      summary: null,
      isGenerating: false,
      generatedAt: null,
      isStale: false,
      error: null
    })
  }
}))
