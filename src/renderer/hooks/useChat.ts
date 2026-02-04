import { useCallback, useEffect } from 'react'
import { useChatStore, createMessageId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { validateConfig } from '../lib/llm'
import { buildSystemPrompt, buildCommentsPrompt, buildSuggestionRepliesPrompt } from '../lib/prompts'
import { getApi } from '../lib/browserApi'
import { getComments } from '../extensions/comments'
import { getSuggestionsWithFeedback } from '../extensions/ai-suggestions'
import { executeTool } from '../lib/tools'
import { getToolsForClaudeAPI } from '../../shared/tools/registry'
import type { LLMMessage, LLMStreamToolCall, LLMContentBlock } from '../types'

// Module-level flag to ensure stream listeners are only registered once globally
let streamListenersInitialized = false

// Maximum tool roundtrips before circuit breaker stops the loop
const MAX_TOOL_ROUNDTRIPS = 5

// Module-level refs - these must be outside the hook to ensure event handlers
// registered once at module level can access the same refs that sendMessage uses
// Each ref includes a streamId to prevent race conditions when streams overlap
const pendingToolCallsRef = {
  current: [] as Array<{ id: string; name: string; args: unknown }>,
  streamId: null as string | null
}
const toolLoopContextRef = {
  current: null as {
    apiMessages: LLMMessage[]
    assistantMsgId: string
    roundtripCount: number
    lastErrorSignature: string | null
  } | null,
  streamId: null as string | null
}

/**
 * Clear stream-related refs. Called on abort/error to prevent stale data
 * from being used by subsequent streams.
 */
function clearStreamRefs(): void {
  pendingToolCallsRef.current = []
  pendingToolCallsRef.streamId = null
  toolLoopContextRef.current = null
  toolLoopContextRef.streamId = null
}

export function useChat() {
  const {
    messages,
    isLoading,
    isPanelOpen,
    context,
    includeDocument,
    agentMode,
    toolMode,
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
    setToolMode,
    startStreaming,
    appendStreamChunk,
    completeStreaming
  } = useChatStore()

  const { settings } = useSettingsStore()
  const { document } = useEditorStore()

  // Note: pendingToolCallsRef and toolLoopContextRef are defined at module level
  // to ensure event handlers (registered once globally) share the same refs
  // that sendMessage uses

  // Set up stream event listeners (only once globally across all hook instances)
  useEffect(() => {
    if (streamListenersInitialized) {
      console.log('[useChat:listeners] Already initialized, skipping')
      return
    }

    console.log('[useChat:listeners] Initializing stream listeners')
    streamListenersInitialized = true
    const api = getApi()

    const unsubChunk = api.onLLMStreamChunk((chunk) => {
      console.log('[useChat:chunk] Received:', chunk.streamId, 'delta:', chunk.delta?.slice(0, 30))
      const state = useChatStore.getState()
      console.log('[useChat:chunk] Current streamId:', state.currentStreamId)
      if (chunk.streamId === state.currentStreamId) {
        console.log('[useChat:chunk] ✓ Appending delta')
        state.appendStreamChunk(chunk.delta)
      } else {
        console.log('[useChat:chunk] ✗ REJECTED - streamId mismatch')
      }
    })

    const unsubToolCall = api.onLLMStreamToolCall((toolCallEvent: LLMStreamToolCall) => {
      console.log('[useChat:toolCall] Received:', toolCallEvent.streamId, 'tool:', toolCallEvent.toolCall?.name)
      const state = useChatStore.getState()
      console.log('[useChat:toolCall] Current streamId:', state.currentStreamId, 'ref streamId:', pendingToolCallsRef.streamId)
      // Validate both current stream and ref streamId match to prevent race conditions
      if (toolCallEvent.streamId === state.currentStreamId &&
          toolCallEvent.streamId === pendingToolCallsRef.streamId) {
        console.log('[useChat:toolCall] ✓ Accumulating tool call')
        // Accumulate tool calls
        pendingToolCallsRef.current.push(toolCallEvent.toolCall)
      } else {
        console.log('[useChat:toolCall] ✗ REJECTED - streamId mismatch')
      }
    })

    const unsubComplete = api.onLLMStreamComplete(async (complete) => {
      console.log('[useChat:complete] Received:', complete.streamId, 'content:', complete.content?.slice(0, 50), 'toolCalls:', complete.toolCalls?.length || 0)
      const state = useChatStore.getState()
      console.log('[useChat:complete] Current streamId:', state.currentStreamId)
      if (complete.streamId !== state.currentStreamId) {
        console.log('[useChat:complete] ✗ REJECTED - streamId mismatch')
        return
      }
      console.log('[useChat:complete] ✓ Processing completion')

      // Validate streamId on refs to prevent race conditions
      const refsMatchStream = complete.streamId === pendingToolCallsRef.streamId &&
                              complete.streamId === toolLoopContextRef.streamId

      // Get all tool calls (from streaming events or completion message)
      // Only use pendingToolCallsRef if it matches the current stream
      const toolCalls = complete.toolCalls ||
        (refsMatchStream ? pendingToolCallsRef.current : [])
      console.log('[useChat:complete] toolCalls from complete:', complete.toolCalls?.length, 'from ref:', pendingToolCallsRef.current.length, 'refsMatch:', refsMatchStream)
      console.log('[useChat:complete] toolLoopContextRef.current:', toolLoopContextRef.current ? 'SET' : 'NULL')

      // Clear pending tool calls for this stream
      if (refsMatchStream) {
        pendingToolCallsRef.current = []
      }

      if (toolCalls && toolCalls.length > 0 && toolLoopContextRef.current && refsMatchStream) {
        console.log('[useChat:complete] Executing', toolCalls.length, 'tool calls')
        // Execute tool calls and continue the conversation
        const { apiMessages, assistantMsgId, roundtripCount, lastErrorSignature } = toolLoopContextRef.current

        // Circuit breaker: stop if we've hit max roundtrips
        if (roundtripCount >= MAX_TOOL_ROUNDTRIPS) {
          console.log('[useChat:complete] Circuit breaker: max roundtrips reached', roundtripCount)
          const currentMsg = state.messages.find((m) => m.id === assistantMsgId)
          state.updateMessage(assistantMsgId, {
            content: (currentMsg?.content || '') +
              `\n\n*Stopped: Maximum tool iterations (${MAX_TOOL_ROUNDTRIPS}) reached. The edits may require manual attention.*`
          })
          state.completeStreaming()
          clearStreamRefs()
          return
        }

        // Build assistant message content with text AND tool_use blocks
        // The Anthropic API requires tool_use blocks in the assistant message
        // for the subsequent tool_result to be valid
        const assistantText = state.messages.find((m) => m.id === assistantMsgId)?.content || ''
        const assistantContentBlocks: LLMContentBlock[] = []

        // Add text block if there's any text content
        if (assistantText.trim()) {
          assistantContentBlocks.push({ type: 'text', text: assistantText })
        }

        // Add tool_use blocks for each tool call
        for (const toolCall of toolCalls) {
          assistantContentBlocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.args
          })
        }

        const updatedMessages: LLMMessage[] = [
          ...apiMessages,
          { role: 'assistant' as const, content: assistantContentBlocks }
        ]

        // Build provenance context for AI annotation tracking
        const provenance = {
          model: useSettingsStore.getState().settings.llm.model || 'unknown',
          conversationId: useChatStore.getState().activeConversationId || '',
          messageId: assistantMsgId,
          documentId: useEditorStore.getState().document.documentId || '',
        }

        // Execute each tool and collect results
        const toolResults: Array<{ id: string; name: string; result: unknown }> = []
        let currentErrorSignature: string | null = null

        for (const toolCall of toolCalls) {
          const result = await executeTool(toolCall.name, toolCall.args, state.toolMode, provenance)
          toolResults.push({ id: toolCall.id, name: toolCall.name, result })

          // Track error signature for consecutive failure detection
          if (!result.success && result.error) {
            currentErrorSignature = `${toolCall.name}:${result.error}`
          }

          // Append tool execution info to the message
          const resultSummary = result.success
            ? (typeof result.data === 'string' ? result.data.slice(0, 100) : 'Success')
            : `Error: ${result.error}`
          state.updateMessage(assistantMsgId, {
            content:
              state.messages.find((m) => m.id === assistantMsgId)?.content +
              `\n\n*[Tool: ${toolCall.name}] ${resultSummary}*`
          })

          // Add tool result message to API messages
          updatedMessages.push({
            role: 'tool' as const,
            content: JSON.stringify(result),
            tool_call_id: toolCall.id
          })
        }

        // Consecutive failure detection: stop if same error occurs twice
        if (currentErrorSignature && currentErrorSignature === lastErrorSignature) {
          console.log('[useChat:complete] Consecutive failure detected:', currentErrorSignature)
          const currentMsg = state.messages.find((m) => m.id === assistantMsgId)
          state.updateMessage(assistantMsgId, {
            content: (currentMsg?.content || '') +
              `\n\n*Stopped: Same error occurred twice. Please check the search text is copied exactly from the document.*`
          })
          state.completeStreaming()
          clearStreamRefs()
          return
        }

        // Continue conversation with tool results
        const newStreamId = createMessageId()
        state.startStreaming(assistantMsgId, newStreamId)

        // Update context for potential next tool loop with new streamId
        toolLoopContextRef.current = {
          apiMessages: updatedMessages,
          assistantMsgId,
          roundtripCount: roundtripCount + 1,
          lastErrorSignature: currentErrorSignature
        }
        toolLoopContextRef.streamId = newStreamId
        pendingToolCallsRef.streamId = newStreamId

        // Call LLM again with tool results
        const settingsState = useSettingsStore.getState()
        const editorState = useEditorStore.getState()
        const tools = state.toolMode !== 'suggestions' ? getToolsForClaudeAPI(state.toolMode) : undefined

        try {
          await api.llmChatStream({
            provider: settingsState.settings.llm.provider,
            model: settingsState.settings.llm.model,
            apiKey: settingsState.settings.llm.apiKey,
            baseUrl: settingsState.settings.llm.baseUrl,
            messages: updatedMessages,
            system: buildSystemPrompt(state.includeDocument, editorState.document.content),
            streamId: newStreamId,
            tools,
            maxToolRoundtrips: 5
          })
        } catch (error) {
          console.error('[Chat] Tool loop error:', error)
          state.completeStreaming()
          clearStreamRefs()
        }
      } else {
        // No tool calls - complete normally
        state.completeStreaming()
        clearStreamRefs()
      }
    })

    const unsubError = api.onLLMStreamError((error) => {
      console.log('[useChat:error] Received:', error.streamId, 'error:', error.error)
      const state = useChatStore.getState()
      console.log('[useChat:error] Current streamId:', state.currentStreamId)
      if (error.streamId === state.currentStreamId) {
        console.log('[useChat:error] ✓ Processing error')
        // Append error to the streaming message with actionable guidance
        if (state.streamingMessageId) {
          const currentMsg = state.messages.find(
            (m) => m.id === state.streamingMessageId
          )
          // Provide actionable guidance based on error type
          const lowerError = error.error.toLowerCase()
          let guidance = ''
          if (lowerError.includes('api key') || lowerError.includes('unauthorized') || lowerError.includes('invalid')) {
            guidance = ' Check your API key in Settings.'
          } else if (lowerError.includes('rate limit') || lowerError.includes('overloaded')) {
            guidance = ' Wait a moment and try again.'
          } else if (lowerError.includes('connect') || lowerError.includes('network') || lowerError.includes('timeout')) {
            guidance = ' Check your internet connection.'
          }
          state.updateMessage(state.streamingMessageId, {
            content: (currentMsg?.content || '') + `\n\n*Error: ${error.error}${guidance}*`
          })
        }
        state.completeStreaming()
        clearStreamRefs()
      }
    })

    // No cleanup - listeners persist for app lifetime
    // This is intentional since we use module-level guard
    console.log('[useChat:listeners] Setup complete')
    return () => {
      console.log('[useChat:listeners] CLEANUP - unsubscribing all listeners')
      unsubChunk()
      unsubToolCall()
      unsubComplete()
      unsubError()
      streamListenersInitialized = false
    }
  }, [])

  const sendMessage = useCallback(
    async (content: string, options?: { hidden?: boolean }) => {
      console.log('[useChat] sendMessage called with:', content?.substring(0, 50), 'isLoading:', isLoading)
      if (!content.trim() || isLoading) return
      console.log('[useChat] sendMessage passed initial check')

      // Auto-create a conversation if there isn't one
      if (!activeConversationId) {
        addConversation(document.documentId)
      }

      // Validate config first
      console.log('[useChat] Validating config:', settings.llm?.provider, settings.llm?.model)
      const configError = validateConfig(settings.llm)
      if (configError) {
        console.log('[useChat] Config error:', configError)
        const errorMsgId = createMessageId()
        addMessage({
          id: errorMsgId,
          role: 'assistant',
          content: `${configError}. Please configure your API settings (Cmd+,).`,
          timestamp: new Date()
        })
        return
      }
      console.log('[useChat] Config validated successfully')

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

      console.log('[useChat] User message added')
      setLoading(true)

      // Build messages array for the API
      const apiMessages: LLMMessage[] = messages.map((m) => ({
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

      console.log('[useChat] Starting streaming, streamId:', streamId)
      startStreaming(assistantMsgId, streamId)

      // Initialize tool loop context if tools are enabled
      console.log('[useChat] toolMode:', toolMode)
      let tools
      try {
        tools = toolMode !== 'suggestions' ? getToolsForClaudeAPI(toolMode) : undefined
        console.log('[useChat] tools:', tools?.length || 0)
        if (tools && tools.length > 0) {
          console.log('[useChat] First tool schema:', JSON.stringify(tools[0], null, 2))
        }
      } catch (toolErr) {
        console.error('[useChat] Error getting tools:', toolErr)
        tools = undefined
      }
      if (tools) {
        toolLoopContextRef.current = {
          apiMessages,
          assistantMsgId,
          roundtripCount: 0,
          lastErrorSignature: null
        }
        toolLoopContextRef.streamId = streamId
        pendingToolCallsRef.streamId = streamId
      }

      console.log('[useChat] About to call llmChatStream')
      try {
        // Call streaming LLM (via Electron IPC or browser fallback)
        const api = getApi()
        console.log('[useChat] Got API, calling llmChatStream with tools:', tools?.length || 0)
        await api.llmChatStream({
          provider: settings.llm.provider,
          model: settings.llm.model,
          apiKey: settings.llm.apiKey,
          baseUrl: settings.llm.baseUrl,
          messages: apiMessages,
          system: buildSystemPrompt(includeDocument, useEditorStore.getState().document.content),
          streamId,
          tools,
          maxToolRoundtrips: 5
        })
      } catch (error) {
        console.error('[Chat] Error:', error)
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'

        // Provide actionable guidance based on error type
        let guidance = ''
        const lowerError = errorMessage.toLowerCase()
        if (lowerError.includes('api key') || lowerError.includes('unauthorized') || lowerError.includes('401')) {
          guidance = 'Please check your API key in Settings (Cmd+,).'
        } else if (lowerError.includes('rate limit') || lowerError.includes('429')) {
          guidance = 'Please wait a moment and try again.'
        } else if (lowerError.includes('connect') || lowerError.includes('network') || lowerError.includes('timeout')) {
          guidance = 'Please check your internet connection and try again.'
        } else if (lowerError.includes('model') || lowerError.includes('not found')) {
          guidance = 'Please verify the model name in Settings (Cmd+,).'
        } else {
          guidance = 'Please check your settings (Cmd+,) and try again.'
        }

        // Update the assistant message with error and guidance
        updateMessage(assistantMsgId, {
          content: `Error: ${errorMessage}. ${guidance}`
        })
        completeStreaming()
        clearStreamRefs()
      }
    },
    [
      context,
      isLoading,
      messages,
      includeDocument,
      toolMode,
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
    // Clear stream refs before completing to prevent race conditions
    clearStreamRefs()
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

  const processSuggestionReplies = useCallback(async () => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return

    const suggestionsWithFeedback = getSuggestionsWithFeedback(editor)
    if (suggestionsWithFeedback.length === 0) return

    // Build the prompt from suggestions with feedback
    const feedbackPrompt = buildSuggestionRepliesPrompt(suggestionsWithFeedback)

    // Send the message (this will trigger agent mode to create new suggestions)
    await sendMessage(feedbackPrompt)

    // Remove the old suggestions after sending (they'll be replaced by new suggestions)
    // We do this immediately since the user triggered "Process Feedback"
    suggestionsWithFeedback.forEach((suggestion) => {
      editor.commands.rejectAISuggestion(suggestion.id)
    })
  }, [sendMessage])

  // Helper to get count of suggestions with pending feedback
  const getSuggestionFeedbackCount = useCallback(() => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return 0
    return getSuggestionsWithFeedback(editor).length
  }, [])

  // Auto-describe document on open (hidden message triggers AI summary)
  const describeDocument = useCallback(async () => {
    // Only describe if document context is enabled
    const state = useChatStore.getState()
    if (!state.includeDocument) return

    // Only describe if there's content
    const content = useEditorStore.getState().document.content
    if (!content || content.trim().length === 0) return

    // Open chat panel to show the description
    setPanelOpen(true)

    // Send a hidden prompt that triggers declarative description
    // The prompt encourages confident, direct language without hedging
    await sendMessage(
      'Briefly describe this document in 1-2 sentences. Be direct and declarative - state what it is, not what it "appears to be". Focus on the content and purpose.',
      { hidden: true }
    )
  }, [sendMessage, setPanelOpen])

  return {
    messages,
    isLoading,
    isStreaming,
    isInitializing,
    isPanelOpen,
    context,
    includeDocument,
    agentMode,
    toolMode,
    sendMessage,
    stopGeneration,
    processComments,
    getCommentCount,
    processSuggestionReplies,
    getSuggestionFeedbackCount,
    describeDocument,
    updateMessage,
    clearMessages,
    togglePanel,
    setPanelOpen,
    setContext,
    setIncludeDocument,
    setAgentMode,
    setToolMode
  }
}
