import { useCallback } from 'react'
import { useChatStore, createMessageId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorStore } from '../stores/editorStore'
import { validateConfig } from '../lib/llm'
import { buildSystemPrompt } from '../lib/prompts'
import { getApi } from '../lib/browserApi'

export function useChat() {
  const {
    messages,
    isLoading,
    isPanelOpen,
    context,
    includeDocument,
    activeConversationId,
    addConversation,
    addMessage,
    updateMessage,
    clearMessages,
    setLoading,
    togglePanel,
    setPanelOpen,
    setContext,
    setIncludeDocument
  } = useChatStore()

  const { settings } = useSettingsStore()
  const { document } = useEditorStore()

  const sendMessage = useCallback(
    async (content: string) => {
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
        timestamp: new Date()
      })

      setLoading(true)

      try {
        // Build messages array for the API
        const apiMessages = messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.context
            ? `Regarding this text:\n\n> ${m.context}\n\n${m.content}`
            : m.content
        }))
        apiMessages.push({ role: 'user' as const, content: fullMessage })

        // Call LLM (via Electron IPC or browser fallback)
        const api = getApi()
        const response = await api.llmChat({
          provider: settings.llm.provider,
          model: settings.llm.model,
          apiKey: settings.llm.apiKey,
          baseUrl: settings.llm.baseUrl,
          messages: apiMessages,
          system: buildSystemPrompt(includeDocument, document.content)
        })

        // Add assistant message with the response
        const assistantMsgId = createMessageId()
        addMessage({
          id: assistantMsgId,
          role: 'assistant',
          content: response.content,
          timestamp: new Date()
        })
      } catch (error) {
        console.error('[Chat] Error:', error)
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        // Add error message as assistant response
        const errorMsgId = createMessageId()
        addMessage({
          id: errorMsgId,
          role: 'assistant',
          content: `Error: ${errorMessage}. Please check your API key in Settings (Cmd+,).`,
          timestamp: new Date()
        })
      } finally {
        setLoading(false)
      }
    },
    [
      context,
      isLoading,
      messages,
      includeDocument,
      document.content,
      document.documentId,
      settings.llm,
      activeConversationId,
      addConversation,
      addMessage,
      setLoading,
      setContext
    ]
  )

  return {
    messages,
    isLoading,
    isPanelOpen,
    context,
    includeDocument,
    sendMessage,
    updateMessage,
    clearMessages,
    togglePanel,
    setPanelOpen,
    setContext,
    setIncludeDocument
  }
}
