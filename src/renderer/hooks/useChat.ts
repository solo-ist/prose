import { useCallback, useEffect } from 'react'
import { useChatStore, createMessageId, type ToolMode } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { validateConfig } from '../lib/llm'
import { buildSystemPrompt, buildCommentsPrompt, buildSuggestionRepliesPrompt } from '../lib/prompts'
import { getApi } from '../lib/browserApi'
import { getComments } from '../extensions/comments'
import { getSuggestionsWithFeedback } from '../extensions/ai-suggestions'
import { executeTool, resolveToolPosition } from '../lib/tools'
import { getToolsForClaudeAPI } from '../../shared/tools/registry'
import { resolveModelName } from '../../shared/llm/models'
import type { LLMMessage, LLMStreamToolCall, LLMStreamToolCallStart, LLMContentBlock } from '../types'

// Chat Mode gets a read-only tool subset rather than the full read+write
// surface, so the agent can ground itself in the document without proposing
// edits. Defense-in-depth alongside the registry-level mode gating:
// `requiresMode` on each ToolConfig excludes mutating tools from Chat Mode at
// the registry, AND this explicit allowlist ensures Chat Mode only ever
// receives tools we have specifically vetted as read-only.
//
// Why both layers: registry gating relies on every new tool author setting
// `requiresMode` correctly; a tool added with `requiresMode: null` (the
// default for read-only tools) would silently appear in Chat Mode. The
// allowlist keeps the failure mode "tool missing" rather than "tool leaks."
//
// Audit checkpoint: when new tools land, decide whether they belong in
// Chat Mode and extend this set.
const CHAT_MODE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_document',
  'read_selection',
  'get_metadata',
  'search_document',
  'get_outline',
  'list_comments',
  // UX coordination: lets the agent offer the user a one-click mode
  // switch when their request is out of scope for the current mode.
  // It doesn't read or mutate anything — just renders a button.
  'request_mode_switch'
])

function getToolsForToolMode(toolMode: ToolMode): ReturnType<typeof getToolsForClaudeAPI> {
  if (toolMode === 'chat') {
    // Pass 'chat' to the registry filter first so layer 1 actually fires for
    // Chat Mode — only tools with `requiresMode <= chat` survive. Then narrow
    // further to the explicit allowlist. Both layers run in series, so a
    // regression in either (a missing `requiresMode: 'editor'` on a future
    // mutating tool, or a missing entry in the allowlist) is caught by the
    // other.
    return getToolsForClaudeAPI('chat').filter((t) => CHAT_MODE_TOOL_NAMES.has(t.name))
  }
  return getToolsForClaudeAPI(toolMode)
}

// Module-level flag to ensure stream listeners are only registered once globally
let streamListenersInitialized = false

// Build a self-closing marker tag that ChatMessage's parseToolTags recognizes
// as a "drafting" indicator (LLM is composing the tool's input). The matching
// tag is stripped before the tool result summary is appended.
function buildDraftingTag(toolCallId: string, toolName: string): string {
  return `<tool-drafting id="${toolCallId}" name="${toolName}"></tool-drafting>`
}

// Strip a specific drafting marker once the tool has finished and its
// result is about to be appended. Match the exact id; only one such tag
// can exist per tool call.
function stripDraftingTag(content: string, toolCallId: string): string {
  const escapedId = toolCallId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.replace(
    new RegExp(`<tool-drafting id="${escapedId}" name="[^"]+"></tool-drafting>`, 'g'),
    ''
  )
}

// Strip every drafting marker regardless of id. Used on terminal paths
// (stream error, user abort, outer catch) where the per-id strip in the
// tool-result loop won't run, otherwise the chip persists forever.
function stripAllDraftingTags(content: string): string {
  return content.replace(/<tool-drafting[^>]*><\/tool-drafting>/g, '')
}

// Maximum tool roundtrips before circuit breaker stops the loop
const MAX_TOOL_ROUNDTRIPS = 5

// Maximum messages to keep in context (plus pinned first user message)
const MAX_HISTORY_MESSAGES = 20

/**
 * Summarize tool results to reduce context size.
 * Strips redundant `markdown` field from read_document results since nodes already contain content.
 */
function summarizeToolResult(toolName: string, result: { success: boolean; data?: unknown; error?: string }): string {
  if (!result.success) return JSON.stringify(result)
  if (toolName === 'read_document' && result.data) {
    const data = result.data as { nodes?: unknown[]; markdown?: string }
    if (data.nodes) {
      return JSON.stringify({ success: true, data: { nodes: data.nodes, nodeCount: data.nodes.length } })
    }
  }
  return JSON.stringify(result)
}

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
    // True if the turn started with a mode switch (Switch & Run or
    // StatusBar toggle between sends). Propagates through every
    // tool-loop continuation in the turn so the "you just switched"
    // notice stays on the system prompt — without it, continuations
    // after a legitimate read_document call lose the notice and the
    // LLM pattern-matches against prior-mode assistant messages,
    // hallucinating "I'm still in <old> Mode" despite the tool list
    // and per-mode instructions reflecting the new mode.
    modeJustSwitched: boolean
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
    setToolMode,
    cycleToolMode,
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

    // Drafting indicator: fires when the LLM begins a tool_use content block,
    // before any input_json_delta. For tools whose body the model has to
    // compose (e.g., `insert`/`edit` with paragraph-length text), this is the
    // chunk of latency users currently see as silence. We append a self-
    // closing <tool-drafting> tag to the streaming assistant message so
    // ChatMessage's parser renders a "Drafting…" chip. The tag is stripped
    // once the tool result is appended in onLLMStreamComplete below.
    const unsubToolCallStart = api.onLLMStreamToolCallStart((start: LLMStreamToolCallStart) => {
      const state = useChatStore.getState()
      if (start.streamId !== state.currentStreamId || !state.streamingMessageId) return
      const currentMsg = state.messages.find((m) => m.id === state.streamingMessageId)
      const existing = currentMsg?.content ?? ''
      state.updateMessage(state.streamingMessageId, {
        content: existing + buildDraftingTag(start.toolCallId, start.toolName)
      })
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

        // Sort editor-mutating tool calls by document position (descending)
        // so bottom-of-document edits execute first and don't shift positions above
        const EDITOR_MUTATING_TOOLS = new Set(['edit', 'insert', 'suggest_edit', 'delete_node'])
        const sortedToolCalls = [...toolCalls]
        if (sortedToolCalls.some(tc => EDITOR_MUTATING_TOOLS.has(tc.name))) {
          // Pre-resolve positions before any edits execute
          const positions = sortedToolCalls.map(tc =>
            EDITOR_MUTATING_TOOLS.has(tc.name)
              ? resolveToolPosition(tc.name, tc.args as Record<string, unknown>)
              : -1
          )
          // Stable sort: editor tools by position descending, non-editor tools keep original order
          const indexed = sortedToolCalls.map((tc, i) => ({ tc, pos: positions[i], origIdx: i }))
          indexed.sort((a, b) => {
            const aIsEditor = EDITOR_MUTATING_TOOLS.has(a.tc.name)
            const bIsEditor = EDITOR_MUTATING_TOOLS.has(b.tc.name)
            if (aIsEditor && bIsEditor) {
              if (a.pos === b.pos) return 0
              return b.pos > a.pos ? 1 : -1 // descending position
            }
            if (aIsEditor && !bIsEditor) return 1 // editor tools after non-editor
            if (!aIsEditor && bIsEditor) return -1 // non-editor tools first
            return a.origIdx - b.origIdx // preserve original order for non-editor
          })
          sortedToolCalls.splice(0, sortedToolCalls.length, ...indexed.map(x => x.tc))
        }

        // Execute each tool and collect results
        const toolResults: Array<{ id: string; name: string; result: unknown }> = []
        let currentErrorSignature: string | null = null

        for (const toolCall of sortedToolCalls) {
          const result = await executeTool(toolCall.name, toolCall.args, state.toolMode, provenance)
          toolResults.push({ id: toolCall.id, name: toolCall.name, result })

          // Track error signature for consecutive failure detection
          if (!result.success && result.error) {
            currentErrorSignature = `${toolCall.name}:${result.error}`
          }

          // Append tool execution info using the same <tool-result> tag
          // format as user-initiated slash commands so custom renderers in
          // src/renderer/components/chat/toolResultRenderers/ get the full
          // structured payload regardless of who triggered the tool call.
          // Strip the matching drafting marker for this tool call first so
          // we don't render the "Drafting…" chip alongside the result chip.
          // Read latest state so prior-tool appends in this same loop
          // iteration are preserved.
          const resultText = result.success
            ? (typeof result.data === 'string'
                ? result.data
                : '```json\n' + JSON.stringify(result.data, null, 2) + '\n```')
            : `Error: ${result.error}`
          const latest = useChatStore.getState()
          const previous = latest.messages.find((m) => m.id === assistantMsgId)?.content ?? ''
          latest.updateMessage(assistantMsgId, {
            content:
              stripDraftingTag(previous, toolCall.id) +
              `\n\n<tool-result name="${toolCall.name}" success="${result.success}">${resultText}</tool-result>`
          })

          // Add tool result message to API messages (summarized to reduce context)
          updatedMessages.push({
            role: 'tool' as const,
            content: summarizeToolResult(toolCall.name, result),
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

        // Update context for potential next tool loop with new streamId.
        // Preserve `modeJustSwitched` across the whole turn so subsequent
        // continuations keep the "you just switched" notice.
        const priorTurnContext = toolLoopContextRef.current
        toolLoopContextRef.current = {
          apiMessages: updatedMessages,
          assistantMsgId,
          roundtripCount: roundtripCount + 1,
          lastErrorSignature: currentErrorSignature,
          modeJustSwitched: priorTurnContext?.modeJustSwitched ?? false
        }
        toolLoopContextRef.streamId = newStreamId
        pendingToolCallsRef.streamId = newStreamId

        // Call LLM again with tool results
        const settingsState = useSettingsStore.getState()
        const editorState = useEditorStore.getState()
        const tools = getToolsForToolMode(state.toolMode)
        // Mid-stream mode switches are rare (user toggles during tool loop)
        // but the same idempotency logic applies. lastSentToolMode was set
        // at the start of this stream, so this fires only on genuine mid-
        // stream toggles.
        const loopLastSent = state.lastSentToolMode
        const loopModeJustSwitched = loopLastSent !== null && loopLastSent !== state.toolMode
        if (loopModeJustSwitched) {
          state.setLastSentToolMode(state.toolMode)
        }
        // The notice fires if the turn started with a switch (Switch &
        // Run or pre-send StatusBar toggle) OR if the user toggled mode
        // mid-loop. Either way we want the grounding text in the prompt.
        const continuationModeJustSwitched =
          toolLoopContextRef.current.modeJustSwitched || loopModeJustSwitched

        try {
          await api.llmChatStream({
            provider: settingsState.settings.llm.provider,
            model: settingsState.settings.llm.model,
            apiKey: settingsState.settings.llm.apiKey,
            baseUrl: settingsState.settings.llm.baseUrl,
            messages: updatedMessages,
            system: buildSystemPrompt(
              editorState.document.content,
              state.toolMode,
              editorState.document.path,
              resolveModelName(settingsState.settings.llm.model, settingsState.fetchedModels),
              continuationModeJustSwitched
            ),
            streamId: newStreamId,
            tools,
            maxToolRoundtrips: 5,
            maxTokens: state.toolMode === 'chat' ? 3072 : 4096
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
          // Strip any orphan <tool-drafting> tags. They're normally cleared in
          // onLLMStreamComplete's tool-result loop, but a stream error between
          // content_block_start and that loop would leave them dangling.
          const cleaned = stripAllDraftingTags(currentMsg?.content || '')
          state.updateMessage(state.streamingMessageId, {
            content: cleaned + `\n\nError: ${error.error}${guidance}`,
            isError: true
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
      unsubToolCallStart()
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
      // Read toolMode fresh from the store rather than relying on the
      // React-closure-captured value. Necessary because callers (notably
      // RequestModeSwitchActions' "Switch & Run" path) may setToolMode
      // and then synchronously dispatch sendMessage in the same tick —
      // React hasn't re-rendered yet, and the captured `toolMode` would
      // be stale. Reading from the store always reflects the latest.
      const toolMode = useChatStore.getState().toolMode

      // Auto-create a conversation if there isn't one
      if (!activeConversationId) {
        addConversation(document.documentId)
      }

      // Check AI consent before making any API calls
      if (!settings.aiConsent?.consented) {
        const consentMsgId = createMessageId()
        addMessage({
          id: consentMsgId,
          role: 'assistant',
          content: 'AI features are not enabled. Enable them in Settings → LLM to use the assistant.',
          timestamp: new Date()
        })
        return
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
      let apiMessages: LLMMessage[] = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.context
          ? `Regarding this text:\n\n> ${m.context}\n\n${m.content}`
          : m.content
      }))
      apiMessages.push({ role: 'user' as const, content: fullMessage })

      // Prune history: keep first user message + last MAX_HISTORY_MESSAGES
      if (apiMessages.length > MAX_HISTORY_MESSAGES) {
        // Find first non-hidden user message (skip auto-describe)
        const firstUserIdx = messages.findIndex((m) => m.role === 'user' && !m.hidden)
        const pinned = firstUserIdx >= 0 ? [apiMessages[firstUserIdx]] : []
        const recent = apiMessages.slice(-MAX_HISTORY_MESSAGES)
        apiMessages =
          pinned.length > 0 && !recent.includes(pinned[0])
            ? [...pinned, ...recent]
            : recent
      }

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
      let tools: ReturnType<typeof getToolsForToolMode> | undefined
      try {
        tools = getToolsForToolMode(toolMode)
        console.log('[useChat] tools:', tools?.length || 0)
        if (tools && tools.length > 0) {
          console.log('[useChat] First tool schema:', JSON.stringify(tools[0], null, 2))
        }
      } catch (toolErr) {
        console.error('[useChat] Error getting tools:', toolErr)
        tools = undefined
      }
      // Detect mid-conversation mode switches so we can prepend a one-line
      // note to the system prompt. Idempotent across multiple toggles:
      // only the diff at send time matters, and we update lastSentToolMode
      // immediately so the tool-loop continuation (later in this stream)
      // doesn't re-fire the marker on every roundtrip.
      const lastSent = useChatStore.getState().lastSentToolMode
      const modeJustSwitched = lastSent !== null && lastSent !== toolMode
      useChatStore.getState().setLastSentToolMode(toolMode)

      if (tools && tools.length > 0) {
        toolLoopContextRef.current = {
          apiMessages,
          assistantMsgId,
          roundtripCount: 0,
          lastErrorSignature: null,
          modeJustSwitched
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
          system: buildSystemPrompt(
            useEditorStore.getState().document.content,
            toolMode,
            useEditorStore.getState().document.path,
            resolveModelName(settings.llm.model, useSettingsStore.getState().fetchedModels),
            modeJustSwitched
          ),
          streamId,
          tools,
          maxToolRoundtrips: 5,
          maxTokens: toolMode === 'chat' ? 3072 : 4096
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
          content: `Error: ${errorMessage}. ${guidance}`,
          isError: true
        })
        completeStreaming()
        clearStreamRefs()
      }
    },
    [
      context,
      isLoading,
      messages,
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
    // Strip orphan drafting tags before tearing down the stream — aborting
    // mid-tool-input composition would otherwise leave a perpetual chip.
    // Must run before completeStreaming() clears streamingMessageId.
    if (state.streamingMessageId) {
      const currentMsg = state.messages.find((m) => m.id === state.streamingMessageId)
      if (currentMsg?.content) {
        const cleaned = stripAllDraftingTags(currentMsg.content)
        if (cleaned !== currentMsg.content) {
          state.updateMessage(state.streamingMessageId, { content: cleaned })
        }
      }
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

  // Process a single comment by id — same prompt shape as processComments,
  // but scoped to just one mark so the user can act per-comment from the popover.
  const processComment = useCallback(async (commentId: string) => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return

    const target = getComments(editor).find((c) => c.id === commentId)
    if (!target) return

    const commentsPrompt = buildCommentsPrompt([target])
    await sendMessage(commentsPrompt)
    editor.commands.unsetComment(commentId)
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

  return {
    messages,
    isLoading,
    isStreaming,
    isInitializing,
    isPanelOpen,
    context,
    toolMode,
    sendMessage,
    stopGeneration,
    processComments,
    processComment,
    getCommentCount,
    processSuggestionReplies,
    getSuggestionFeedbackCount,
    updateMessage,
    clearMessages,
    togglePanel,
    setPanelOpen,
    setContext,
    setToolMode,
    cycleToolMode
  }
}
