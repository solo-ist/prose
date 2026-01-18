import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ChatMessage } from '../types'
import {
  generateId,
  saveConversations,
  loadConversations,
  generateConversationTitle
} from '../lib/persistence'
import type { ChatConversation } from '../lib/persistence'

/**
 * Tool modes control which tools are available to the AI.
 * - suggestions: Read-only + suggest_edit (safe default)
 * - full: All tools available (direct edits)
 * - plan: Proposes changes, user must approve
 */
export type ToolMode = 'suggestions' | 'full' | 'plan'

interface ChatState {
  // Conversation management
  conversations: ChatConversation[]
  activeConversationId: string | null

  // Current conversation state
  messages: ChatMessage[]
  isLoading: boolean
  isPanelOpen: boolean
  context: string | null
  includeDocument: boolean
  agentMode: boolean // Legacy - kept for backwards compatibility
  toolMode: ToolMode // New mode system

  // Initialization state - prevents race conditions during app startup
  isInitializing: boolean

  // Streaming state
  isStreaming: boolean
  currentStreamId: string | null
  streamingMessageId: string | null

  // Conversation actions
  setConversations: (conversations: ChatConversation[]) => void
  addConversation: (documentId: string) => string
  selectConversation: (conversationId: string | null) => void
  deleteConversation: (conversationId: string) => void

  // Message actions
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  clearMessages: () => void

  // UI actions
  setLoading: (isLoading: boolean) => void
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  setContext: (context: string | null) => void
  setIncludeDocument: (include: boolean) => void
  setAgentMode: (enabled: boolean) => void
  setToolMode: (mode: ToolMode) => void

  // Streaming actions
  startStreaming: (messageId: string, streamId: string) => void
  appendStreamChunk: (delta: string) => void
  completeStreaming: () => void

  // Initialization actions
  setInitializing: (isInitializing: boolean) => void

  // Persistence actions
  loadForDocument: (documentId: string) => Promise<void>
  saveCurrentConversation: (documentId: string) => Promise<void>
}

export function createMessageId(): string {
  return generateId()
}

export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => ({
    conversations: [],
    activeConversationId: null,
    messages: [],
    isLoading: false,
    isPanelOpen: true,
    context: null,
    includeDocument: true,
    agentMode: true, // Legacy - maps to toolMode
    toolMode: 'full', // Default to full for backwards compatibility with agentMode: true
    isInitializing: true, // Start as true, will be set to false after app init
    isStreaming: false,
    currentStreamId: null,
    streamingMessageId: null,

    setConversations: (conversations) => set({ conversations }),

    addConversation: (documentId) => {
      const newConversation: ChatConversation = {
        id: generateId(),
        documentId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
        activeConversationId: newConversation.id,
        messages: []
      }))
      return newConversation.id
    },

    selectConversation: (conversationId) => {
      const state = get()
      if (conversationId === null) {
        set({ activeConversationId: null, messages: [] })
        return
      }
      const conversation = state.conversations.find(
        (c) => c.id === conversationId
      )
      if (conversation) {
        set({
          activeConversationId: conversationId,
          messages: conversation.messages
        })
      }
    },

    deleteConversation: (conversationId) => {
      set((state) => {
        const newConversations = state.conversations.filter(
          (c) => c.id !== conversationId
        )
        const isActive = state.activeConversationId === conversationId
        return {
          conversations: newConversations,
          activeConversationId: isActive
            ? newConversations[0]?.id ?? null
            : state.activeConversationId,
          messages: isActive ? newConversations[0]?.messages ?? [] : state.messages
        }
      })
    },

    addMessage: (message) =>
      set((state) => {
        const newMessages = [...state.messages, message]

        // Update the active conversation with new messages
        if (state.activeConversationId) {
          const updatedConversations = state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? {
                  ...c,
                  messages: newMessages,
                  updatedAt: Date.now(),
                  title: c.title ?? generateConversationTitle(newMessages)
                }
              : c
          )
          return { messages: newMessages, conversations: updatedConversations }
        }
        return { messages: newMessages }
      }),

    updateMessage: (id, updates) =>
      set((state) => {
        const newMessages = state.messages.map((msg) =>
          msg.id === id ? { ...msg, ...updates } : msg
        )

        // Update the active conversation
        if (state.activeConversationId) {
          const updatedConversations = state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? { ...c, messages: newMessages, updatedAt: Date.now() }
              : c
          )
          return { messages: newMessages, conversations: updatedConversations }
        }
        return { messages: newMessages }
      }),

    clearMessages: () =>
      set((state) => {
        // Update active conversation to have empty messages
        if (state.activeConversationId) {
          const updatedConversations = state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? { ...c, messages: [], updatedAt: Date.now() }
              : c
          )
          return { messages: [], conversations: updatedConversations }
        }
        return { messages: [] }
      }),

    setLoading: (isLoading) => set({ isLoading }),

    togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

    setPanelOpen: (open) => set({ isPanelOpen: open }),

    setContext: (context) => set({ context }),

    setIncludeDocument: (include) => set({ includeDocument: include }),

    setAgentMode: (enabled) => set({
      agentMode: enabled,
      // Sync toolMode with agentMode for backwards compatibility
      toolMode: enabled ? 'full' : 'suggestions'
    }),

    setToolMode: (mode) => set({
      toolMode: mode,
      // Sync agentMode with toolMode for backwards compatibility
      agentMode: mode === 'full'
    }),

    // Streaming actions
    startStreaming: (messageId, streamId) =>
      set({
        isStreaming: true,
        currentStreamId: streamId,
        streamingMessageId: messageId
      }),

    appendStreamChunk: (delta) =>
      set((state) => {
        if (!state.streamingMessageId) return state

        const newMessages = state.messages.map((msg) =>
          msg.id === state.streamingMessageId
            ? { ...msg, content: msg.content + delta }
            : msg
        )

        // Also update the active conversation
        if (state.activeConversationId) {
          const updatedConversations = state.conversations.map((c) =>
            c.id === state.activeConversationId
              ? { ...c, messages: newMessages, updatedAt: Date.now() }
              : c
          )
          return { messages: newMessages, conversations: updatedConversations }
        }

        return { messages: newMessages }
      }),

    completeStreaming: () =>
      set({
        isStreaming: false,
        currentStreamId: null,
        streamingMessageId: null,
        isLoading: false
      }),

    setInitializing: (isInitializing) => set({ isInitializing }),

    loadForDocument: async (documentId) => {
      const conversations = await loadConversations(documentId)
      const mostRecent = conversations[0] ?? null
      set({
        conversations,
        activeConversationId: mostRecent?.id ?? null,
        messages: mostRecent?.messages ?? [],
        context: null // Clear context when switching documents
      })
    },

    saveCurrentConversation: async (documentId) => {
      const state = get()
      if (state.conversations.length > 0) {
        await saveConversations(documentId, state.conversations)
      }
    }
  }))
)

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T {
  let timeoutId: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T
}

// Auto-save conversations when they change (debounced)
let currentDocumentId: string | null = null

export function setCurrentDocumentId(documentId: string | null) {
  currentDocumentId = documentId
}

const debouncedSave = debounce(async () => {
  if (currentDocumentId) {
    const state = useChatStore.getState()
    if (state.conversations.length > 0) {
      await saveConversations(currentDocumentId, state.conversations)
    }
  }
}, 1000)

useChatStore.subscribe(
  (state) => state.conversations,
  () => {
    debouncedSave()
  }
)
