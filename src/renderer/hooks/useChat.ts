import { useCallback, useEffect } from 'react'
import { useChatStore, createMessageId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { validateConfig } from '../lib/llm'
import { buildSystemPrompt, buildCommentsPrompt } from '../lib/prompts'
import { getApi } from '../lib/browserApi'
import { getComments } from '../extensions/comments'

// Module-level flag to ensure stream listeners are only registered once globally
let streamListenersInitialized = false

export function useChat() {
  const {
    messages,
    isLoading,
    isPanelOpen,
    context,
    includeDocument,
    agentMode,
    activeConversationId,
    isStreaming,
    isInitializing,
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
    setAgentMode,
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
    async (content: string, options?: { hidden?: boolean }) => {
      if (!content.trim() || isLoading) return

      // Auto-create a conversation if there isn't one
      if (!activeConversationId) {
        addConversation(document.documentId)
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
        timestamp: new Date(),
        hidden: options?.hidden
      })

      setLoading(true)

      // Build messages array for the API
      const apiMessages = messages.map((m) => ({
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
        await api.llmChatStream({
          provider: settings.llm.provider,
          model: settings.llm.model,
          apiKey: settings.llm.apiKey,
          baseUrl: settings.llm.baseUrl,
          messages: apiMessages,
          system: buildSystemPrompt(includeDocument, useEditorStore.getState().document.content),
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
      messages,
      includeDocument,
      document.documentId,
      settings.llm,
      activeConversationId,
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

  const processComments = useCallback(async () => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return

    const comments = getComments(editor)
    if (comments.length === 0) return

    // Build the prompt from comments
    const commentsPrompt = buildCommentsPrompt(comments)

    // Send the message (this will trigger agent mode to apply edits)
    await sendMessage(commentsPrompt)

    // Remove all comments after sending (they'll be processed by AI)
    // We do this immediately since the user triggered "Process Comments"
    editor.commands.unsetAllComments()
  }, [sendMessage])

  // Helper to get current comment count
  const getCommentCount = useCallback(() => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return 0
    return getComments(editor).length
  }, [])

  return {
    messages,
    isLoading,
    isStreaming,
    isInitializing,
    isPanelOpen,
    context,
    includeDocument,
    agentMode,
    sendMessage,
    stopGeneration,
    processComments,
    getCommentCount,
    updateMessage,
    clearMessages,
    togglePanel,
    setPanelOpen,
    setContext,
    setIncludeDocument,
    setAgentMode
  }
}
