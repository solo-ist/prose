import { useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'

export function useChat() {
  const {
    messages,
    isLoading,
    isPanelOpen,
    context,
    addMessage,
    updateMessage,
    clearMessages,
    setLoading,
    togglePanel,
    setPanelOpen,
    setContext
  } = useChatStore()

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return

      // Get context from store and clear it
      const messageContext = context
      setContext(null)

      // Add user message
      addMessage({
        role: 'user',
        content,
        context: messageContext || undefined
      })

      setLoading(true)

      try {
        // TODO: Implement actual LLM calls
        // For now, echo back the message
        await new Promise((resolve) => setTimeout(resolve, 500))

        addMessage({
          role: 'assistant',
          content: `I received your message: "${content}"${messageContext ? `\n\nWith context: "${messageContext.slice(0, 100)}${messageContext.length > 100 ? '...' : ''}"` : ''}`
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
    [context, isLoading, addMessage, setLoading, setContext]
  )

  return {
    messages,
    isLoading,
    isPanelOpen,
    context,
    sendMessage,
    updateMessage,
    clearMessages,
    togglePanel,
    setPanelOpen,
    setContext
  }
}
