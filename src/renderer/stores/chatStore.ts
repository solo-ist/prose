/**
 * Chat store: the active document's conversations, the one `messages` slot
 * the panel renders, and the live turns (#1148).
 *
 * A turn belongs to its conversation, which belongs to one document. The
 * store keeps every live turn in `turns` (by conversation id, each with its
 * stream, its streaming message and its `ToolBinding`), and keeps the
 * conversations of documents that have a live turn but are not shown in
 * `parked` (by document id), so a stream that started on A keeps appending
 * to A's conversation after the user switches to B, and A's panel shows the
 * finished turn when A is active again. The streaming flags the panel reads
 * (`isStreaming`, `currentStreamId`, `streamingMessageId`, `isLoading`) are
 * the ACTIVE conversation's, recomputed whenever the turns or the active
 * conversation change. Every write that names a stream or a conversation is
 * routed: into `conversations` / `messages` when that conversation is in
 * the active list, into its parked list otherwise (saved under its own
 * document id).
 */

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
import type { ToolBinding } from '../document/handle'

export type { ToolMode }

export interface TurnState {
  streamId: string
  messageId: string
  binding: ToolBinding
  /** The document was discarded mid-turn: the turn finishes, nothing is written. */
  orphaned?: boolean
}

interface ChatState {
  // Conversation management
  conversations: ChatConversation[]
  /** The document `conversations` belongs to (what they are saved under). */
  conversationsDocumentId: string | null
  activeConversationId: string | null

  // Current conversation state
  messages: ChatMessage[]
  isLoading: boolean
  isPanelOpen: boolean
  context: string | null
  toolMode: ToolMode // New mode system
  // Tracks the toolMode active at the last successful user message send,
  // so we can detect mid-conversation mode switches and note them in the
  // next system prompt. Idempotent across multiple toggles between sends —
  // only the difference at send time matters. In-memory only (matches
  // toolMode itself).
  lastSentToolMode: ToolMode | null

  // Initialization state - prevents race conditions during app startup
  isInitializing: boolean

  // Streaming state (the active conversation's, derived from `turns`)
  isStreaming: boolean
  currentStreamId: string | null
  streamingMessageId: string | null
  /** Live turns by conversation id (#1148). */
  turns: Record<string, TurnState>
  /** Conversations of documents with a live turn that are not shown, by document id (#1148). */
  parked: Record<string, ChatConversation[]>

  // Conversation actions
  setConversations: (conversations: ChatConversation[]) => void
  addConversation: (documentId: string) => string
  selectConversation: (conversationId: string | null) => void
  deleteConversation: (conversationId: string) => void

  // Message actions (the active conversation)
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  removeMessage: (id: string) => void
  clearMessages: () => void

  // Routed message actions (#1148): the named conversation, shown or parked
  addMessageTo: (conversationId: string, message: ChatMessage) => void
  updateMessageIn: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void
  messageOf: (conversationId: string, messageId: string) => ChatMessage | undefined
  turnFor: (streamId: string) => { conversationId: string; turn: TurnState } | null

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
  /** Start (or continue) the turn of `conversationId` (the active one when omitted). */
  startStreaming: (messageId: string, streamId: string, binding?: ToolBinding, conversationId?: string) => void
  /** Append to the streaming message of the turn that owns `streamId`; an unknown stream is dropped. */
  appendStreamChunk: (delta: string, streamId: string) => void
  /** End the turn of `conversationId` (the active one when omitted). */
  completeStreaming: (conversationId?: string) => void

  // Documents (#1148)
  /** A conversation follows the document a tab-changing tool put in front of the user. */
  moveConversation: (conversationId: string, documentId: string) => void
  /** A rename: the document id under which conversations are kept and saved. */
  rekeyDocument: (oldDocumentId: string, newDocumentId: string) => void
  /** A discarded untitled document: its parked conversations go, its turns finish silently. */
  discardDocument: (documentId: string) => void
  /** A brand-new untitled document arrived: nothing to load. */
  resetForNewDocument: (documentId: string) => void

  // Extended thinking toggle — controls whether the model is asked to use
  // adaptive thinking. Only Opus 4.7+ and Fable 5 honour the param; the
  // main-process handler capability-gates by model ID automatically.
  thinkingEnabled: boolean
  setThinkingEnabled: (enabled: boolean) => void

  // Initialization actions
  setInitializing: (isInitializing: boolean) => void

  // Persistence actions
  loadForDocument: (documentId: string) => Promise<void>
  saveCurrentConversation: (documentId: string) => Promise<void>
}

export function createMessageId(): string {
  return generateId()
}

/** The streaming flags the panel reads: the active conversation's turn. */
function flagsOf(
  turns: Record<string, TurnState>,
  activeConversationId: string | null
): Pick<ChatState, 'isStreaming' | 'currentStreamId' | 'streamingMessageId' | 'isLoading'> {
  const turn = activeConversationId ? turns[activeConversationId] : undefined
  return {
    isStreaming: !!turn,
    currentStreamId: turn?.streamId ?? null,
    streamingMessageId: turn?.messageId ?? null,
    isLoading: !!turn
  }
}

function withMessages(c: ChatConversation, messages: ChatMessage[]): ChatConversation {
  return { ...c, messages, updatedAt: Date.now(), title: c.title ?? generateConversationTitle(messages) }
}

/** Where a conversation lives: the shown list or a parked document's list. */
function locate(
  state: ChatState,
  conversationId: string
): { where: 'active' } | { where: 'parked'; documentId: string } | null {
  if (state.conversations.some((c) => c.id === conversationId)) return { where: 'active' }
  for (const [documentId, list] of Object.entries(state.parked)) {
    if (list.some((c) => c.id === conversationId)) return { where: 'parked', documentId }
  }
  return null
}

export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => {
    /** Change one conversation's messages wherever it lives; a parked change is saved under its document. */
    const patchConversation = (
      conversationId: string,
      fn: (messages: ChatMessage[]) => ChatMessage[]
    ): void => {
      const state = get()
      const at = locate(state, conversationId)
      if (!at) return
      if (at.where === 'active') {
        const conversations = state.conversations.map((c) => (c.id === conversationId ? withMessages(c, fn(c.messages)) : c))
        const active = conversations.find((c) => c.id === state.activeConversationId)
        set({
          conversations,
          messages: state.activeConversationId === conversationId && active ? active.messages : state.messages
        })
        return
      }
      const list = state.parked[at.documentId].map((c) => (c.id === conversationId ? withMessages(c, fn(c.messages)) : c))
      set({ parked: { ...state.parked, [at.documentId]: list } })
      scheduleParkedSave(at.documentId)
    }

    return {
      conversations: [],
      conversationsDocumentId: null,
      activeConversationId: null,
      messages: [],
      isLoading: false,
      isPanelOpen: false,
      context: null,
      // Editor is the default — safe-by-default posture: agent proposes copy
      // edits and editorial notes but never authors prose into the document.
      // Users opt into Create Mode via the StatusBar dropdown or Shift+Tab
      // (cycleToolMode walks chat → editor → create → chat).
      toolMode: 'editor',
      lastSentToolMode: null,
      isInitializing: true, // Start as true, will be set to false after app init
      isStreaming: false,
      currentStreamId: null,
      streamingMessageId: null,
      turns: {},
      parked: {},
      thinkingEnabled: true,

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
          conversationsDocumentId: state.conversationsDocumentId ?? documentId,
          activeConversationId: newConversation.id,
          messages: [],
          ...flagsOf(state.turns, newConversation.id)
        }))
        return newConversation.id
      },

      selectConversation: (conversationId) => {
        const state = get()
        if (conversationId === null) {
          set({ activeConversationId: null, messages: [], ...flagsOf(state.turns, null) })
          return
        }
        const conversation = state.conversations.find((c) => c.id === conversationId)
        if (conversation) {
          set({
            activeConversationId: conversationId,
            messages: conversation.messages,
            ...flagsOf(state.turns, conversationId)
          })
        }
      },

      deleteConversation: (conversationId) => {
        set((state) => {
          const newConversations = state.conversations.filter((c) => c.id !== conversationId)
          const isActive = state.activeConversationId === conversationId
          const activeConversationId = isActive ? (newConversations[0]?.id ?? null) : state.activeConversationId
          return {
            conversations: newConversations,
            activeConversationId,
            messages: isActive ? (newConversations[0]?.messages ?? []) : state.messages,
            ...flagsOf(state.turns, activeConversationId)
          }
        })
      },

      addMessage: (message) =>
        set((state) => {
          const newMessages = [...state.messages, message]
          if (state.activeConversationId) {
            const updatedConversations = state.conversations.map((c) =>
              c.id === state.activeConversationId ? withMessages(c, newMessages) : c
            )
            return { messages: newMessages, conversations: updatedConversations }
          }
          return { messages: newMessages }
        }),

      updateMessage: (id, updates) =>
        set((state) => {
          const newMessages = state.messages.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
          if (state.activeConversationId) {
            const updatedConversations = state.conversations.map((c) =>
              c.id === state.activeConversationId ? { ...c, messages: newMessages, updatedAt: Date.now() } : c
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
              c.id === state.activeConversationId ? { ...c, messages: newMessages, updatedAt: Date.now() } : c
            )
            return { messages: newMessages, conversations: updatedConversations }
          }
          return { messages: newMessages }
        }),

      clearMessages: () =>
        set((state) => {
          if (state.activeConversationId) {
            const updatedConversations = state.conversations.map((c) =>
              c.id === state.activeConversationId ? { ...c, messages: [], updatedAt: Date.now() } : c
            )
            return { messages: [], conversations: updatedConversations }
          }
          return { messages: [] }
        }),

      addMessageTo: (conversationId, message) => patchConversation(conversationId, (messages) => [...messages, message]),

      updateMessageIn: (conversationId, messageId, updates) =>
        patchConversation(conversationId, (messages) =>
          messages.map((msg) => (msg.id === messageId ? { ...msg, ...updates } : msg))
        ),

      messageOf: (conversationId, messageId) => {
        const state = get()
        const at = locate(state, conversationId)
        if (!at) return undefined
        const list = at.where === 'active' ? state.conversations : state.parked[at.documentId]
        return list.find((c) => c.id === conversationId)?.messages.find((m) => m.id === messageId)
      },

      turnFor: (streamId) => {
        for (const [conversationId, turn] of Object.entries(get().turns)) {
          if (turn.streamId === streamId) return { conversationId, turn }
        }
        return null
      },

      setLoading: (isLoading) => set({ isLoading }),

      togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

      setPanelOpen: (open) => set({ isPanelOpen: open }),

      setContext: (context) => set({ context }),

      setToolMode: (mode) => set({ toolMode: mode }),

      // Cycle through all three modes: chat → editor → create → chat.
      // Used by the Shift+Tab keyboard shortcut so Editor Mode (the new
      // safe-by-default mode) is reachable via keyboard, not just the
      // StatusBar dropdown.
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
              c.id === state.activeConversationId ? { ...c, messages: newMessages, updatedAt: Date.now() } : c
            )
            return { messages: newMessages, conversations: updatedConversations }
          }
          return { messages: newMessages }
        }),

      // Streaming actions
      startStreaming: (messageId, streamId, binding, conversationId) =>
        set((state) => {
          const id = conversationId ?? state.activeConversationId
          if (!id) return state
          const previous = state.turns[id]
          const bound = binding ?? previous?.binding
          if (!bound) return state
          const turns = { ...state.turns, [id]: { streamId, messageId, binding: bound, orphaned: previous?.orphaned } }
          return { turns, ...flagsOf(turns, state.activeConversationId) }
        }),

      appendStreamChunk: (delta, streamId) => {
        const state = get()
        // Never the active conversation's stream by default: a chunk that
        // does not name its stream would land in whatever is shown, which is
        // the cross-tab failure this store exists to close (#1148).
        const found = streamId ? state.turnFor(streamId) : null
        if (!found) return
        patchConversation(found.conversationId, (messages) =>
          messages.map((msg) => (msg.id === found.turn.messageId ? { ...msg, content: msg.content + delta } : msg))
        )
      },

      completeStreaming: (conversationId) => {
        const state = get()
        const id = conversationId ?? state.activeConversationId
        const turns = { ...state.turns }
        if (id) delete turns[id]
        set({ turns, ...flagsOf(turns, state.activeConversationId) })
        if (id) {
          const at = locate(get(), id)
          if (at?.where === 'parked') scheduleParkedSave(at.documentId, 0)
        }
      },

      moveConversation: (conversationId, documentId) => {
        const state = get()
        const at = locate(state, conversationId)
        if (!at) return
        const fromList = at.where === 'active' ? state.conversations : state.parked[at.documentId]
        const conversation = fromList.find((c) => c.id === conversationId)
        if (!conversation || conversation.documentId === documentId) return
        const moved = { ...conversation, documentId }
        const parked = { ...state.parked }
        let conversations = state.conversations
        if (at.where === 'active') conversations = conversations.filter((c) => c.id !== conversationId)
        else parked[at.documentId] = parked[at.documentId].filter((c) => c.id !== conversationId)
        const turn = state.turns[conversationId]
        if (turn) turn.binding.documentId = documentId
        if (state.conversationsDocumentId === documentId) {
          conversations = [moved, ...conversations]
          set({
            conversations,
            parked,
            activeConversationId: conversationId,
            messages: moved.messages,
            ...flagsOf(state.turns, conversationId)
          })
        } else {
          parked[documentId] = [moved, ...(parked[documentId] ?? [])]
          set({ conversations, parked, ...flagsOf(state.turns, state.activeConversationId) })
          scheduleParkedSave(documentId)
        }
        if (at.where === 'parked') scheduleParkedSave(at.documentId, 0)
      },

      rekeyDocument: (oldDocumentId, newDocumentId) => {
        const state = get()
        const parked = { ...state.parked }
        if (parked[oldDocumentId]) {
          parked[newDocumentId] = parked[oldDocumentId].map((c) => ({ ...c, documentId: newDocumentId }))
          delete parked[oldDocumentId]
        }
        for (const turn of Object.values(state.turns)) {
          if (turn.binding.documentId === oldDocumentId) turn.binding.documentId = newDocumentId
        }
        const active = state.conversationsDocumentId === oldDocumentId
        set({
          parked,
          conversations: active ? state.conversations.map((c) => ({ ...c, documentId: newDocumentId })) : state.conversations,
          conversationsDocumentId: active ? newDocumentId : state.conversationsDocumentId
        })
        if (parked[newDocumentId]) scheduleParkedSave(newDocumentId, 0)
      },

      discardDocument: (documentId) => {
        const state = get()
        const parked = { ...state.parked }
        delete parked[documentId]
        const turns = { ...state.turns }
        for (const [id, turn] of Object.entries(turns)) {
          if (turn.binding.documentId === documentId) turns[id] = { ...turn, orphaned: true }
        }
        set({ parked, turns })
      },

      resetForNewDocument: (documentId) => {
        void flushShownSave()
        parkLeaving(get())
        set((state) => ({
          conversations: [],
          conversationsDocumentId: documentId,
          activeConversationId: null,
          messages: [],
          context: null,
          ...flagsOf(state.turns, null)
        }))
      },

      setThinkingEnabled: (enabled) => set({ thinkingEnabled: enabled }),

      setInitializing: (isInitializing) => set({ isInitializing }),

      loadForDocument: async (documentId) => {
        // The leaving list's pending save lands under ITS document before the
        // list is replaced (the debounce must not fire on the next list).
        await flushShownSave()
        parkLeaving(get())
        const stored = await loadConversations(documentId)
        const state = get()
        // A parked list is newer than the stored one (a turn is writing it);
        // its conversations win, the stored others follow.
        const parkedList = state.parked[documentId]
        const parkedIds = new Set((parkedList ?? []).map((c) => c.id))
        const conversations = parkedList ? [...parkedList, ...stored.filter((c) => !parkedIds.has(c.id))] : stored
        const parked = { ...state.parked }
        delete parked[documentId]
        const mostRecent = conversations[0] ?? null
        set({
          conversations,
          conversationsDocumentId: documentId,
          parked,
          activeConversationId: mostRecent?.id ?? null,
          messages: mostRecent?.messages ?? [],
          context: null, // Clear context when switching documents
          ...flagsOf(state.turns, mostRecent?.id ?? null)
        })
      },

      saveCurrentConversation: async (documentId) => {
        const state = get()
        if (state.conversations.length > 0) {
          await saveConversations(documentId, state.conversations)
        }
      }
    }
  })
)

/**
 * The shown list leaves: when one of its conversations has a live turn the
 * list is parked under its document, so the turn keeps a place to write.
 */
function parkLeaving(state: ChatState): void {
  const documentId = state.conversationsDocumentId
  if (!documentId || state.conversations.length === 0) return
  const live = state.conversations.some((c) => state.turns[c.id])
  if (!live) return
  useChatStore.setState({ parked: { ...state.parked, [documentId]: state.conversations } })
}

/**
 * Save a parked document's conversations under its own id, merged over the
 * stored ones (a parked list may hold only the conversations that moved
 * there). Debounced per document; `delay` 0 writes at once.
 */
const parkedSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleParkedSave(documentId: string, delay = 1000): void {
  const pending = parkedSaveTimers.get(documentId)
  if (pending) clearTimeout(pending)
  const run = async (): Promise<void> => {
    parkedSaveTimers.delete(documentId)
    const list = useChatStore.getState().parked[documentId]
    if (!list || list.length === 0) return
    const stored = await loadConversations(documentId)
    const ids = new Set(list.map((c) => c.id))
    await saveConversations(documentId, [...list, ...stored.filter((c) => !ids.has(c.id))])
  }
  if (delay === 0) {
    void run()
    return
  }
  parkedSaveTimers.set(documentId, setTimeout(() => void run(), delay))
}

/** Test seam: the pending parked writes, settled. */
export async function flushParkedSaves(): Promise<void> {
  for (const [documentId, timer] of [...parkedSaveTimers]) {
    clearTimeout(timer)
    parkedSaveTimers.delete(documentId)
    const list = useChatStore.getState().parked[documentId]
    if (!list || list.length === 0) continue
    const stored = await loadConversations(documentId)
    const ids = new Set(list.map((c) => c.id))
    await saveConversations(documentId, [...list, ...stored.filter((c) => !ids.has(c.id))])
  }
}

// Auto-save the shown conversations when they change (debounced), under the
// document they belong to: the id travels with the list, so a save cannot
// land under another document's key, and a pending save is flushed before
// the list is replaced (#1148).
let shownSaveTimer: ReturnType<typeof setTimeout> | null = null

async function saveShown(): Promise<void> {
  const state = useChatStore.getState()
  if (state.conversationsDocumentId && state.conversations.length > 0) {
    await saveConversations(state.conversationsDocumentId, state.conversations)
  }
}

/** Land a pending debounced save of the shown list now. */
async function flushShownSave(): Promise<void> {
  if (!shownSaveTimer) return
  clearTimeout(shownSaveTimer)
  shownSaveTimer = null
  await saveShown()
}

useChatStore.subscribe(
  (state) => state.conversations,
  () => {
    if (shownSaveTimer) clearTimeout(shownSaveTimer)
    shownSaveTimer = setTimeout(() => {
      shownSaveTimer = null
      void saveShown()
    }, 1000)
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
