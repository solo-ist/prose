import { useCallback, useEffect } from 'react'
import { useChatStore, createMessageId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { validateConfig } from '../lib/llm'
import { buildSystemPrompt } from '../lib/prompts'
import { getApi } from '../lib/browserApi'

// Module-level flag to ensure stream listeners are only registered once globally
let streamListenersInitialized = false

export function useChat() {
  const {
    messages,
    isLoading,
    isPanelOpen,
    context,
    includeDocument,
    activeConversationId,
    isStreaming,
    currentStreamId,
    addConversation,
    addMessage,
    updateMessage,
    clearMessages,
    setLoading,
    togglePanel,
    setPanelOpen,
    setContext,
    setIncludeDocument,
    startStreaming,
    appendStreamChunk,
    completeStreaming
  } = useChatStore()

  const { settings } = useSettingsStore()
  const { document } = useEditorStore()

  // Set up stream event listeners (only once globally across all hook instances)
  useEffect(() => {
    if (streamListenersInitialized) return

    streamListenersInitialized = true
    const api = getApi()

    const unsubChunk = api.onLLMStreamChunk((chunk) => {
      const state = useChatStore.getState()
      if (chunk.streamId === state.currentStreamId) {
        state.appendStreamChunk(chunk.delta)
      }
    })

    const unsubComplete = api.onLLMStreamComplete((complete) => {
      const state = useChatStore.getState()
      if (complete.streamId === state.currentStreamId) {
        state.completeStreaming()
      }
    })

    const unsubError = api.onLLMStreamError((error) => {
      const state = useChatStore.getState()
      if (error.streamId === state.currentStreamId) {
        // Append error to the streaming message
        if (state.streamingMessageId) {
          const currentMsg = state.messages.find(
            (m) => m.id === state.streamingMessageId
          )
          state.updateMessage(state.streamingMessageId, {
            content: (currentMsg?.content || '') + `\n\n*Error: ${error.error}*`
          })
        }
        state.completeStreaming()
      }
    })

    // No cleanup - listeners persist for app lifetime
    // This is intentional since we use module-level guard
    return () => {
      unsubChunk()
      unsubComplete()
      unsubError()
      streamListenersInitialized = false
    }
  }, [])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return

      // Get current state directly from stores to avoid stale closure issues
      // (e.g., when called immediately after file open before React re-renders)
      const currentDocumentId = useEditorStore.getState().document.documentId
      const currentActiveConversationId = useChatStore.getState().activeConversationId

      // Auto-create a conversation if there isn't one
      if (!currentActiveConversationId) {
        addConversation(currentDocumentId)
      }

      // Validate config first
      const configError = validateConfig(settings.llm)
      if (configError) {
        const errorMsgId = createMessageId()
        addMessage({
          id: errorMsgId,
          role: 'assistant',
          content: `${configError}. Please configure your API settings (Cmd+,).`,
          timestamp: new Date()
        })
        return
      }

      // Get context from store and clear it
      const messageContext = context
      setContext(null)

      // Build the user message with context if present
      let fullMessage = content
      if (messageContext) {
        fullMessage = `Regarding this text:\n\n> ${messageContext}\n\n${content}`
      }

      // Add user message
      const userMsgId = createMessageId()
      addMessage({
        id: userMsgId,
        role: 'user',
        content,
        context: messageContext || undefined,
        timestamp: new Date()
      })

      setLoading(true)

      // Build messages array for the API
      // Use current state to avoid stale closure issues with messages array
      const currentMessages = useChatStore.getState().messages
      const apiMessages = currentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.context
          ? `Regarding this text:\n\n> ${m.context}\n\n${m.content}`
          : m.content
      }))
      apiMessages.push({ role: 'user' as const, content: fullMessage })

      // Create assistant message placeholder for streaming
      const assistantMsgId = createMessageId()
      const streamId = createMessageId()

      addMessage({
        id: assistantMsgId,
        role: 'assistant',
        content: '', // Start empty, will be filled by stream chunks
        timestamp: new Date()
      })

      startStreaming(assistantMsgId, streamId)

      try {
        // Call streaming LLM (via Electron IPC or browser fallback)
        const api = getApi()
        // Use current document content from store to avoid stale closure
        const currentDocContent = useEditorStore.getState().document.content
        await api.llmChatStream({
          provider: settings.llm.provider,
          model: settings.llm.model,
          apiKey: settings.llm.apiKey,
          baseUrl: settings.llm.baseUrl,
          messages: apiMessages,
          system: buildSystemPrompt(includeDocument, currentDocContent),
          streamId
        })
      } catch (error) {
        console.error('[Chat] Error:', error)
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        // Update the assistant message with error
        updateMessage(assistantMsgId, {
          content: `Error: ${errorMessage}. Please check your API key in Settings (Cmd+,).`
        })
        completeStreaming()
      }
    },
    [
      context,
      isLoading,
      includeDocument,
      settings.llm,
      addConversation,
      addMessage,
      updateMessage,
      setLoading,
      setContext,
      startStreaming,
      completeStreaming
    ]
  )

  const stopGeneration = useCallback(() => {
    const state = useChatStore.getState()
    if (state.currentStreamId) {
      const api = getApi()
      api.llmAbortStream(state.currentStreamId)
    }
    completeStreaming()
  }, [completeStreaming])

  return {
    messages,
    isLoading,
    isStreaming,
    isPanelOpen,
    context,
    includeDocument,
    sendMessage,
    stopGeneration,
    updateMessage,
    clearMessages,
    togglePanel,
    setPanelOpen,
    setContext,
    setIncludeDocument
  }
}
