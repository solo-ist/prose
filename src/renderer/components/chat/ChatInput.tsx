import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button } from '../ui/button'
import { Square, MessageSquare, ChevronRight, X } from 'lucide-react'
import { useChat } from '../../hooks/useChat'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore, createMessageId } from '../../stores/chatStore'
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

interface ChatInputProps {
  onSend: (message: string) => void
  isLoading: boolean
  isStreaming?: boolean
  onStop?: () => void
}

export function ChatInput({ onSend, isLoading, isStreaming, onStop }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [commentCount, setCommentCount] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const { context, setContext, toolMode, processComments, getCommentCount, isInitializing } = useChat()
  const editor = useEditorInstanceStore((state) => state.editor)

  // Disable input while app is initializing (loading draft/conversations) or while loading
  const isDisabled = isLoading || isInitializing

  // All available commands
  const allCommands = useMemo(() => [...getAvailableTools(), 'help'], [])

  // Slash command autocomplete
  const filteredCommands = useMemo(() => {
    if (!message.startsWith('/')) return []
    if (message.includes(' ')) return []
    const query = message.slice(1).toLowerCase()
    if (!query) return allCommands
    return allCommands.filter(cmd => cmd.toLowerCase().includes(query))
  }, [message, allCommands])

  const showAutocomplete = filteredCommands.length > 0

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredCommands.length])

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

  // Track comment count changes
  const updateCommentCount = useCallback(() => {
    setCommentCount(getCommentCount())
  }, [getCommentCount])

  // Check for comments when editor changes or on mount
  useEffect(() => {
    if (!editor) return

    updateCommentCount()

    // Listen for editor updates
    const handleUpdate = () => updateCommentCount()
    editor.on('update', handleUpdate)
    editor.on('selectionUpdate', handleUpdate)

    return () => {
      editor.off('update', handleUpdate)
      editor.off('selectionUpdate', handleUpdate)
    }
  }, [editor, updateCommentCount])

  const handleProcessComments = () => {
    processComments()
    setCommentCount(0) // Optimistically clear count
  }

  // Parse slash commands: /tool_name arg1 arg2 or /tool_name {"json": "args"}
  const parseSlashCommand = (input: string): { toolName: string; args: unknown } | null => {
    if (!input.startsWith('/')) return null

    const trimmed = input.slice(1).trim()
    const spaceIndex = trimmed.indexOf(' ')

    if (spaceIndex === -1) {
      // Just the command, no args
      return { toolName: trimmed, args: {} }
    }

    const toolName = trimmed.slice(0, spaceIndex)
    const argsStr = trimmed.slice(spaceIndex + 1).trim()

    // Try to parse as JSON first
    if (argsStr.startsWith('{')) {
      try {
        return { toolName, args: JSON.parse(argsStr) }
      } catch {
        // Fall through to simple parsing
      }
    }

    // Simple arg parsing for common tools
    if (['list_files', 'open_file', 'read_file', 'save_file'].includes(toolName)) {
      return { toolName, args: { path: argsStr } }
    }

    if (toolName === 'search_document') {
      return { toolName, args: { query: argsStr } }
    }

    if (toolName === 'new_file') {
      return { toolName, args: { content: argsStr } }
    }

    return { toolName, args: argsStr ? { path: argsStr } : {} }
  }

  const handleSlashCommand = async (command: { toolName: string; args: unknown }) => {
    const { addMessage, toolMode } = useChatStore.getState()

    const userMsgId = createMessageId()
    addMessage({
      id: userMsgId,
      role: 'user',
      content: message.trim(),
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
  }

  const handleSubmit = async () => {
    if (!message.trim() || isDisabled) return

    const command = parseSlashCommand(message.trim())
    if (command) {
      const availableTools = getAvailableTools()
      if (availableTools.includes(command.toolName)) {
        setMessage('')
        setTimeout(() => textareaRef.current?.focus(), 0)
        await handleSlashCommand(command)
        return
      }
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
          content: '**Available commands:**\n\n' + toolList + '\n\n**Examples:**\n• `/list_files ~/Documents`\n• `/read_document`\n• `/search_document keyword`',
          timestamp: new Date()
        })
        setMessage('')
        setTimeout(() => textareaRef.current?.focus(), 0)
        return
      }
    }

    onSend(message.trim())
    setMessage('')
    // Focus after state update
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        selectCommand(filteredCommands[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // Prevent closing the chat panel
        setMessage('')
        return
      }
    }

    // Down arrow with empty input opens slash command menu
    if (e.key === 'ArrowDown' && !message) {
      e.preventDefault()
      setMessage('/')
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

      {/* Terminal-style input */}
      <div className="relative">
        {/* Autocomplete dropdown */}
        {showAutocomplete && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-md"
          >
            {filteredCommands.map((cmd, index) => (
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
