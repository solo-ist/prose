import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button } from '../ui/button'
import { Square, MessageSquare, ChevronRight, X, Sparkles } from 'lucide-react'
import { useChat } from '../../hooks/useChat'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore, createMessageId } from '../../stores/chatStore'
import { useCommandHistoryStore } from '../../stores/commandHistoryStore'
import { executeTool, getAvailableTools } from '../../lib/tools'
import { cn } from '../../lib/utils'

// Tool descriptions for autocomplete
const toolDescriptions: Record<string, string> = {
  read_document: 'Read current document content',
  read_selection: 'Read selected text',
  get_metadata: 'Get document metadata',
  search_document: 'Search in document',
  get_outline: 'Get document outline/headings',
  edit: 'Replace text in document',
  insert: 'Insert text at position',
  suggest_edit: 'Suggest an edit (plan mode)',
  accept_diff: 'Accept a suggested diff',
  reject_diff: 'Reject a suggested diff',
  list_diffs: 'List pending diffs',
  open_file: 'Open a file',
  new_file: 'Create new file',
  save_file: 'Save to file',
  list_files: 'List files in directory',
  read_file: 'Read file contents',
  help: 'Show available commands'
}

// Commands that require arguments (no-arg will show echo)
const noArgEchoMessages: Record<string, string> = {
  search_document: 'Usage: `/search_document <query>` — requires a search query',
  edit: 'Usage: `/edit {"search": "...", "replace": "..."}` — requires search/replace args',
  insert: 'Usage: `/insert <text>` — what would you like to insert?',
  suggest_edit: 'Usage: `/suggest_edit {"search": "...", "replace": "..."}` — what do you want to improve?'
}

// Commands that work without args (return content from current document)
const noArgCommands = [
  'read_document',
  'read_selection',
  'get_metadata',
  'get_outline',
  'list_diffs',
  'accept_diff',
  'reject_diff',
  'help'
]

// Direct-exec commands: executed immediately without LLM interpretation
// These are instant operations that don't need natural language explanation
const directExecCommands = [
  'help',
  'list_diffs',
  'accept_diff',
  'reject_diff'
]

// Transform slash commands to natural language for LLM interpretation
function transformToNaturalLanguage(toolName: string, rawArg?: string): string {
  const arg = rawArg?.trim() || ''

  switch (toolName) {
    case 'read_document':
      return 'Read the current document and summarize what it contains.'
    case 'read_selection':
      return 'Read the currently selected text in the document.'
    case 'get_metadata':
      return 'Get the metadata for the current document (file path, word count, etc.).'
    case 'get_outline':
      return 'Get the document outline showing the heading structure.'
    case 'search_document':
      return arg ? `Search for "${arg}" in this document.` : 'Search the document for...'
    case 'insert':
      return arg ? `Insert the following text into the document: ${arg}` : 'Insert text into the document...'
    case 'edit':
      return arg ? `Edit the document with: ${arg}` : 'Edit the document...'
    case 'suggest_edit':
      return arg ? `Suggest an edit to the document: ${arg}` : 'Suggest an edit to the document...'
    case 'open_file':
      return arg ? `Open the file: ${arg}` : 'Open a file...'
    case 'new_file':
      return arg ? `Create a new file with this content: ${arg}` : 'Create a new file.'
    case 'save_file':
      return arg ? `Save the document to: ${arg}` : 'Save the document.'
    case 'list_files':
      return arg ? `List the files in: ${arg}` : 'List files in the current directory.'
    case 'read_file':
      return arg ? `Read the contents of: ${arg}` : 'Read a file...'
    default:
      return arg ? `/${toolName} ${arg}` : `/${toolName}`
  }
}

interface ChatInputProps {
  onSend: (message: string) => void
  isLoading: boolean
  isStreaming?: boolean
  onStop?: () => void
}

export function ChatInput({ onSend, isLoading, isStreaming, onStop }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [commentCount, setCommentCount] = useState(0)
  const [suggestionFeedbackCount, setSuggestionFeedbackCount] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const { context, setContext, toolMode, processComments, getCommentCount, processSuggestionReplies, getSuggestionFeedbackCount, isInitializing } = useChat()
  const editor = useEditorInstanceStore((state) => state.editor)
  const { addArg, getRecentArgs, clearHistory } = useCommandHistoryStore()

  // Disable input while app is initializing (loading draft/conversations) or while loading
  const isDisabled = isLoading || isInitializing

  // All available commands
  const allCommands = useMemo(() => [...getAvailableTools(), 'help'], [])

  // Parse the current command from input (e.g., "/list_files " -> "list_files")
  const activeCommand = useMemo(() => {
    if (!message.startsWith('/')) return null
    const match = message.match(/^\/(\w+)\s/)
    return match ? match[1] : null
  }, [message])

  // Get history suggestions for the active command
  const historySuggestions = useMemo(() => {
    if (!activeCommand) return []
    return getRecentArgs(activeCommand, 5)
  }, [activeCommand, getRecentArgs])

  // Slash command autocomplete
  const filteredCommands = useMemo(() => {
    if (!message.startsWith('/')) return []
    if (message.includes(' ')) return []
    const query = message.slice(1).toLowerCase()
    if (!query) return allCommands
    return allCommands.filter(cmd => cmd.toLowerCase().includes(query))
  }, [message, allCommands])

  const showCommandAutocomplete = filteredCommands.length > 0
  const showHistoryAutocomplete = historySuggestions.length > 0 && !showCommandAutocomplete
  const showAutocomplete = showCommandAutocomplete || showHistoryAutocomplete

  // Combined list for keyboard navigation
  const autocompleteItems = showCommandAutocomplete ? filteredCommands : historySuggestions

  // Reset selection when list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredCommands.length, historySuggestions.length])

  // Scroll selected item into view (manual calculation for precise control)
  useEffect(() => {
    if (!showAutocomplete) return
    const item = itemRefs.current.get(selectedIndex)
    if (!item) return

    const container = item.parentElement
    if (!container) return

    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    const containerTop = container.scrollTop
    const containerBottom = containerTop + container.clientHeight

    // Scroll down: item bottom is below visible area
    if (itemBottom > containerBottom) {
      container.scrollTop = itemBottom - container.clientHeight
    }
    // Scroll up: item top is above visible area
    else if (itemTop < containerTop) {
      container.scrollTop = itemTop
    }
  }, [selectedIndex, showAutocomplete])

  const selectCommand = (command: string) => {
    setMessage('/' + command + ' ')
    // Focus after state update
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const selectHistoryItem = (arg: string) => {
    if (!activeCommand) return
    setMessage('/' + activeCommand + ' ' + arg)
    // Focus after state update
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  // Track comment count changes
  const updateCommentCount = useCallback(() => {
    setCommentCount(getCommentCount())
  }, [getCommentCount])

  // Track suggestion feedback count changes
  const updateSuggestionFeedbackCount = useCallback(() => {
    setSuggestionFeedbackCount(getSuggestionFeedbackCount())
  }, [getSuggestionFeedbackCount])

  // Check for comments and suggestion feedback when editor changes or on mount
  useEffect(() => {
    if (!editor) return

    updateCommentCount()
    updateSuggestionFeedbackCount()

    // Listen for editor updates
    const handleUpdate = () => {
      updateCommentCount()
      updateSuggestionFeedbackCount()
    }
    editor.on('update', handleUpdate)
    editor.on('selectionUpdate', handleUpdate)

    return () => {
      editor.off('update', handleUpdate)
      editor.off('selectionUpdate', handleUpdate)
    }
  }, [editor, updateCommentCount, updateSuggestionFeedbackCount])

  const handleProcessComments = () => {
    processComments()
    setCommentCount(0) // Optimistically clear count
  }

  const handleProcessSuggestionFeedback = () => {
    processSuggestionReplies()
    setSuggestionFeedbackCount(0) // Optimistically clear count
  }

  // Parse slash commands: /tool_name [args]
  // With hybrid routing, LLM handles complex argument interpretation
  // We only need to parse args for direct-exec commands
  const parseSlashCommand = (input: string): { toolName: string; args: unknown; rawArg?: string } | null => {
    if (!input.startsWith('/')) return null

    const trimmed = input.slice(1).trim()
    const spaceIndex = trimmed.indexOf(' ')

    if (spaceIndex === -1) {
      // Just the command, no args
      return { toolName: trimmed, args: {} }
    }

    const toolName = trimmed.slice(0, spaceIndex)
    const argsStr = trimmed.slice(spaceIndex + 1).trim()

    // For direct-exec commands, parse specific args
    if (toolName === 'accept_diff' || toolName === 'reject_diff') {
      // Optional diff ID argument
      return { toolName, args: argsStr ? { id: argsStr } : {}, rawArg: argsStr || undefined }
    }

    if (toolName === 'list_diffs') {
      // No args needed
      return { toolName, args: {}, rawArg: undefined }
    }

    // For all other commands (LLM-mediated), just preserve the raw arg
    // The LLM will interpret the natural language
    return { toolName, args: {}, rawArg: argsStr || undefined }
  }

  const handleSlashCommand = async (command: { toolName: string; args: unknown; rawArg?: string }, originalMessage?: string) => {
    const { addMessage, toolMode } = useChatStore.getState()

    // Use originalMessage if provided (for direct-exec commands where message was already cleared)
    const userContent = originalMessage ?? message.trim()

    const userMsgId = createMessageId()
    addMessage({
      id: userMsgId,
      role: 'user',
      content: userContent,
      timestamp: new Date()
    })

    const assistantMsgId = createMessageId()
    addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: `<tool-executing name="${command.toolName}">Executing...</tool-executing>`,
      timestamp: new Date()
    })

    const result = await executeTool(command.toolName, command.args, toolMode)

    const resultText = result.success
      ? (typeof result.data === 'string'
          ? result.data
          : '```json\n' + JSON.stringify(result.data, null, 2) + '\n```')
      : `Error: ${result.error}`

    useChatStore.getState().updateMessage(assistantMsgId, {
      content: `<tool-result name="${command.toolName}" success="${result.success}">${resultText}</tool-result>`
    })

    // Save argument to history on success
    if (result.success && command.rawArg) {
      addArg(command.toolName, command.rawArg)
    }
  }

  const handleSubmit = async () => {
    if (!message.trim() || isDisabled) return

    const command = parseSlashCommand(message.trim())
    if (command) {
      const availableTools = getAvailableTools()

      // Handle /help specially (always direct-exec)
      if (command.toolName === 'help' || command.toolName === '?') {
        const { addMessage } = useChatStore.getState()
        addMessage({
          id: createMessageId(),
          role: 'user',
          content: '/help',
          timestamp: new Date()
        })
        const toolList = availableTools.map(t => '• /' + t).join('\n')
        addMessage({
          id: createMessageId(),
          role: 'assistant',
          content: '**Available commands:**\n\n' + toolList + '\n\n**Examples:**\n• `/list_files ~/Documents`\n• `/read_document`\n• `/search_document keyword`\n\n*Tip: Most commands are interpreted by the AI for better results.*',
          timestamp: new Date()
        })
        setMessage('')
        setTimeout(() => textareaRef.current?.focus(), 0)
        return
      }

      // Check if this is a valid tool
      if (availableTools.includes(command.toolName)) {
        // Check for no-arg echo messages (commands that require arguments)
        if (!command.rawArg) {
          const echoMessage = noArgEchoMessages[command.toolName]
          if (echoMessage) {
            const { addMessage } = useChatStore.getState()
            addMessage({
              id: createMessageId(),
              role: 'user',
              content: message.trim(),
              timestamp: new Date()
            })
            addMessage({
              id: createMessageId(),
              role: 'assistant',
              content: echoMessage,
              timestamp: new Date()
            })
            setMessage('')
            setTimeout(() => textareaRef.current?.focus(), 0)
            return
          }
        }

        // Route based on command type: direct-exec vs LLM-mediated
        if (directExecCommands.includes(command.toolName)) {
          // Direct execution - instant, no LLM
          // Capture message before clearing (handleSlashCommand needs it for user message display)
          const originalMessage = message.trim()
          setMessage('')
          setTimeout(() => textareaRef.current?.focus(), 0)
          await handleSlashCommand(command, originalMessage)
          return
        } else {
          // LLM-mediated - transform to natural language and send to LLM
          const naturalLanguage = transformToNaturalLanguage(command.toolName, command.rawArg)
          setMessage('')
          setTimeout(() => textareaRef.current?.focus(), 0)
          onSend(naturalLanguage)
          return
        }
      }
    }

    onSend(message.trim())
    setMessage('')
    // Focus after state update
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd+K clears command history
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      clearHistory()
      return
    }

    if (showAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % autocompleteItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + autocompleteItems.length) % autocompleteItems.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        if (showCommandAutocomplete) {
          selectCommand(filteredCommands[selectedIndex])
        } else if (showHistoryAutocomplete) {
          // Tab: just insert the history item for further editing
          // Enter: insert AND submit immediately using hybrid routing
          const selectedArg = historySuggestions[selectedIndex]
          if (e.key === 'Enter' && activeCommand) {
            // Build the full command and submit via hybrid routing
            const fullCommand = '/' + activeCommand + ' ' + selectedArg
            setMessage(fullCommand)
            // Let handleSubmit process with hybrid routing
            setTimeout(() => handleSubmit(), 0)
          } else {
            selectHistoryItem(selectedArg)
          }
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // Prevent closing the chat panel
        setMessage('')
        return
      }
    }

    // Down arrow with empty input opens slash command menu (start at top)
    if (e.key === 'ArrowDown' && !message) {
      e.preventDefault()
      setMessage('/')
      return
    }

    // Up arrow with empty input opens slash command menu (start at bottom)
    if (e.key === 'ArrowUp' && !message) {
      e.preventDefault()
      setMessage('/')
      // Set to last index after commands are computed in next render
      setTimeout(() => setSelectedIndex(allCommands.length - 1), 0)
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 96)}px`
    }
  }, [message])

  // Focus input when streaming completes
  const wasStreaming = useRef(false)
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) {
      textareaRef.current?.focus()
    }
    wasStreaming.current = isStreaming ?? false
  }, [isStreaming])

  return (
    <div className="border-t border-border p-4">
      {/* Context block */}
      {context && (
        <div className="mb-3 rounded-md bg-muted/50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Context
              </p>
              <p className="text-sm text-foreground/80 line-clamp-3 whitespace-pre-wrap">
                {context}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => setContext(null)}
              aria-label="Clear context"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Process Comments button */}
      {commentCount > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleProcessComments}
          disabled={isLoading}
          className="mb-2 w-full justify-start gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Process {commentCount} comment{commentCount !== 1 ? 's' : ''}
        </Button>
      )}

      {/* Process Suggestion Feedback button */}
      {suggestionFeedbackCount > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleProcessSuggestionFeedback}
          disabled={isLoading}
          className="mb-2 w-full justify-start gap-2 bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30"
        >
          <Sparkles className="h-4 w-4 text-purple-500" />
          Process {suggestionFeedbackCount} suggestion feedback{suggestionFeedbackCount !== 1 ? 's' : ''}
        </Button>
      )}

      {/* Terminal-style input */}
      <div className="relative">
        {/* Autocomplete dropdown */}
        {showAutocomplete && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-md"
          >
            {showCommandAutocomplete && filteredCommands.map((cmd, index) => (
              <div
                key={cmd}
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el)
                  else itemRefs.current.delete(index)
                }}
                role="option"
                aria-selected={index === selectedIndex}
                className={cn(
                  "flex items-center justify-between px-3 py-2 text-sm cursor-pointer",
                  index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
                )}
                onClick={() => selectCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="font-mono">/{cmd}</span>
                <span className="text-xs text-muted-foreground truncate ml-4">
                  {toolDescriptions[cmd] || ''}
                </span>
              </div>
            ))}
            {showHistoryAutocomplete && (
              <>
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
                  Recent arguments
                </div>
                {historySuggestions.map((arg, index) => (
                  <div
                    key={arg}
                    ref={(el) => {
                      if (el) itemRefs.current.set(index, el)
                      else itemRefs.current.delete(index)
                    }}
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={cn(
                      "flex items-center px-3 py-2 text-sm cursor-pointer font-mono",
                      index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
                    )}
                    onClick={() => selectHistoryItem(arg)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <span className="truncate">{arg}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 px-3 py-2">
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isInitializing ? "Loading..." : "Ask about your document..."}
            className="flex-1 min-h-[24px] max-h-[96px] resize-none bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            disabled={isDisabled}
            rows={1}
          />
          {isStreaming && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onStop}
              className="shrink-0 h-6 w-6 text-destructive hover:text-destructive hover:bg-transparent"
              aria-label="Stop generation"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
