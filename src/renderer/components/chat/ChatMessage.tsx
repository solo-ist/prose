import { cn } from '../../lib/utils'
import type { ChatMessage as ChatMessageType } from '../../types'
import { User, Bot } from 'lucide-react'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div
      className={cn(
        'flex gap-3 p-4',
        isUser ? 'bg-transparent' : 'bg-muted/30'
      )}
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
            <p className="mt-1 line-clamp-3">{message.context}</p>
          </div>
        )}
        <div className="prose prose-sm prose-invert max-w-none">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })}
        </p>
      </div>
    </div>
  )
}
