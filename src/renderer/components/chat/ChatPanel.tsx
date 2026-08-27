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
import { MessageSquare, History, Plus, Trash2, Sparkles, Info, Loader2, Filter, SlidersHorizontal, Eye, EyeOff, Check, ChevronUp, ChevronDown, Maximize2 } from 'lucide-react'
import { useMenuCustomization } from '../../hooks/useMenuCustomization'
import type { MenuItemDescriptor } from '../../hooks/useMenuCustomization'
import { useChatStore } from '../../stores/chatStore'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useAIConfigured } from '../../hooks/useAIConfigured'
import { useReviewStore, useReviewMode } from '../../stores/reviewStore'
import { useSummaryStore } from '../../stores/summaryStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { ReviewContainer } from '../review/ReviewContainer'
import { AIEditsHistoryPanel, activityItemVisible, DEFAULT_ACTIVITY_FILTER, requestCommentReview, type ActivityFilter } from '../editor/AIEditsHistoryPanel'
import { useAnnotationStore } from '../../extensions/ai-annotations/store'
import { useCommentStore } from '../../extensions/comments/store'
import { useSuggestionStore } from '../../extensions/ai-suggestions/store'
import { MODE_SWITCH_RUN_EVENT } from './toolResultRenderers/RequestModeSwitchResult'
import { cn } from '../../lib/utils'
import { useSettingsStore } from '../../stores/settingsStore'

export function ChatPanel() {
  const { messages, isLoading, isStreaming, sendMessage, stopGeneration, clearMessages, processComments, processSuggestionReplies, getSuggestionFeedbackCount } = useChat()
  const { settings } = useSettingsStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatTabRef = useRef<HTMLButtonElement>(null)
  const activityTabRef = useRef<HTMLButtonElement>(null)
  const reviewMode = useReviewMode()
  const [infoOpen, setInfoOpen] = useState(false)
  const [sidebarMode, setSidebarMode] = useState<'chat' | 'activity'>('chat')
  // Multi-category Activity filter. Lifted here because the funnel lives in this
  // header, but the filtering happens in AIEditsHistoryPanel. Each category
  // (open/pending/resolved threads, current/superseded edits) toggles on/off.
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER)
  const toggleFilter = useCallback(
    (key: keyof ActivityFilter) => setActivityFilter((f) => ({ ...f, [key]: !f[key] })),
    []
  )
  // Comment Review is now a top-level takeover (reviewMode === 'comments',
  // rendered by ReviewContainer via the early return below), not a child of this
  // Activity tab — so it and Quick Review toggle through one mode slot.
  // requestCommentReview() is the single entry point.

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
  const aiAvailable = useAIConfigured().available

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
    if (!infoOpen || isGenerating || !aiAvailable) return
    if (!summary || isStale) {
      const content = useEditorStore.getState().document.content
      if (!content?.trim()) return
      generateSummary(document.documentId, content)
    }
  }, [infoOpen, summary, isStale, isGenerating, aiAvailable, document.documentId, generateSummary])

  // Listen for the "Switch & Run" button in request_mode_switch tool
  // results. Renderer dispatches a CustomEvent so it doesn't have to
  // own a useChat reference; we send the agent's suggested prompt here.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt: string }>).detail
      if (detail?.prompt) {
        sendMessage(detail.prompt)
      }
    }
    window.addEventListener(MODE_SWITCH_RUN_EVENT, handler)
    return () => window.removeEventListener(MODE_SWITCH_RUN_EVENT, handler)
  }, [sendMessage])

  // Activity feed sources for the tab badge + filter affordance.
  const annotations = useAnnotationStore((s) => s.annotations)
  const annotationDocumentId = useAnnotationStore((s) => s.documentId)
  const pendingComments = useCommentStore((s) => s.pendingComments)
  const commentDocumentId = useCommentStore((s) => s.documentId)
  const suggestionHistory = useSuggestionStore((s) => s.history)
  const suggestionDocumentId = useSuggestionStore((s) => s.documentId)

  // The review stores hydrate asynchronously. Keep their records scoped to
  // the editor document so Activity and its badge cannot show a prior tab's
  // threads during a document handoff.
  const currentAnnotations = annotationDocumentId === documentId
    ? annotations.filter((annotation) => annotation.documentId === documentId)
    : []
  const currentComments = commentDocumentId === documentId ? pendingComments : []
  const currentSuggestions = suggestionDocumentId === documentId ? suggestionHistory : []

  // There's something to filter whenever any annotation, comment, or durable
  // suggestion record exists. Suggestion history is the source used by MCP and
  // survives accept/reject, so it must keep the Activity tab available even
  // after the live editor mark has been removed.
  const hasActivity = currentAnnotations.length > 0 || currentComments.length > 0 || currentSuggestions.length > 0
  // Open (unresolved) threads are the Review set.
  const openThreadCount = useMemo(() => currentComments.filter((c) => !c.resolved).length, [currentComments])
  // Any category turned off means the filter is engaged (tints the funnel).
  const isFiltering = Object.values(activityFilter).some((v) => !v)

  // Badge reflects what's currently shown under the active filter.
  const activityCount = useMemo(() => {
    const a = currentAnnotations.filter((an) => activityItemVisible({ kind: 'annotation', annotation: an }, activityFilter)).length
    const c = currentComments.filter((cm) => activityItemVisible({ kind: 'comment', comment: cm }, activityFilter)).length
    const s = currentSuggestions.filter((suggestion) => activityItemVisible({ kind: 'suggestion', suggestion }, activityFilter)).length
    return a + c + s
  }, [currentAnnotations, currentComments, currentSuggestions, activityFilter])

  // Track pending suggestion count
  const suggestionCount = useMemo(() => {
    if (!editor) return 0
    return getAISuggestions(editor).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor?.state.doc])

  // Suggestions that have user feedback awaiting a Process pass.
  const suggestionFeedbackCount = useMemo(() => {
    if (!editor) return 0
    return getSuggestionFeedbackCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor?.state.doc, getSuggestionFeedbackCount])

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

  // Roving-tabindex arrow-key navigation for the Chat/Activity tablist
  // (WAI-ARIA tabs pattern). Left/Right move focus between tabs and wrap at
  // the ends; Home/End jump to the first/last. Activation follows focus.
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const tabs = [
        { mode: 'chat' as const, ref: chatTabRef },
        { mode: 'activity' as const, ref: activityTabRef },
      ]
      const current = tabs.findIndex((t) => t.mode === sidebarMode)
      let next = current
      switch (e.key) {
        case 'ArrowRight':
          next = (current + 1) % tabs.length
          break
        case 'ArrowLeft':
          next = (current - 1 + tabs.length) % tabs.length
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = tabs.length - 1
          break
        default:
          return
      }
      e.preventDefault()
      setSidebarMode(tabs[next].mode)
      tabs[next].ref.current?.focus()
    },
    [sidebarMode]
  )

  const handleNewChat = () => {
    // Land in the chat view so the new conversation is visible, even if the
    // action was invoked from the Activity tab.
    setSidebarMode('chat')
    addConversation(documentId)
  }

  const handleSelectConversation = (conversationId: string) => {
    setSidebarMode('chat')
    selectConversation(conversationId)
  }

  const handleDeleteConversation = (
    e: React.MouseEvent,
    conversationId: string
  ) => {
    e.stopPropagation()
    deleteConversation(conversationId)
  }

  // Customizable footer items in the chat history dropdown.
  // Only static items are customizable — the conversation list is not.
  const chatHistoryFooterDescriptors: MenuItemDescriptor[] = [
    { id: 'new-chat', label: 'New Chat' },
  ]
  const {
    visibleIds: chatHistoryVisibleIds,
    hiddenIds: chatHistoryHiddenIds,
    orderedAllIds: chatHistoryOrderedIds,
    toggleHidden: toggleChatHistoryHidden,
    moveUp: moveChatHistoryUp,
    moveDown: moveChatHistoryDown,
  } = useMenuCustomization('chat-history', chatHistoryFooterDescriptors)
  const [isChatHistoryEditMode, setIsChatHistoryEditMode] = useState(false)
  const showNewChat = chatHistoryVisibleIds.includes('new-chat')

  if (reviewMode) {
    return (
      <div className="flex h-full flex-col bg-muted/20">
        <ReviewContainer />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Tab header (Chat | Activity) with the Activity count badge + filter */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <div className="flex items-center gap-3">
          <div role="tablist" aria-label="Chat panel views" className="flex items-center gap-3">
            <button
              ref={chatTabRef}
              role="tab"
              aria-selected={sidebarMode === 'chat'}
              aria-controls="chat-tabpanel"
              id="chat-tab-chat"
              tabIndex={sidebarMode === 'chat' ? 0 : -1}
              onClick={() => setSidebarMode('chat')}
              onKeyDown={handleTabKeyDown}
              className={cn(
                'text-sm border-b-2 pb-1 -mb-px transition-colors',
                sidebarMode === 'chat'
                  ? 'text-foreground border-primary font-medium'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              Chat
            </button>
            <button
              ref={activityTabRef}
              role="tab"
              aria-selected={sidebarMode === 'activity'}
              aria-controls="chat-tabpanel"
              id="chat-tab-activity"
              tabIndex={sidebarMode === 'activity' ? 0 : -1}
              onClick={() => setSidebarMode('activity')}
              onKeyDown={handleTabKeyDown}
              className={cn(
                'flex items-center gap-1.5 text-sm border-b-2 pb-1 -mb-px transition-colors',
                sidebarMode === 'activity'
                  ? 'text-foreground border-primary font-medium'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              Activity
              {activityCount > 0 && (
                <span
                  data-testid="activity-count-badge"
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary leading-none"
                >
                  {activityCount > 99 ? '99+' : activityCount}
                </span>
              )}
            </button>
          </div>

          {/* Filter: toggle any activity category on/off — only when there's
              something to filter. */}
          {sidebarMode === 'activity' && hasActivity && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'h-6 w-6',
                        isFiltering ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'
                      )}
                      aria-label="Filter activity"
                    >
                      <Filter className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Filter activity</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-52">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Comment threads
                </div>
                <FilterRow label="Open" active={activityFilter.openThreads} onClick={() => toggleFilter('openThreads')} />
                <FilterRow label="Pending" active={activityFilter.pendingThreads} onClick={() => toggleFilter('pendingThreads')} />
                <FilterRow label="Resolved" active={activityFilter.resolvedThreads} onClick={() => toggleFilter('resolvedThreads')} />
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  AI edits
                </div>
                <FilterRow label="Current" active={activityFilter.edits} onClick={() => toggleFilter('edits')} />
                <FilterRow label="Superseded" active={activityFilter.superseded} onClick={() => toggleFilter('superseded')} />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-xs"
                  onClick={() => setActivityFilter(DEFAULT_ACTIVITY_FILTER)}
                >
                  Show all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Chat actions — always visible (independent of the active tab).
            Actions whose effect lives in the chat view switch back to it. */}
        <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", sidebarMode === 'chat' && infoOpen && "bg-accent text-accent-foreground")}
                  onClick={() => {
                    // The info/summary panel only renders in the chat view —
                    // switch to it (opening info) when invoked from Activity.
                    if (sidebarMode !== 'chat') {
                      setSidebarMode('chat')
                      setInfoOpen(true)
                    } else {
                      setInfoOpen(!infoOpen)
                    }
                  }}
                  aria-label="Document info"
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Document info</TooltipContent>
            </Tooltip>
            {conversations.length > 0 && (
              <DropdownMenu onOpenChange={(open) => { if (!open) setIsChatHistoryEditMode(false) }}>
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
                {isChatHistoryEditMode ? (
                  <DropdownMenuContent
                    align="end"
                    className="w-52"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    onInteractOutside={() => setIsChatHistoryEditMode(false)}
                    onEscapeKeyDown={() => setIsChatHistoryEditMode(false)}
                  >
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground select-none">
                      Customize menu
                    </div>
                    {chatHistoryOrderedIds.map((id, idx) => {
                      const isHidden = chatHistoryHiddenIds.includes(id)
                      const label = id === 'new-chat' ? 'New Chat' : id
                      return (
                        <div
                          key={id}
                          className={`flex items-center gap-1 px-1 py-0.5 rounded-sm${isHidden ? ' opacity-40' : ''}`}
                        >
                          <div className="flex flex-col shrink-0">
                            <button
                              type="button"
                              className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25 focus:outline-none"
                              onClick={(e) => { e.stopPropagation(); moveChatHistoryUp(id) }}
                              disabled={idx === 0}
                              aria-label={`Move ${label} up`}
                              tabIndex={-1}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25 focus:outline-none"
                              onClick={(e) => { e.stopPropagation(); moveChatHistoryDown(id) }}
                              disabled={idx === chatHistoryOrderedIds.length - 1}
                              aria-label={`Move ${label} down`}
                              tabIndex={-1}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="flex flex-1 items-center gap-2 px-1 py-1 text-sm animate-wiggle select-none">
                            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{label}</span>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 h-6 w-6 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-none"
                            onClick={(e) => { e.stopPropagation(); toggleChatHistoryHidden(id) }}
                            aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
                            aria-pressed={isHidden}
                            tabIndex={-1}
                          >
                            {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="cursor-pointer font-medium"
                      onSelect={() => setIsChatHistoryEditMode(false)}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Done
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                ) : (
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
                    {showNewChat && (
                      <DropdownMenuItem onClick={handleNewChat} className="cursor-pointer">
                        <Plus className="h-4 w-4 mr-2" />
                        New Chat
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="cursor-pointer text-muted-foreground"
                      onSelect={(e) => { e.preventDefault(); setIsChatHistoryEditMode(true) }}
                    >
                      <SlidersHorizontal className="mr-2 h-4 w-4" />
                      Customize…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                )}
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
                    onClick={() => {
                      setSidebarMode('chat')
                      clearMessages()
                    }}
                    aria-label="Clear chat"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear messages</TooltipContent>
              </Tooltip>
            )}
        </div>
      </div>

      <div
        role="tabpanel"
        id="chat-tabpanel"
        aria-labelledby={sidebarMode === 'activity' ? 'chat-tab-activity' : 'chat-tab-chat'}
        className="flex-1 min-h-0 flex flex-col"
      >
        {sidebarMode === 'activity' ? (
          <AIEditsHistoryPanel
            filter={activityFilter}
            onShowAll={() => setActivityFilter(DEFAULT_ACTIVITY_FILTER)}
            onReviewThread={requestCommentReview}
          />
        ) : (
          <>
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

            {/* Action chips — share one row, expand/shrink to fit. Each shows
                only when it has work to offer. */}
            {(openThreadCount > 0 || suggestionCount > 0 || suggestionFeedbackCount > 0) && (
              <div className="flex flex-wrap items-stretch gap-2 px-4 py-3">
                {openThreadCount > 0 && (
                  <ActionChip
                    icon={<Sparkles className="h-3.5 w-3.5 shrink-0" />}
                    verb="Process"
                    noun={openThreadCount === 1 ? 'comment' : 'comments'}
                    count={openThreadCount}
                    variant="violet"
                    title={`Run the AI over all ${openThreadCount} open comment threads`}
                    onClick={() => processComments()}
                  />
                )}
                {openThreadCount > 0 && (
                  <ActionChip
                    icon={<MessageSquare className="h-3.5 w-3.5 shrink-0" />}
                    verb="Review"
                    noun={openThreadCount === 1 ? 'comment' : 'comments'}
                    count={openThreadCount}
                    variant="neutral"
                    title={`Review ${openThreadCount} open comment ${openThreadCount === 1 ? 'thread' : 'threads'} one at a time`}
                    onClick={() => requestCommentReview()}
                  />
                )}
                {suggestionCount > 0 && (
                  <ActionChip
                    icon={<Maximize2 className="h-3.5 w-3.5 shrink-0" />}
                    verb="Review"
                    noun={suggestionCount === 1 ? 'suggestion' : 'suggestions'}
                    count={suggestionCount}
                    variant="neutral"
                    title={`Review ${suggestionCount} AI suggestion${suggestionCount === 1 ? '' : 's'}`}
                    onClick={() => useReviewStore.getState().setReviewMode('quick')}
                  />
                )}
                {suggestionFeedbackCount > 0 && (
                  <ActionChip
                    icon={<Sparkles className="h-3.5 w-3.5 shrink-0" />}
                    verb="Process"
                    noun="feedback"
                    count={suggestionFeedbackCount}
                    variant="violet"
                    title={`Send your feedback on ${suggestionFeedbackCount} suggestion${suggestionFeedbackCount === 1 ? '' : 's'} to the AI`}
                    onClick={() => processSuggestionReplies()}
                  />
                )}
              </div>
            )}

            {/* Input */}
            <ChatInput
              onSend={sendMessage}
              isLoading={isLoading}
              isStreaming={isStreaming}
              onStop={stopGeneration}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** A shared-width action chip above the input (Process Comments / Review
 *  Comments / Review Suggestions). flex-1 so several share the row; the label
 *  truncates when space is tight, the icon + count stay. */
function ActionChip({
  icon,
  verb,
  noun,
  count,
  variant,
  title,
  onClick,
}: {
  icon: React.ReactNode
  verb: string
  /** Final noun, already pluralized by the caller (e.g. "comments", "feedback"). */
  noun: string
  count: number
  variant: 'neutral' | 'violet'
  title?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
        variant === 'violet'
          ? 'border-violet-500/30 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-400'
          : 'border-border bg-muted/40 text-foreground/80 hover:bg-muted'
      )}
    >
      {icon}
      <span className="truncate">
        {verb} {count} {noun}
      </span>
    </button>
  )
}

/** A toggle row in the Activity filter menu — label + check when active. The
 *  menu stays open on click so several categories can be toggled in one go. */
function FilterRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault()
        onClick()
      }}
      className="flex cursor-pointer items-center justify-between text-xs"
    >
      <span className={cn(!active && 'text-muted-foreground')}>{label}</span>
      {active && <Check className="h-3.5 w-3.5" />}
    </DropdownMenuItem>
  )
}
