import { useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { createLLMProvider } from '../lib/llm'

export function useChat() {
  const {
    messages,
    isLoading,
    isPanelOpen,
    addMessage,
    updateMessage,
    clearMessages,
    setLoading,
    togglePanel,
    setPanelOpen
  } = useChatStore()

  const { settings } = useSettingsStore()

  const sendMessage = useCallback(
    async (content: string, context?: string) => {
      if (!content.trim() || isLoading) return

      // Add user message
      addMessage({
        role: 'user',
        content,
        context
      })

      setLoading(true)

      try {
        const provider = createLLMProvider(settings.llm)
        const llmMessages = messages.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.context
            ? `Context:\n${msg.context}\n\nMessage:\n${msg.content}`
            : msg.content
        }))

        // Add the new message
        llmMessages.push({
          role: 'user',
          content: context ? `Context:\n${context}\n\nMessage:\n${content}` : content
        })

        const response = await provider.chat(llmMessages)

        addMessage({
          role: 'assistant',
          content: response.content
        })
      } catch (error) {
        console.error('Failed to send message:', error)
        addMessage({
          role: 'assistant',
          content: 'Sorry, there was an error processing your request.'
        })
      } finally {
        setLoading(false)
      }
    },
    [messages, isLoading, settings.llm, addMessage, setLoading]
  )

  return {
    messages,
    isLoading,
    isPanelOpen,
    sendMessage,
    updateMessage,
    clearMessages,
    togglePanel,
    setPanelOpen
  }
}
