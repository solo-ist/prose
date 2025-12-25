import { create } from 'zustand'
import type { ChatMessage } from '../types'

interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  isPanelOpen: boolean
  context: string | null
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  updateMessage: (id: string, content: string) => void
  clearMessages: () => void
  setLoading: (isLoading: boolean) => void
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  setContext: (context: string | null) => void
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  isPanelOpen: true,
  context: null,

  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: generateId(),
          timestamp: new Date()
        }
      ]
    })),

  updateMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, content } : msg
      )
    })),

  clearMessages: () => set({ messages: [] }),

  setLoading: (isLoading) => set({ isLoading }),

  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

  setPanelOpen: (open) => set({ isPanelOpen: open }),

  setContext: (context) => set({ context })
}))
