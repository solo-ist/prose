import { useChat } from '../../hooks/useChat'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { MessageSquare, Trash2 } from 'lucide-react'

export function ChatPanel() {
  const { messages, isLoading, sendMessage, clearMessages } = useChat()

  return (
    <div className="flex h-full flex-col bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Chat</h2>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={clearMessages}
            title="Clear chat"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="text-center">
              <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground/30" />
              <p className="mt-4 text-sm text-muted-foreground">
                No messages yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Ask questions about your document or get writing help
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isLoading && (
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
      </ScrollArea>

      {/* Input */}
      <ChatInput onSend={sendMessage} isLoading={isLoading} />
    </div>
  )
}
