import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { cn } from '../../lib/utils'
import type { ChatMessage as ChatMessageType } from '../../types'
import { User, Wand2, Check, AlertCircle, ArrowRight, Sparkles, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'
import { parseEditBlocks, hasEditBlocks, stripEditBlocks, type EditBlock } from '../../lib/editBlocks'
import { applyEditsAsDiffs, applyEditsDirect, type ApplyResult, type EditProvenance } from '../../lib/applyEdit'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore } from '../../stores/chatStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { CopyButton } from '../ui/copy-button'
import { jumpToLine } from '../../lib/lineNavigation'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import avatarDark from '../../assets/avatar-dark.png'
import avatarLight from '../../assets/avatar-light.png'

// Tool call indicator component with AI sparkle styling
function ToolCallIndicator({ name, status, onClick, children }: { name: string; status: 'executing' | 'success' | 'error'; onClick?: () => void; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/20 overflow-hidden",
        onClick && "cursor-pointer hover:border-violet-500/50 transition-colors"
      )}
      onClick={onClick}
    >
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
  onRetry?: () => void
}

// Process inline formatting for a line
function processInlineFormatting(text: string, keyPrefix: string, editor: any): React.ReactNode {
  // Order matters: process markdown links first, then bold, italic, code
  const parts: React.ReactNode[] = []
  let key = 0

  // Process markdown links first: [text](url)
  // This handles both regular links and line references like [Line 37](line:37)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const linkText = match[1]
    const linkUrl = match[2]

    // Check if this is a line reference (line:N)
    const lineMatch = linkUrl.match(/^line:(\d+)$/i)
    if (lineMatch) {
      const lineNumber = parseInt(lineMatch[1], 10)
      parts.push(
        <button
          key={`${keyPrefix}-link-${key++}`}
          onClick={(e) => {
            e.preventDefault()
            if (editor) {
              jumpToLine(editor, lineNumber)
            }
          }}
          className="text-primary hover:underline cursor-pointer inline-flex items-center gap-0.5 group"
          title={`${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Click to jump to line ${lineNumber}`}
        >
          {linkText}
        </button>
      )
    } else {
      // Regular link
      parts.push(
        <a
          key={`${keyPrefix}-link-${key++}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {linkText}
        </a>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  if (parts.length === 0) {
    parts.push(text)
  }

  // Now process bold on the text parts (not already processed links)
  const processBold = (node: React.ReactNode, idx: number): React.ReactNode => {
    if (typeof node !== 'string') return node

    const boldRegex = /\*\*(.+?)\*\*/g
    const boldParts: React.ReactNode[] = []
    let boldLastIndex = 0
    let boldMatch

    while ((boldMatch = boldRegex.exec(node)) !== null) {
      if (boldMatch.index > boldLastIndex) {
        boldParts.push(node.slice(boldLastIndex, boldMatch.index))
      }
      boldParts.push(<strong key={`${keyPrefix}-b-${idx}-${boldParts.length}`}>{boldMatch[1]}</strong>)
      boldLastIndex = boldMatch.index + boldMatch[0].length
    }

    if (boldLastIndex < node.length) {
      boldParts.push(node.slice(boldLastIndex))
    }

    return boldParts.length > 0 ? boldParts : node
  }

  // Process italic on the text parts (not already processed)
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

  // Apply transformations in order: bold -> italic -> code
  return parts.flatMap((part, idx) => {
    const withBold = processBold(part, idx)
    if (Array.isArray(withBold)) {
      return withBold.flatMap((p, i) => {
        const withItalic = processItalic(p, idx * 1000 + i)
        if (Array.isArray(withItalic)) {
          return withItalic.flatMap((q, j) => processCode(q, idx * 1000 + i * 100 + j))
        }
        return processCode(withItalic, idx * 1000 + i)
      })
    }
    const withItalic = processItalic(withBold, idx)
    if (Array.isArray(withItalic)) {
      return withItalic.flatMap((p, i) => processCode(p, idx * 100 + i))
    }
    return processCode(withItalic, idx)
  })
}

// Simple markdown renderer for assistant messages
function renderMarkdown(content: string, editor: any): React.ReactNode {
  // Split into lines and process
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeContent: string[] = []

  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        const codeText = codeContent.join('\n')
        elements.push(
          <div key={`code-${i}`} className="relative group my-2">
            <pre className="rounded bg-muted p-3 pr-10 overflow-x-auto">
              <code className="text-xs font-mono">{codeText}</code>
            </pre>
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton value={codeText} />
            </div>
          </div>
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
    const processed = processInlineFormatting(line, `line-${i}`, editor)

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


export function ChatMessage({ message, isStreaming, onRetry }: ChatMessageProps) {
  const [showTimestamp, setShowTimestamp] = useState(false)
  const [applyState, setApplyState] = useState<'idle' | 'applied' | 'error'>('idle')
  const [applyResults, setApplyResults] = useState<ApplyResult[]>([])
  const appliedRef = useRef(false)
  const editor = useEditorInstanceStore((state) => state.editor)
  const agentMode = useChatStore((state) => state.agentMode)
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const documentId = useEditorStore((state) => state.document.documentId)
  const settings = useSettingsStore((state) => state.settings)
  const effectiveTheme = useSettingsStore((state) => state.effectiveTheme)
  const llmModel = settings.llm.model
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

  // Scroll editor to a suggestion by its ID
  const scrollToSuggestion = useCallback((suggestionId: string) => {
    if (!editor) return
    const suggestions = getAISuggestions(editor)
    const target = suggestions.find(s => s.id === suggestionId)
    if (target) {
      editor.commands.setTextSelection(target.from)
      editor.commands.scrollIntoView()
    }
  }, [editor])

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
        'flex gap-3 p-4 pr-6 transition-colors group',
        isUser ? 'bg-transparent' : 'bg-muted/30'
      )}
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => setShowTimestamp(false)}
    >
      {/* Left rail with avatar and copy button */}
      <div className="flex flex-col items-center gap-2 w-8 shrink-0">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden',
            isUser
              ? settings.google?.picture
                ? effectiveTheme === 'dark' ? 'ring-2 ring-[#004400]' : 'ring-2 ring-[#40ff40]'
                : 'bg-primary/10'
              : 'bg-[#020901] ring-2 ring-[#004400]'
          )}
        >
          {isUser ? (
            settings.google?.picture ? (
              <img
                src={settings.google.picture}
                alt="User"
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <User className="h-4 w-4 text-primary" />
            )
          ) : (
            <img
              src={effectiveTheme === 'dark' ? avatarDark : avatarLight}
              alt="Prose"
              className="h-5 w-5 object-contain"
            />
          )}
        </div>
        {!isUser && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton value={message.content} />
          </div>
        )}
      </div>
      {/* Content area */}
      <div className="flex-1 min-w-0 space-y-2">{/* Removed overflow-hidden to allow proper text wrapping */}
        {message.context && (
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            <span className="font-medium">Context:</span>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words">{message.context}</p>
          </div>
        )}
        <div className="text-sm leading-relaxed">
          {isUser ? (
            <p className="whitespace-pre-wrap break-words font-mono">{message.content}</p>
          ) : message.isError ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="break-words">{displayContent}</span>
              </div>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
              )}
            </div>
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
                      // For suggest_edit results, parse suggestionId and make clickable
                      let onClickHandler: (() => void) | undefined
                      if (part.name === 'suggest_edit' && part.success && part.content) {
                        try {
                          const parsed = JSON.parse(part.content.replace(/```json\n?|\n?```/g, '').trim())
                          if (parsed.suggestionId) {
                            onClickHandler = () => scrollToSuggestion(parsed.suggestionId)
                          }
                        } catch {
                          // Not JSON, ignore
                        }
                      }
                      return (
                        <ToolCallIndicator
                          key={idx}
                          name={part.name || 'tool'}
                          status={part.success ? 'success' : 'error'}
                          onClick={onClickHandler}
                        >
                          {part.content && renderMarkdown(part.content, editor)}
                        </ToolCallIndicator>
                      )
                    }
                    // Regular text
                    return part.content.trim() ? (
                      <div key={idx}>{renderMarkdown(part.content, editor)}</div>
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
                  {renderMarkdown(displayContent, editor)}
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

            return <div className="prose-chat break-words">{renderMarkdown(displayContent, editor)}</div>
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
