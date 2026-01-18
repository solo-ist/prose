import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { cn } from '../../lib/utils'
import type { ChatMessage as ChatMessageType } from '../../types'
import { User, Bot, Wand2, Check, AlertCircle, ArrowRight, Sparkles, CheckCircle2, XCircle } from 'lucide-react'
import { parseEditBlocks, hasEditBlocks, stripEditBlocks, type EditBlock } from '../../lib/editBlocks'
import { applyEditsAsDiffs, applyEditsDirect, type ApplyResult, type EditProvenance } from '../../lib/applyEdit'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore } from '../../stores/chatStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'

// Tool call indicator component with AI sparkle styling
function ToolCallIndicator({ name, status, children }: { name: string; status: 'executing' | 'success' | 'error'; children?: React.ReactNode }) {
  return (
    <div className="my-2 rounded-md border border-border bg-muted/20 overflow-hidden">
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 text-xs font-medium",
        status === 'executing' && "text-violet-600 dark:text-violet-400 bg-violet-500/5",
        status === 'success' && "text-emerald-600 dark:text-emerald-400 bg-emerald-500/5",
        status === 'error' && "text-red-600 dark:text-red-400 bg-red-500/5"
      )}>
        {status === 'executing' ? (
          <>
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            <span className="animate-pulse">{name}...</span>
          </>
        ) : status === 'success' ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{name}</span>
          </>
        ) : (
          <>
            <XCircle className="h-3.5 w-3.5" />
            <span>{name}</span>
          </>
        )}
      </div>
      {children && (
        <div className="px-3 py-2 text-xs font-mono text-muted-foreground border-t border-border bg-muted/10 max-h-48 overflow-auto">
          {children}
        </div>
      )}
    </div>
  )
}

// Parse tool tags from content
function parseToolTags(content: string): { type: 'text' | 'tool-executing' | 'tool-result' | 'tool-inline'; name?: string; success?: boolean; content: string }[] {
  const parts: { type: 'text' | 'tool-executing' | 'tool-result' | 'tool-inline'; name?: string; success?: boolean; content: string }[] = []

  // Match tool-executing tags
  const executingRegex = /<tool-executing name="([^"]+)">([^<]*)<\/tool-executing>/g
  // Match tool-result tags
  const resultRegex = /<tool-result name="([^"]+)" success="([^"]+)">([^]*?)<\/tool-result>/g
  // Match inline tool results from streaming: *[Tool: name] result*
  const inlineRegex = /\*\[Tool: ([^\]]+)\] ([^*]+)\*/g

  let lastIndex = 0
  let remaining = content

  // First pass: extract tool-executing
  remaining = remaining.replace(executingRegex, (match, name, text, offset) => {
    return `\x00TOOL_EXEC:${name}:${text}\x00`
  })

  // Second pass: extract tool-result
  remaining = remaining.replace(resultRegex, (match, name, success, text) => {
    return `\x00TOOL_RESULT:${name}:${success}:${text}\x00`
  })

  // Third pass: extract inline tool results
  remaining = remaining.replace(inlineRegex, (match, name, result) => {
    return `\x00TOOL_INLINE:${name}:${result}\x00`
  })

  // Split and process
  const segments = remaining.split('\x00').filter(Boolean)
  for (const segment of segments) {
    if (segment.startsWith('TOOL_EXEC:')) {
      const [, name, text] = segment.match(/TOOL_EXEC:([^:]+):(.*)/) || []
      parts.push({ type: 'tool-executing', name, content: text || '' })
    } else if (segment.startsWith('TOOL_RESULT:')) {
      // Use [\s\S]* instead of .* to match multiline content (JSON with newlines)
      const match = segment.match(/TOOL_RESULT:([^:]+):([^:]+):([\s\S]*)/)
      if (match) {
        const [, name, success, text] = match
        parts.push({ type: 'tool-result', name, success: success === 'true', content: text })
      }
    } else if (segment.startsWith('TOOL_INLINE:')) {
      // Use [\s\S]* for multiline content consistency
      const [, name, result] = segment.match(/TOOL_INLINE:([^:]+):([\s\S]*)/) || []
      parts.push({ type: 'tool-inline', name, success: !result?.toLowerCase().includes('error'), content: result || '' })
    } else {
      parts.push({ type: 'text', content: segment })
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', content }]
}

interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
}

// Process inline formatting for a line
function processInlineFormatting(text: string, keyPrefix: string): React.ReactNode {
  // Order matters: bold (**) before italic (*) to avoid conflicts
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  // Process bold first
  const boldRegex = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let match

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(<strong key={`${keyPrefix}-b-${key++}`}>{match[1]}</strong>)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  if (parts.length === 0) {
    parts.push(text)
  }

  // Now process italic on the text parts (not already processed bold)
  const processItalic = (node: React.ReactNode, idx: number): React.ReactNode => {
    if (typeof node !== 'string') return node

    const italicRegex = /\*([^*]+)\*/g
    const italicParts: React.ReactNode[] = []
    let italicLastIndex = 0
    let italicMatch

    while ((italicMatch = italicRegex.exec(node)) !== null) {
      if (italicMatch.index > italicLastIndex) {
        italicParts.push(node.slice(italicLastIndex, italicMatch.index))
      }
      italicParts.push(<em key={`${keyPrefix}-i-${idx}-${italicParts.length}`}>{italicMatch[1]}</em>)
      italicLastIndex = italicMatch.index + italicMatch[0].length
    }

    if (italicLastIndex < node.length) {
      italicParts.push(node.slice(italicLastIndex))
    }

    return italicParts.length > 0 ? italicParts : node
  }

  // Process inline code on all remaining string parts
  const processCode = (node: React.ReactNode, idx: number): React.ReactNode => {
    if (typeof node !== 'string') return node

    const codeRegex = /`([^`]+)`/g
    const codeParts: React.ReactNode[] = []
    let codeLastIndex = 0
    let codeMatch

    while ((codeMatch = codeRegex.exec(node)) !== null) {
      if (codeMatch.index > codeLastIndex) {
        codeParts.push(node.slice(codeLastIndex, codeMatch.index))
      }
      codeParts.push(
        <code key={`${keyPrefix}-c-${idx}-${codeParts.length}`} className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
          {codeMatch[1]}
        </code>
      )
      codeLastIndex = codeMatch.index + codeMatch[0].length
    }

    if (codeLastIndex < node.length) {
      codeParts.push(node.slice(codeLastIndex))
    }

    return codeParts.length > 0 ? codeParts : node
  }

  // Apply transformations
  return parts.flatMap((part, idx) => {
    const withItalic = processItalic(part, idx)
    if (Array.isArray(withItalic)) {
      return withItalic.flatMap((p, i) => processCode(p, idx * 100 + i))
    }
    return processCode(withItalic, idx)
  })
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
            <code className="text-xs font-mono">{codeContent.join('\n')}</code>
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
    const processed = processInlineFormatting(line, `line-${i}`)

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
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words">{message.context}</p>
          </div>
        )}
        <div className="text-sm leading-relaxed">
          {isUser ? (
            <p className="whitespace-pre-wrap break-words font-mono">{message.content}</p>
          ) : (() => {
            // Parse tool tags for assistant messages
            const toolParts = parseToolTags(displayContent)
            const hasToolParts = toolParts.some(p => p.type !== 'text')

            if (hasToolParts) {
              return (
                <div className="prose-chat space-y-2 break-words">
                  {toolParts.map((part, idx) => {
                    if (part.type === 'tool-executing') {
                      return (
                        <ToolCallIndicator key={idx} name={part.name || 'tool'} status="executing" />
                      )
                    }
                    if (part.type === 'tool-result' || part.type === 'tool-inline') {
                      return (
                        <ToolCallIndicator
                          key={idx}
                          name={part.name || 'tool'}
                          status={part.success ? 'success' : 'error'}
                        >
                          {part.content && renderMarkdown(part.content)}
                        </ToolCallIndicator>
                      )
                    }
                    // Regular text
                    return part.content.trim() ? (
                      <div key={idx}>{renderMarkdown(part.content)}</div>
                    ) : null
                  })}
                  {isStreaming && (
                    <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              )
            }

            // No tool parts - render normally
            if (displayContent.trim()) {
              return (
                <div className="prose-chat break-words">
                  {renderMarkdown(displayContent)}
                  {isStreaming && (
                    <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              )
            }

            if (containsEdits) {
              return (
                <p className="text-muted-foreground italic">
                  Suggested {editCount} edit{editCount !== 1 ? 's' : ''} to the document.
                </p>
              )
            }

            if (isStreaming) {
              return <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse" />
            }

            return <div className="prose-chat break-words">{renderMarkdown(displayContent)}</div>
          })()}
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
                      <li key={i} className="break-words">
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
