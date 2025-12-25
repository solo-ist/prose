import { useState } from 'react'
import { cn } from '../../lib/utils'
import type { ChatMessage as ChatMessageType } from '../../types'
import { User, Bot } from 'lucide-react'

interface ChatMessageProps {
  message: ChatMessageType
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

export function ChatMessage({ message }: ChatMessageProps) {
  const [showTimestamp, setShowTimestamp] = useState(false)
  const isUser = message.role === 'user'

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
          ) : (
            <div className="prose-chat">{renderMarkdown(message.content)}</div>
          )}
        </div>
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
