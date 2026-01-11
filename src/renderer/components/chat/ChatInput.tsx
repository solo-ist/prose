import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Checkbox } from '../ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { Send, Square, X, MessageSquare, Wand2, Pencil, FileText, ChevronDown } from 'lucide-react'
import { useChat } from '../../hooks/useChat'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import type { ToolMode } from '../../stores/chatStore'

interface ChatInputProps {
  onSend: (message: string) => void
  isLoading: boolean
  isStreaming?: boolean
  onStop?: () => void
}

export function ChatInput({ onSend, isLoading, isStreaming, onStop }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [commentCount, setCommentCount] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { context, setContext, includeDocument, setIncludeDocument, toolMode, setToolMode, processComments, getCommentCount, isInitializing } = useChat()
  const editor = useEditorInstanceStore((state) => state.editor)

  // Mode configuration
  const modeConfig: Record<ToolMode, { label: string; icon: typeof Wand2; description: string }> = {
    suggestions: {
      label: 'Suggestions',
      icon: FileText,
      description: 'Read-only + suggestions'
    },
    full: {
      label: 'Full',
      icon: Pencil,
      description: 'Direct edits enabled'
    },
    plan: {
      label: 'Plan',
      icon: Wand2,
      description: 'Review changes before applying'
    }
  }

  const currentMode = modeConfig[toolMode]
  const ModeIcon = currentMode.icon

  // Disable input while app is initializing (loading draft/conversations) or while loading
  const isDisabled = isLoading || isInitializing

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

  const handleSubmit = () => {
    if (message.trim() && !isDisabled) {
      onSend(message.trim())
      setMessage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd+Enter or Ctrl+Enter to send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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

      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isInitializing ? "Loading..." : "Ask about your document..."}
          className="min-h-[40px] max-h-[96px] resize-none"
          disabled={isDisabled}
        />
        {isStreaming ? (
          <Button
            size="icon"
            variant="destructive"
            onClick={onStop}
            className="shrink-0"
            aria-label="Stop generation"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!message.trim() || isDisabled}
            className="shrink-0"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={includeDocument}
                  onCheckedChange={(checked) => setIncludeDocument(checked === true)}
                />
                Full context
              </label>
            </TooltipTrigger>
            <TooltipContent>
              <p>Provide entire document as context</p>
            </TooltipContent>
          </Tooltip>

          {/* Tool Mode Selector */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ModeIcon className="h-3 w-3" />
                    {currentMode.label}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>{currentMode.description}</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              {(Object.entries(modeConfig) as [ToolMode, typeof currentMode][]).map(
                ([mode, config]) => {
                  const Icon = config.icon
                  return (
                    <DropdownMenuItem
                      key={mode}
                      onClick={() => setToolMode(mode)}
                      className="cursor-pointer"
                    >
                      <Icon className="h-4 w-4 mr-2" />
                      <div>
                        <p className="font-medium">{config.label}</p>
                        <p className="text-xs text-muted-foreground">{config.description}</p>
                      </div>
                      {mode === toolMode && (
                        <span className="ml-auto text-primary">✓</span>
                      )}
                    </DropdownMenuItem>
                  )
                }
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="text-xs text-muted-foreground">
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">
            ⌘↵
          </kbd>
        </p>
      </div>
    </div>
  )
}
