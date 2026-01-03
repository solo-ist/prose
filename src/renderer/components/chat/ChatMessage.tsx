import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { cn } from '../../lib/utils'
import type { ChatMessage as ChatMessageType } from '../../types'
import { User, Bot, Wand2, Check, AlertCircle, ArrowRight } from 'lucide-react'
import { parseEditBlocks, hasEditBlocks, stripEditBlocks, type EditBlock } from '../../lib/editBlocks'
import { applyEditsAsDiffs, applyEditsDirect, type ApplyResult, type EditProvenance } from '../../lib/applyEdit'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore } from '../../stores/chatStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'

interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
}

// Simple markdown renderer for assistant messages
function renderMarkdown(content: string): React.ReactNode {
  // Split into lines and process
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeContent: string[] = []

  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <pre key={`code-${i}`} className="my-2 rounded bg-muted p-3 overflow-x-auto">
            <code className="text-xs">{codeContent.join('\n')}</code>
          </pre>
        )
        codeContent = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      return
    }

    if (inCodeBlock) {
      codeContent.push(line)
      return
    }

    // Process inline formatting
    let processed: React.ReactNode = line

    // Bold
    if (line.includes('**')) {
      const parts = line.split(/\*\*(.+?)\*\*/g)
      processed = parts.map((part, j) =>
        j % 2 === 1 ? <strong key={j}>{part}</strong> : part
      )
    }

    // Inline code
    if (typeof processed === 'string' && processed.includes('`')) {
      const parts = processed.split(/`(.+?)`/g)
      processed = parts.map((part, j) =>
        j % 2 === 1 ? (
          <code key={j} className="rounded bg-muted px-1 py-0.5 text-xs">
            {part}
          </code>
        ) : (
          part
        )
      )
    }

    if (line === '') {
      elements.push(<br key={i} />)
    } else {
      elements.push(
        <span key={i}>
          {processed}
          {i < lines.length - 1 && <br />}
        </span>
      )
    }
  })

  return elements
}

// Component to preview edit blocks with old/new text
function EditBlockPreview({ blocks }: { blocks: EditBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block) => (
        <div
          key={block.id}
          className="rounded-md border border-border bg-muted/30 p-3 text-xs"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-muted-foreground line-through whitespace-pre-wrap break-words">
                {block.search}
              </div>
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-green-600 dark:text-green-400 whitespace-pre-wrap break-words">
                {block.replace}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}


export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const [showTimestamp, setShowTimestamp] = useState(false)
  const [applyState, setApplyState] = useState<'idle' | 'applied' | 'error'>('idle')
  const [applyResults, setApplyResults] = useState<ApplyResult[]>([])
  const appliedRef = useRef(false)
  const editor = useEditorInstanceStore((state) => state.editor)
  const agentMode = useChatStore((state) => state.agentMode)
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const documentId = useEditorStore((state) => state.document.documentId)
  const llmModel = useSettingsStore((state) => state.settings.llm.model)
  const isUser = message.role === 'user'
  const containsEdits = !isUser && hasEditBlocks(message.content)
  const editBlocks = containsEdits ? parseEditBlocks(message.content) : []
  const editCount = editBlocks.length

  // Create provenance data for AI annotation tracking
  const provenance = useMemo<EditProvenance | undefined>(() => {
    if (!llmModel || !activeConversationId) return undefined
    return {
      model: llmModel,
      conversationId: activeConversationId,
      messageId: message.id,
    }
  }, [llmModel, activeConversationId, message.id])

  // Auto-apply edits in agent mode when streaming completes
  useEffect(() => {
    if (
      agentMode &&
      containsEdits &&
      editBlocks.length > 0 &&
      editor &&
      !isStreaming &&
      !appliedRef.current &&
      applyState === 'idle'
    ) {
      appliedRef.current = true
      const results = applyEditsDirect(editor, editBlocks, provenance, documentId)
      setApplyResults(results)
      const allSucceeded = results.every((r) => r.success)
      setApplyState(allSucceeded ? 'applied' : 'error')
    }
  }, [agentMode, containsEdits, editBlocks, editor, isStreaming, applyState, provenance, documentId])

  const handleApplyEdits = useCallback(() => {
    if (!editor || !containsEdits) return

    const results = agentMode
      ? applyEditsDirect(editor, editBlocks, provenance, documentId)
      : applyEditsAsDiffs(editor, editBlocks, undefined, provenance, documentId)
    setApplyResults(results)

    const allSucceeded = results.every((r) => r.success)
    setApplyState(allSucceeded ? 'applied' : 'error')
  }, [editor, editBlocks, containsEdits, agentMode, provenance, documentId])

  // For assistant messages with edit blocks, strip them from display
  const displayContent = containsEdits ? stripEditBlocks(message.content) : message.content

  return (
    <div
      className={cn(
        'flex gap-3 p-4 transition-colors',
        isUser ? 'bg-transparent' : 'bg-muted/30'
      )}
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => setShowTimestamp(false)}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary/10' : 'bg-primary/20'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-hidden">
        {message.context && (
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            <span className="font-medium">Context:</span>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{message.context}</p>
          </div>
        )}
        <div className="text-sm leading-relaxed">
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : displayContent.trim() ? (
            <div className="prose-chat">
              {renderMarkdown(displayContent)}
              {isStreaming && (
                <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          ) : containsEdits ? (
            <p className="text-muted-foreground italic">
              Suggested {editCount} edit{editCount !== 1 ? 's' : ''} to the document.
            </p>
          ) : isStreaming ? (
            <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse" />
          ) : (
            <div className="prose-chat">{renderMarkdown(displayContent)}</div>
          )}
        </div>
        {/* Show preview only in non-agent mode */}
        {containsEdits && editBlocks.length > 0 && !agentMode && (
          <EditBlockPreview blocks={editBlocks} />
        )}
        {containsEdits && (
          <div className="flex items-center gap-2">
            {/* Show apply button only in non-agent mode */}
            {applyState === 'idle' && !agentMode && (
              <button
                onClick={handleApplyEdits}
                disabled={!editor}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  editor
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
              >
                <Wand2 className="h-3 w-3" />
                Apply {editCount} Edit{editCount !== 1 ? 's' : ''}
              </button>
            )}
            {applyState === 'applied' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" />
                {agentMode ? `Applied ${editCount} edit${editCount !== 1 ? 's' : ''}` : 'Applied to document'}
              </span>
            )}
            {applyState === 'error' && (
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3 w-3" />
                  Some edits failed
                </span>
                <ul className="text-xs text-muted-foreground">
                  {applyResults
                    .filter((r) => !r.success)
                    .map((r, i) => (
                      <li key={i} className="truncate">
                        {r.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <p
          className={cn(
            'text-xs text-muted-foreground transition-opacity duration-200',
            showTimestamp ? 'opacity-100' : 'opacity-0'
          )}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })}
        </p>
      </div>
    </div>
  )
}
