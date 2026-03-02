import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { useChat } from '../../hooks/useChat'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { MessageSquare, History, Plus, Trash2, Sparkles, Info, Loader2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useReviewStore, useReviewMode } from '../../stores/reviewStore'
import { useSummaryStore } from '../../stores/summaryStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ReviewContainer } from '../review/ReviewContainer'
import { cn } from '../../lib/utils'

export function ChatPanel() {
  const { messages, isLoading, isStreaming, sendMessage, stopGeneration, clearMessages } = useChat()
  const scrollRef = useRef<HTMLDivElement>(null)
  const reviewMode = useReviewMode()
  const [infoOpen, setInfoOpen] = useState(false)

  const {
    conversations,
    activeConversationId,
    addConversation,
    selectConversation,
    deleteConversation
  } = useChatStore()
  const document = useEditorStore((state) => state.document)
  const documentId = document.documentId
  const editor = useEditorInstanceStore((state) => state.editor)

  // Summary store
  const { summary, isGenerating, isStale, error, loadForDocument: loadSummary, generateSummary } = useSummaryStore()
  const hasApiKey = useSettingsStore((s) => !!s.settings.llm.apiKey)

  // Reading time
  const wordCount = document.content.split(/\s+/).filter((w: string) => w.length > 0).length
  const readingTime = Math.max(1, Math.round(wordCount / 200))

  // Load cached summary when panel opens or document changes
  useEffect(() => {
    if (!infoOpen || !document.documentId) return
    const content = useEditorStore.getState().document.content
    if (!content?.trim()) return
    loadSummary(document.documentId, content)
  }, [infoOpen, document.documentId, loadSummary])

  // Auto-generate if panel is open and no summary or stale
  useEffect(() => {
    if (!infoOpen || isGenerating || !hasApiKey) return
    if (!summary || isStale) {
      const content = useEditorStore.getState().document.content
      if (!content?.trim()) return
      generateSummary(document.documentId, content)
    }
  }, [infoOpen, summary, isStale, isGenerating, hasApiKey, document.documentId, generateSummary])

  // Track pending suggestion count
  const suggestionCount = useMemo(() => {
    if (!editor) return 0
    return getAISuggestions(editor).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor?.state.doc])

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



  const handleRetry = useCallback((errorMessageId: string) => {
    // Find the last user message before this error
    const msgIndex = messages.findIndex(m => m.id === errorMessageId)
    if (msgIndex < 0) return

    // Walk backwards to find the user message
    let userMessageId = ''
    let userContent = ''
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageId = messages[i].id
        userContent = messages[i].content
        break
      }
    }
    if (!userContent) return

    // Remove both the error message and the original user message
    // (sendMessage will re-add the user message)
    const { removeMessage } = useChatStore.getState()
    removeMessage(errorMessageId)
    if (userMessageId) {
      removeMessage(userMessageId)
    }

    // Resend
    sendMessage(userContent)
  }, [messages, sendMessage])

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

  if (reviewMode) {
    return (
      <div className="flex h-full flex-col bg-muted/20">
        <ReviewContainer />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Action bar */}
      <div className="flex items-center justify-end border-b border-border px-2 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", infoOpen && "bg-accent")}
              onClick={() => setInfoOpen(!infoOpen)}
              aria-label="Document info"
            >
              <Info className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Document info</TooltipContent>
        </Tooltip>
        {conversations.length > 0 && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Chat history"
                    >
                      <History className="h-3.5 w-3.5" />
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
                className="h-7 w-7"
                onClick={handleNewChat}
                aria-label="New chat"
              >
                <Plus className="h-3.5 w-3.5" />
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
                  className="h-7 w-7"
                  onClick={clearMessages}
                  aria-label="Clear chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear messages</TooltipContent>
            </Tooltip>
          )}
      </div>

      {/* Collapsible summary panel */}
      <div className={cn(
        "overflow-hidden transition-all duration-200 ease-in-out",
        infoOpen ? "max-h-60 border-b border-border" : "max-h-0"
      )}>
        <div className="mx-2 my-2 rounded-md bg-muted/50 border border-border/60 px-3 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Summary</h3>
            <span className="text-[10px] text-muted-foreground/70">~{readingTime} min read</span>
          </div>
          {isGenerating ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Generating...</span>
            </div>
          ) : error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : summary ? (
            <p className="text-xs leading-relaxed">{summary}</p>
          ) : (
            <p className="text-xs text-muted-foreground">No summary yet</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center p-8 py-16">
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
                onRetry={message.isError ? () => handleRetry(message.id) : undefined}
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
      </div>

      {/* Suggestion review chip */}
      {suggestionCount > 0 && (
        <div className="px-4 py-3">
          <button
            onClick={() => useReviewStore.getState().setReviewMode('quick')}
            className="w-full flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-600 dark:text-violet-400 transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            Review {suggestionCount} suggestion{suggestionCount !== 1 ? 's' : ''}
          </button>
        </div>
      )}

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
