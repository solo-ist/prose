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
import type { ToolMode } from '../../shared/tools/types'

export type { ToolMode }

interface ChatState {
  // Conversation management
  conversations: ChatConversation[]
  activeConversationId: string | null

  // Current conversation state
  messages: ChatMessage[]
  isLoading: boolean
  isPanelOpen: boolean
  context: string | null
  agentMode: boolean // Legacy - kept for backwards compatibility
  toolMode: ToolMode // New mode system
  // Tracks the toolMode active at the last successful user message send,
  // so we can detect mid-conversation mode switches and note them in the
  // next system prompt. Idempotent across multiple toggles between sends —
  // only the difference at send time matters. In-memory only (matches
  // toolMode itself).
  lastSentToolMode: ToolMode | null

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
  removeMessage: (id: string) => void
  clearMessages: () => void

  // UI actions
  setLoading: (isLoading: boolean) => void
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  setContext: (context: string | null) => void
  setToolMode: (mode: ToolMode) => void
  cycleToolMode: () => void
  setLastSentToolMode: (mode: ToolMode | null) => void
  /**
   * Record an action taken on a tool result. Persists with the
   * conversation so reopening the chat shows the truthful state
   * (e.g., "Dismissed." or "Switched to Editor Mode.") instead of
   * re-clickable buttons for decisions already made.
   */
  setToolCallAction: (messageId: string, toolPartIdx: number, action: 'switched' | 'dismissed') => void

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
    isPanelOpen: false,
    context: null,
    // Editor is the default — safe-by-default posture: agent proposes copy
    // edits and editorial notes but never authors prose into the document.
    // Users opt into Create Mode via the StatusBar dropdown or Shift+Tab
    // (cycleToolMode walks chat → editor → create → chat). agentMode is a
    // legacy boolean kept in sync with toolMode === 'create' for the few
    // remaining readers — currently ChatMessage.tsx's legacy <edit>-block
    // auto-apply path (`agentMode=true` auto-applies; `agentMode=false`
    // renders edit blocks as reviewable diffs).
    agentMode: false,
    toolMode: 'editor',
    lastSentToolMode: null,
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

    removeMessage: (id) =>
      set((state) => {
        const newMessages = state.messages.filter((msg) => msg.id !== id)

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

    setToolMode: (mode) => set({
      toolMode: mode,
      // Legacy agentMode is "true" only in Create Mode — the only mode
      // where the agent can author prose directly.
      agentMode: mode === 'create'
    }),

    // Cycle through all three modes: chat → editor → create → chat.
    // Used by the Shift+Tab keyboard shortcut so Editor Mode (the new
    // safe-by-default mode) is reachable via keyboard, not just the
    // StatusBar dropdown. Delegates to setToolMode so agentMode stays
    // in sync.
    cycleToolMode: () => {
      const current = get().toolMode
      const next: ToolMode = current === 'chat' ? 'editor' : current === 'editor' ? 'create' : 'chat'
      get().setToolMode(next)
    },

    setLastSentToolMode: (mode) => set({ lastSentToolMode: mode }),

    setToolCallAction: (messageId, toolPartIdx, action) =>
      set((state) => {
        const updateOne = (msg: ChatMessage): ChatMessage =>
          msg.id === messageId
            ? { ...msg, toolActions: { ...(msg.toolActions ?? {}), [toolPartIdx]: action } }
            : msg
        const newMessages = state.messages.map(updateOne)

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

// Persist toolMode globally whenever it changes.
// Uses a lazy dynamic import to avoid a static circular dependency between
// chatStore and settingsStore (settingsStore already lazy-imports chatStore
// inside loadSettings()). The subscription fires after the store is
// initialized so the import always resolves before the callback runs.
// The guard (toolMode !== settings.toolMode) prevents a redundant write when
// settingsStore.loadSettings() hydrates chatStore on boot — the value is
// already persisted and does not need to be written back.
useChatStore.subscribe(
  (state) => state.toolMode,
  (toolMode) => {
    import('./settingsStore').then(({ useSettingsStore }) => {
      const current = useSettingsStore.getState().settings.toolMode
      if (current !== toolMode) {
        useSettingsStore.getState().setPersistedToolMode(toolMode)
      }
    }).catch(() => { /* non-fatal */ })
  }
)
