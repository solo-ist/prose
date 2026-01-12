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
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { context, setContext, toolMode, processComments, getCommentCount, isInitializing } = useChat()
  const editor = useEditorInstanceStore((state) => state.editor)

  // Disable input while app is initializing (loading draft/conversations) or while loading
  const isDisabled = isLoading || isInitializing

  // Slash command autocomplete
  const filteredCommands = useMemo(() => {
    if (!message.startsWith('/')) return []
    const query = message.slice(1).split(' ')[0].toLowerCase()
    const allCommands = [...getAvailableTools(), 'help']
    if (!query) return allCommands
    return allCommands.filter(cmd => cmd.toLowerCase().includes(query))
  }, [message])

  const showAutocomplete = message.startsWith('/') && !message.includes(' ') && filteredCommands.length > 0

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedCommandIndex(0)
  }, [filteredCommands.length])

  const selectCommand = (command: string) => {
    setMessage('/' + command + ' ')
    textareaRef.current?.focus()
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
    // /list_files ~/Documents -> { path: "~/Documents" }
    // /open_file ~/Documents/file.md -> { path: "~/Documents/file.md" }
    // /read_file ~/path -> { path: "~/path" }
    if (['list_files', 'open_file', 'read_file', 'save_file'].includes(toolName)) {
      return { toolName, args: { path: argsStr } }
    }

    // /search_document query text -> { query: "query text" }
    if (toolName === 'search_document') {
      return { toolName, args: { query: argsStr } }
    }

    // /new_file content -> { content: "content" }
    if (toolName === 'new_file') {
      return { toolName, args: { content: argsStr } }
    }

    // Default: try to use first arg as path or return empty
    return { toolName, args: argsStr ? { path: argsStr } : {} }
  }

  const handleSlashCommand = async (command: { toolName: string; args: unknown }) => {
    const { addMessage, toolMode } = useChatStore.getState()

    // Add user message showing the command
    const userMsgId = createMessageId()
    addMessage({
      id: userMsgId,
      role: 'user',
      content: message.trim(),
      timestamp: new Date()
    })

    // Add assistant message with tool execution
    const assistantMsgId = createMessageId()
    addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: `<tool-executing name="${command.toolName}">Executing...</tool-executing>`,
      timestamp: new Date()
    })

    // Execute the tool
    const result = await executeTool(command.toolName, command.args, toolMode)

    // Update the message with result
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

    // Check for slash command
    const command = parseSlashCommand(message.trim())
    if (command) {
      const availableTools = getAvailableTools()
      if (availableTools.includes(command.toolName)) {
        setMessage('')
        textareaRef.current?.focus()
        await handleSlashCommand(command)
        return
      }
      // If tool not found, show help or fall through to normal message
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
        textareaRef.current?.focus()
        return
      }
    }

    // Normal message
    onSend(message.trim())
    setMessage('')
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle autocomplete navigation
    if (showAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex(i => Math.min(i + 1, filteredCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        selectCommand(filteredCommands[selectedCommandIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMessage('')
        return
      }
    }

    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Auto-resize textarea (max 4 lines ~= 96px)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 96)}px`
    }
  }, [message])

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

      {/* Terminal-style input - no border, blends in */}
      <div className="relative">
        {/* Autocomplete dropdown */}
        {showAutocomplete && (
          <div className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {filteredCommands.map((cmd, index) => (
              <button
                key={cmd}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50",
                  index === selectedCommandIndex && "bg-muted"
                )}
                onClick={() => selectCommand(cmd)}
                onMouseEnter={() => setSelectedCommandIndex(index)}
              >
                <span className="font-mono text-foreground">/{cmd}</span>
                <span className="text-xs text-muted-foreground truncate ml-4">
                  {toolDescriptions[cmd] || ''}
                </span>
              </button>
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
