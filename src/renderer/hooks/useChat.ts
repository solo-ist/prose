import { useCallback, useEffect } from 'react'
import { useChatStore, createMessageId, type ToolMode } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { aiAvailability, aiUnavailableMessage } from '../lib/llm'
import { notifyAINotConfigured } from '../lib/notifyAI'
import { buildSystemPrompt, buildCommentsPrompt, buildSuggestionRepliesPrompt } from '../lib/prompts'
import { getApi } from '../lib/browserApi'
import type { Editor } from '@tiptap/core'
import { getComments, threadsOf, countOpenThreads } from '../extensions/comments'
import { isToolHandleError, resolveToolHandle, type ToolBinding } from '../document/handle'
import { useTabStore } from '../stores/tabStore'
import type { CommentData } from '../extensions/comments/types'
import { getSuggestionsWithFeedback } from '../extensions/ai-suggestions'
import { executeTool, resolveToolPosition } from '../lib/tools'
import { getToolsForClaudeAPI } from '../../shared/tools/registry'
import { resolveModelName } from '../../shared/llm/models'
import type { LLMMessage, LLMStreamToolCall, LLMStreamToolCallStart, LLMContentBlock, LLMThinkingBlock } from '../types'

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

// Module-level, per-stream state (#1148): the event handlers are registered
// once for the app, and two turns on two documents may be live at once, so
// everything a stream needs is keyed by its id.
interface ToolLoopContext {
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
  // Thinking blocks from the most recent stream turn. The Anthropic
  // API requires these to be embedded verbatim in the assistant content
  // array of tool-loop continuations — dropping or modifying them
  // causes a 400 error. We accumulate them here and prepend them to
  // assistantContentBlocks before pushing the continuation message.
  thinkingBlocks: LLMThinkingBlock[]
}
const pendingToolCalls = new Map<string, Array<{ id: string; name: string; args: unknown }>>()
const toolLoopContexts = new Map<string, ToolLoopContext>()

/** Drop a stream's loop state (its turn ended, was aborted, or continued under a new stream id). */
function clearStreamRefs(streamId: string): void {
  pendingToolCalls.delete(streamId)
  toolLoopContexts.delete(streamId)
}

/**
 * The open threads of the editor's document with their replies (from the
 * threads plugin state) and, where the mark is live, its current positions
 * and text. An anchor-lost thread is included as it is: the model can still
 * read and answer it (#1147).
 */
function openThreadsWithPositions(editor: Editor): CommentData[] {
  const live = new Map(getComments(editor).map((m) => [m.id, m]))
  return threadsOf(editor.state)
    .filter((c) => !c.resolved)
    .map((c) => {
      const m = live.get(c.id)
      return m ? { ...c, ...m, replies: c.replies ?? [] } : c
    })
}

export function useChat() {
  const {
    messages,
    isLoading,
    isPanelOpen,
    context,
    toolMode,
    thinkingEnabled,
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

    // Every event names its stream; the stream names its turn, and the turn
    // its conversation, shown or parked (#1148). An event for a stream no
    // turn owns (aborted, finished) is dropped.
    const unsubChunk = api.onLLMStreamChunk((chunk) => {
      const state = useChatStore.getState()
      if (!state.turnFor(chunk.streamId)) {
        console.log('[useChat:chunk] ✗ REJECTED - no turn for stream', chunk.streamId)
        return
      }
      state.appendStreamChunk(chunk.delta, chunk.streamId)
    })

    // Thinking delta: the main process sends cumulative thinking text on each
    // thinking_delta event. We write it directly to the streaming message so
    // the ThinkingBlock component can show live updates while the model thinks.
    const unsubThinkingDelta = api.onLLMStreamThinkingDelta?.((delta) => {
      const state = useChatStore.getState()
      const found = state.turnFor(delta.streamId)
      if (!found) return
      state.updateMessageIn(found.conversationId, found.turn.messageId, { thinkingText: delta.thinking })
    })

    const unsubToolCall = api.onLLMStreamToolCall((toolCallEvent: LLMStreamToolCall) => {
      console.log('[useChat:toolCall] Received:', toolCallEvent.streamId, 'tool:', toolCallEvent.toolCall?.name)
      const pending = useChatStore.getState().turnFor(toolCallEvent.streamId) ? pendingToolCalls.get(toolCallEvent.streamId) : undefined
      if (pending) {
        pending.push(toolCallEvent.toolCall)
      } else {
        console.log('[useChat:toolCall] ✗ REJECTED - no turn for stream')
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
      const found = state.turnFor(start.streamId)
      if (!found) return
      const existing = state.messageOf(found.conversationId, found.turn.messageId)?.content ?? ''
      state.updateMessageIn(found.conversationId, found.turn.messageId, {
        content: existing + buildDraftingTag(start.toolCallId, start.toolName)
      })
    })

    const unsubComplete = api.onLLMStreamComplete(async (complete) => {
      console.log('[useChat:complete] Received:', complete.streamId, 'content:', complete.content?.slice(0, 50), 'toolCalls:', complete.toolCalls?.length || 0)
      const state = useChatStore.getState()
      const found = state.turnFor(complete.streamId)
      if (!found) {
        console.log('[useChat:complete] ✗ REJECTED - no turn for stream', complete.streamId)
        return
      }
      const { conversationId } = found
      const { binding } = found.turn
      const streamId = complete.streamId
      const loop = toolLoopContexts.get(streamId)

      // Get all tool calls (from streaming events or completion message)
      const toolCalls = complete.toolCalls || pendingToolCalls.get(streamId) || []
      pendingToolCalls.set(streamId, [])

      if (toolCalls && toolCalls.length > 0 && loop) {
        console.log('[useChat:complete] Executing', toolCalls.length, 'tool calls for', binding.documentId)
        // Execute tool calls and continue the conversation
        const { apiMessages, assistantMsgId, roundtripCount, lastErrorSignature } = loop

        // Circuit breaker: stop if we've hit max roundtrips
        if (roundtripCount >= MAX_TOOL_ROUNDTRIPS) {
          console.log('[useChat:complete] Circuit breaker: max roundtrips reached', roundtripCount)
          const currentMsg = state.messageOf(conversationId, assistantMsgId)
          state.updateMessageIn(conversationId, assistantMsgId, {
            content: (currentMsg?.content || '') +
              `\n\n*Stopped: Maximum tool iterations (${MAX_TOOL_ROUNDTRIPS}) reached. The edits may require manual attention.*`
          })
          state.completeStreaming(conversationId)
          clearStreamRefs(streamId)
          return
        }

        // Build assistant message content with text AND tool_use blocks
        // The Anthropic API requires tool_use blocks in the assistant message
        // for the subsequent tool_result to be valid.
        //
        // Thinking blocks MUST come first and be preserved unmodified. The
        // API rejects continuations that drop or modify them (#700).
        const assistantText = state.messageOf(conversationId, assistantMsgId)?.content || ''
        const assistantContentBlocks: LLMContentBlock[] = []

        // Prepend thinking blocks from this turn — required by the API
        const priorThinking = loop.thinkingBlocks ?? []
        for (const tb of priorThinking) {
          assistantContentBlocks.push(tb)
        }

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

        // Provenance for AI annotation tracking: the turn's conversation and
        // the document it is bound to, never the tab on screen (#1148).
        const model = useSettingsStore.getState().settings.llm.model || 'unknown'
        const provenance = {
          model,
          conversationId,
          messageId: assistantMsgId,
          documentId: binding.documentId,
        }
        // Positions are read on the bound document (a read: no source-mode refusal).
        const sortTarget = await resolveToolHandle(binding)
        const sortHandle = isToolHandleError(sortTarget) ? null : sortTarget

        // Sort editor-mutating tool calls by document position (descending)
        // so bottom-of-document edits execute first and don't shift positions above
        const EDITOR_MUTATING_TOOLS = new Set(['edit', 'insert', 'suggest_edit', 'delete_node'])
        const sortedToolCalls = [...toolCalls]
        if (sortedToolCalls.some(tc => EDITOR_MUTATING_TOOLS.has(tc.name))) {
          // Pre-resolve positions before any edits execute
          const positions = sortedToolCalls.map(tc =>
            EDITOR_MUTATING_TOOLS.has(tc.name)
              ? resolveToolPosition(tc.name, tc.args as Record<string, unknown>, sortHandle)
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
          // The binding is resolved per call: a tab-changing tool moves it,
          // a closed tab reopens in the background, a rename follows.
          const result = await executeTool(
            toolCall.name,
            toolCall.args,
            state.toolMode,
            { ...provenance, documentId: binding.documentId },
            binding
          )
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
          const previous = latest.messageOf(conversationId, assistantMsgId)?.content ?? ''
          latest.updateMessageIn(conversationId, assistantMsgId, {
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
          // The latest text, result tags included (a snapshot from before the
          // loop would drop them).
          const currentMsg = useChatStore.getState().messageOf(conversationId, assistantMsgId)
          state.updateMessageIn(conversationId, assistantMsgId, {
            content: (currentMsg?.content || '') +
              `\n\n*Stopped: Same error occurred twice. Please check the search text is copied exactly from the document.*`
          })
          state.completeStreaming(conversationId)
          clearStreamRefs(streamId)
          return
        }

        // Continue conversation with tool results, under a new stream id on
        // the same turn.
        const newStreamId = createMessageId()
        state.startStreaming(assistantMsgId, newStreamId, binding, conversationId)

        // Loop state for the next roundtrip. Preserve `modeJustSwitched`
        // across the whole turn so subsequent continuations keep the "you
        // just switched" notice. Store thinking blocks so the NEXT
        // continuation can prepend them to its assistant content array (the
        // API requires them preserved).
        toolLoopContexts.set(newStreamId, {
          apiMessages: updatedMessages,
          assistantMsgId,
          roundtripCount: roundtripCount + 1,
          lastErrorSignature: currentErrorSignature,
          modeJustSwitched: loop.modeJustSwitched,
          thinkingBlocks: (complete.thinkingBlocks as LLMThinkingBlock[] | undefined) ?? []
        })
        pendingToolCalls.set(newStreamId, [])
        clearStreamRefs(streamId)

        // Call LLM again with tool results; the system prompt describes the
        // bound document as it is now, wherever it is.
        const settingsState = useSettingsStore.getState()
        const bound = await resolveToolHandle(binding)
        const boundContent = isToolHandleError(bound) ? '' : bound.serialize()
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
        const continuationModeJustSwitched = loop.modeJustSwitched || loopModeJustSwitched

        try {
          await api.llmChatStream({
            provider: settingsState.settings.llm.provider,
            model: settingsState.settings.llm.model,
            baseUrl: settingsState.settings.llm.baseUrl,
            messages: updatedMessages,
            system: buildSystemPrompt(
              boundContent,
              state.toolMode,
              binding.path,
              resolveModelName(settingsState.settings.llm.model, settingsState.fetchedModels),
              continuationModeJustSwitched
            ),
            streamId: newStreamId,
            tools,
            maxToolRoundtrips: 5,
            maxTokens: state.toolMode === 'chat' ? 16000 : 16000,
            thinking: state.thinkingEnabled
          })
        } catch (error) {
          console.error('[Chat] Tool loop error:', error)
          state.completeStreaming(conversationId)
          clearStreamRefs(newStreamId)
        }
      } else {
        // No tool calls - complete normally
        state.completeStreaming(conversationId)
        clearStreamRefs(streamId)
      }
    })

    const unsubError = api.onLLMStreamError((error) => {
      console.log('[useChat:error] Received:', error.streamId, 'error:', error.error)
      const state = useChatStore.getState()
      const found = state.turnFor(error.streamId)
      if (found) {
        console.log('[useChat:error] ✓ Processing error')
        // Append error to the streaming message with actionable guidance
        {
          const currentMsg = state.messageOf(found.conversationId, found.turn.messageId)
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
          state.updateMessageIn(found.conversationId, found.turn.messageId, {
            content: cleaned + `\n\nError: ${error.error}${guidance}`,
            isError: true
          })
        }
        state.completeStreaming(found.conversationId)
        clearStreamRefs(error.streamId)
      }
    })

    // No cleanup - listeners persist for app lifetime
    // This is intentional since we use module-level guard
    console.log('[useChat:listeners] Setup complete')
    return () => {
      console.log('[useChat:listeners] CLEANUP - unsubscribing all listeners')
      unsubChunk()
      unsubThinkingDelta?.()
      unsubToolCall()
      unsubToolCallStart()
      unsubComplete()
      unsubError()
      streamListenersInitialized = false
    }
  }, [])

  const sendMessage = useCallback(
    async (content: string, options?: { hidden?: boolean }): Promise<boolean> => {
      console.log('[useChat] sendMessage called with:', content?.substring(0, 50), 'isLoading:', isLoading)
      // The active conversation's own turn blocks a second send; another
      // document's turn does not.
      if (!content.trim() || useChatStore.getState().isLoading) return false
      console.log('[useChat] sendMessage passed initial check')
      // Read toolMode fresh from the store rather than relying on the
      // React-closure-captured value. Necessary because callers (notably
      // RequestModeSwitchActions' "Switch & Run" path) may setToolMode
      // and then synchronously dispatch sendMessage in the same tick —
      // React hasn't re-rendered yet, and the captured `toolMode` would
      // be stale. Reading from the store always reflects the latest.
      const toolMode = useChatStore.getState().toolMode

      // Auto-create a conversation if there isn't one
      let conversationId = useChatStore.getState().activeConversationId
      if (!conversationId) {
        conversationId = addConversation(document.documentId)
      }
      // The turn is bound to the conversation's document, the tab in front
      // of the user now (#1148): every tool call and every stream event of
      // the turn lands there, whatever tab is shown later.
      const binding: ToolBinding = {
        conversationId,
        documentId: document.documentId,
        path: document.path,
        tabId: useTabStore.getState().activeTabId
      }

      // Gate every AI request on the single availability check (consent +
      // valid config). On a blocked path, record the reason in the chat AND
      // fire a visible toast — the chat panel may be closed when this is
      // triggered from a comment/suggestion action, which is the #631 gap
      // where the user saw no feedback at all. Returning false lets callers
      // (processComment/processComments/processSuggestionReplies) preserve the
      // user's content instead of deleting it.
      const availability = aiAvailability(settings)
      if (!availability.available && availability.reason) {
        addMessage({
          id: createMessageId(),
          role: 'assistant',
          content: aiUnavailableMessage(availability.reason),
          timestamp: new Date()
        })
        notifyAINotConfigured()
        return false
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
      startStreaming(assistantMsgId, streamId, binding, conversationId)

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
        toolLoopContexts.set(streamId, {
          apiMessages,
          assistantMsgId,
          roundtripCount: 0,
          lastErrorSignature: null,
          modeJustSwitched,
          thinkingBlocks: [] // populated by the first complete event
        })
        pendingToolCalls.set(streamId, [])
      }

      console.log('[useChat] About to call llmChatStream')
      try {
        // Call streaming LLM (via Electron IPC or browser fallback)
        const api = getApi()
        console.log('[useChat] Got API, calling llmChatStream with tools:', tools?.length || 0)
        await api.llmChatStream({
          provider: settings.llm.provider,
          model: settings.llm.model,
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
          maxTokens: 16000,
          // Read fresh at send time, not from the destructured render value:
          // sendMessage is a useCallback whose deps omit thinkingEnabled, so the
          // closed-over copy goes stale the moment the user toggles thinking and
          // sends without an intervening recreate (same getState() pattern as
          // toolMode above and the tool-loop continuation). (#700)
          thinking: useChatStore.getState().thinkingEnabled
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
        useChatStore.getState().updateMessageIn(conversationId, assistantMsgId, {
          content: `Error: ${errorMessage}. ${guidance}`,
          isError: true
        })
        completeStreaming(conversationId)
        clearStreamRefs(streamId)
      }
      return true
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

  // Stop the ACTIVE conversation's turn; a turn on another document runs on.
  const stopGeneration = useCallback(() => {
    const state = useChatStore.getState()
    const conversationId = state.activeConversationId
    const turn = conversationId ? state.turns[conversationId] : undefined
    if (!conversationId || !turn) return
    const api = getApi()
    api.llmAbortStream(turn.streamId)
    // Strip orphan drafting tags before tearing down the stream — aborting
    // mid-tool-input composition would otherwise leave a perpetual chip.
    const currentMsg = state.messageOf(conversationId, turn.messageId)
    if (currentMsg?.content) {
      const cleaned = stripAllDraftingTags(currentMsg.content)
      if (cleaned !== currentMsg.content) {
        state.updateMessageIn(conversationId, turn.messageId, { content: cleaned })
      }
    }
    // Clear stream refs before completing to prevent race conditions
    clearStreamRefs(turn.streamId)
    completeStreaming(conversationId)
  }, [completeStreaming])

  const processComments = useCallback(async () => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return

    const comments = openThreadsWithPositions(editor)
    if (comments.length === 0) return

    // Build the prompt from comments. The AI uses reply_to_comment /
    // suggest_edit / resolve_comment to act on each thread — marks are not
    // removed here; the AI resolves them via tools when done.
    const commentsPrompt = buildCommentsPrompt(comments)
    await sendMessage(commentsPrompt)
  }, [sendMessage])

  // Process a single comment by id — launches the AI to read the thread and
  // decide: reply, suggest_edit, or both, then resolve when done.
  // The AI uses list_comments / reply_to_comment / suggest_edit / resolve_comment
  // rather than the host deleting the mark immediately.
  const processComment = useCallback(async (commentId: string) => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return

    const target = openThreadsWithPositions(editor).find((c) => c.id === commentId)
    if (!target) return

    const commentsPrompt = buildCommentsPrompt([target])
    // Do NOT delete the mark before or after — the AI decides when to resolve.
    await sendMessage(commentsPrompt)
  }, [sendMessage])

  // Helper to get current comment count
  const getCommentCount = useCallback(() => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return 0
    return countOpenThreads(threadsOf(editor.state))
  }, [])

  const processSuggestionReplies = useCallback(async () => {
    const editor = useEditorInstanceStore.getState().editor
    if (!editor) return

    const suggestionsWithFeedback = getSuggestionsWithFeedback(editor)
    if (suggestionsWithFeedback.length === 0) return

    // Build the prompt from suggestions with feedback
    const feedbackPrompt = buildSuggestionRepliesPrompt(suggestionsWithFeedback)

    // Only remove suggestions if the message was actually dispatched to the AI (#631)
    const dispatched = await sendMessage(feedbackPrompt)
    if (dispatched) {
      suggestionsWithFeedback.forEach((suggestion) => {
        editor.commands.rejectAISuggestion(suggestion.id)
      })
    }
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
