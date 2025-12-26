import { create } from 'zustand'
import type { ChatMessage } from '../types'

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  isPanelOpen: boolean
  context: string | null
  includeDocument: boolean
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  clearMessages: () => void
  setLoading: (isLoading: boolean) => void
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  setContext: (context: string | null) => void
  setIncludeDocument: (include: boolean) => void
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function createMessageId(): string {
  return generateId()
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  isPanelOpen: true,
  context: null,
  includeDocument: false,

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message]
    })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      )
    })),

  clearMessages: () => set({ messages: [] }),

  setLoading: (isLoading) => set({ isLoading }),

  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

  setPanelOpen: (open) => set({ isPanelOpen: open }),

  setContext: (context) => set({ context }),

  setIncludeDocument: (include) => set({ includeDocument: include })
}))
