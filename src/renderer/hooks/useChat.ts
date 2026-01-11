import { useCallback, useEffect } from 'react'
import { useChatStore, createMessageId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { validateConfig } from '../lib/llm'
import { buildSystemPrompt, buildCommentsPrompt } from '../lib/prompts'
import { getApi } from '../lib/browserApi'
import { getComments } from '../extensions/comments'
import { executeTool } from '../lib/tools'
import { getToolsForClaudeAPI } from '../../shared/tools/registry'
import type { LLMMessage, LLMStreamToolCall, LLMContentBlock } from '../types'

// Module-level flag to ensure stream listeners are only registered once globally
let streamListenersInitialized = false

// Module-level refs - these must be outside the hook to ensure event handlers
// registered once at module level can access the same refs that sendMessage uses
const pendingToolCallsRef = { current: [] as Array<{ id: string; name: string; args: unknown }> }
const toolLoopContextRef = { current: null as { apiMessages: LLMMessage[]; assistantMsgId: string } | null }

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
      console.log('[useChat:toolCall] Current streamId:', state.currentStreamId)
      if (toolCallEvent.streamId === state.currentStreamId) {
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

      // Get all tool calls (from streaming events or completion message)
      const toolCalls = complete.toolCalls || pendingToolCallsRef.current
      console.log('[useChat:complete] toolCalls from complete:', complete.toolCalls?.length, 'from ref:', pendingToolCallsRef.current.length)
      console.log('[useChat:complete] toolLoopContextRef.current:', toolLoopContextRef.current ? 'SET' : 'NULL')
      pendingToolCallsRef.current = [] // Clear for next stream

      if (toolCalls && toolCalls.length > 0 && toolLoopContextRef.current) {
        console.log('[useChat:complete] Executing', toolCalls.length, 'tool calls')
        // Execute tool calls and continue the conversation
        const { apiMessages, assistantMsgId } = toolLoopContextRef.current

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

        // Execute each tool and collect results
        const toolResults: Array<{ id: string; name: string; result: unknown }> = []
        for (const toolCall of toolCalls) {
          const result = await executeTool(toolCall.name, toolCall.args, state.toolMode)
          toolResults.push({ id: toolCall.id, name: toolCall.name, result })

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

        // Continue conversation with tool results
        const newStreamId = createMessageId()
        state.startStreaming(assistantMsgId, newStreamId)

        // Update context for potential next tool loop
        toolLoopContextRef.current = { apiMessages: updatedMessages, assistantMsgId }

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
          toolLoopContextRef.current = null
        }
      } else {
        // No tool calls - complete normally
        state.completeStreaming()
        toolLoopContextRef.current = null
      }
    })

    const unsubError = api.onLLMStreamError((error) => {
      console.log('[useChat:error] Received:', error.streamId, 'error:', error.error)
      const state = useChatStore.getState()
      console.log('[useChat:error] Current streamId:', state.currentStreamId)
      if (error.streamId === state.currentStreamId) {
        console.log('[useChat:error] ✓ Processing error')
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
        toolLoopContextRef.current = null
        pendingToolCallsRef.current = []
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
        toolLoopContextRef.current = { apiMessages, assistantMsgId }
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
        // Update the assistant message with error
        updateMessage(assistantMsgId, {
          content: `Error: ${errorMessage}. Please check your API key in Settings (Cmd+,).`
        })
        completeStreaming()
        toolLoopContextRef.current = null
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
    toolMode,
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
    setAgentMode,
    setToolMode
  }
}
