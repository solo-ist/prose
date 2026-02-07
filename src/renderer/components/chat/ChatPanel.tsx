import { useRef, useEffect } from 'react'
import { useChat } from '../../hooks/useChat'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { MessageSquare, History, Plus, Trash2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useEditorStore } from '../../stores/editorStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

// Track which documents have been auto-prompted this session
const autoPromptedDocs = new Set<string>()

export function ChatPanel() {
  const { messages, isLoading, isStreaming, isInitializing, sendMessage, stopGeneration, clearMessages } = useChat()
  const scrollRef = useRef<HTMLDivElement>(null)

  const {
    conversations,
    activeConversationId,
    addConversation,
    selectConversation,
    deleteConversation
  } = useChatStore()
  const document = useEditorStore((state) => state.document)
  const documentId = document.documentId

  // Filter out hidden messages for display
  const visibleMessages = messages.filter((m) => !m.hidden)

  // Get the last message content to trigger scroll during streaming
  const lastMessageContent = messages[messages.length - 1]?.content

  // Auto-scroll to bottom on new messages or streaming content updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading, isStreaming, lastMessageContent])

  // Auto-prompt when panel opens for a document with content but no chat history
  useEffect(() => {
    const hasContent = document.content.trim().length > 0
    const hasNoHistory = conversations.length === 0
    const notYetPrompted = !autoPromptedDocs.has(documentId)
    const appReady = !isInitializing

    if (hasContent && hasNoHistory && notYetPrompted && appReady) {
      autoPromptedDocs.add(documentId)
      sendMessage('What is this?', { hidden: true })
    }
  }, [documentId, document.content, conversations.length, isInitializing, sendMessage])

  const handleNewChat = () => {
    addConversation(documentId)
  }

  const handleSelectConversation = (conversationId: string) => {
    selectConversation(conversationId)
  }

  const handleDeleteConversation = (
    e: React.MouseEvent,
    conversationId: string
  ) => {
    e.stopPropagation()
    deleteConversation(conversationId)
  }

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pl-4 pr-3 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Chat</h2>
        </div>
        <div className="flex items-center gap-1">
          {conversations.length > 0 && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Chat history"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Chat history</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-64">
                {conversations.map((conversation) => (
                  <DropdownMenuItem
                    key={conversation.id}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                    onClick={() => handleSelectConversation(conversation.id)}
                  >
                    <span
                      className={`truncate flex-1 ${
                        conversation.id === activeConversationId
                          ? 'font-medium'
                          : ''
                      }`}
                    >
                      {conversation.title ?? 'New Chat'}
                    </span>
                    {conversations.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 opacity-50 hover:opacity-100"
                        onClick={(e) =>
                          handleDeleteConversation(e, conversation.id)
                        }
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleNewChat} className="cursor-pointer">
                  <Plus className="h-4 w-4 mr-2" />
                  New Chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleNewChat}
                aria-label="New chat"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
          {visibleMessages.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={clearMessages}
                  aria-label="Clear chat"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear messages</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" viewportRef={scrollRef}>
        {visibleMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="text-center">
              <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground/30" />
              <p className="mt-4 text-sm text-muted-foreground">
                No messages yet
              </p>
              <p className="mt-2 text-xs text-muted-foreground/60">
                Select text and press{' '}
                <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  ⌘⇧K
                </kbd>{' '}
                to add context
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {visibleMessages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={
                  isStreaming &&
                  index === visibleMessages.length - 1 &&
                  message.role === 'assistant'
                }
              />
            ))}
            {/* Show "Thinking..." only when loading but not yet streaming */}
            {isLoading && !isStreaming && (
              <div className="flex gap-3 p-4 bg-muted/30">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <div className="h-4 w-4 animate-pulse rounded-full bg-primary/50" />
                </div>
                <div className="flex items-center">
                  <span className="text-sm text-muted-foreground">
                    Thinking...
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        isLoading={isLoading}
        isStreaming={isStreaming}
        onStop={stopGeneration}
      />
    </div>
  )
}
