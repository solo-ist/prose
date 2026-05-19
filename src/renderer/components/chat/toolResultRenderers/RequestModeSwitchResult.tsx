import { Button } from '../../ui/button'
import { ArrowRightIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { useChatStore } from '../../../stores/chatStore'
import type { ToolMode } from '../../../../shared/tools/types'

interface RequestModeSwitchPayload {
  target: ToolMode
  reason: string
  prompt_to_retry: string
}

interface BodyProps {
  content: string
}

interface ActionsProps {
  content: string
  /** Owning message ID — used to read/write `toolActions[toolPartIdx]`. */
  messageId: string
  /** Index of this tool result inside the message's parsed tool parts. */
  toolPartIdx: number
}

const MODE_LABEL: Record<ToolMode, string> = {
  chat: 'Chat',
  editor: 'Editor',
  create: 'Create'
}

const MODE_SWITCH_RUN_EVENT = 'prose:mode-switch-and-run'

function parsePayload(content: string): RequestModeSwitchPayload | null {
  try {
    const cleaned = content.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && 'data' in parsed && parsed.data && typeof parsed.data === 'object') {
      return parsed.data as RequestModeSwitchPayload
    }
    if (parsed && typeof parsed === 'object' && 'target' in parsed) {
      return parsed as RequestModeSwitchPayload
    }
  } catch {
    return null
  }
  return null
}

/**
 * Body slot: the reason and prompt_to_retry quote. Rendered inside the
 * collapsible body area of the tool-call shell.
 */
export function RequestModeSwitchBody({ content }: BodyProps) {
  const payload = parsePayload(content)
  if (!payload) {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="mb-1">Unable to parse mode-switch request.</div>
        <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap">{content}</pre>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-foreground">{payload.reason}</div>
      <div className="rounded-md border border-border bg-background/50 p-2 text-xs italic text-muted-foreground">
        &ldquo;{payload.prompt_to_retry}&rdquo;
      </div>
    </div>
  )
}

/**
 * Actions slot: the Switch & Run / Just Switch / Cancel buttons. Always
 * visible (outside the collapsible body region). Mode changes never
 * happen without an explicit user click.
 *
 * Action state (switched | dismissed) lives on the owning message as
 * `toolActions[toolPartIdx]`, persisted with the conversation. That
 * way reopening the chat shows a truthful record of past decisions
 * instead of re-clickable buttons for a "Switch & Run" that already
 * fired three messages ago.
 *
 * sendMessage is dispatched via a CustomEvent so this renderer doesn't
 * have to be a useChat consumer. ChatPanel listens for the event and
 * calls its local sendMessage.
 */
export function RequestModeSwitchActions({ content, messageId, toolPartIdx }: ActionsProps) {
  const action = useChatStore(
    (s) => s.messages.find((m) => m.id === messageId)?.toolActions?.[toolPartIdx]
  )
  const setToolMode = useChatStore((s) => s.setToolMode)
  const setToolCallAction = useChatStore((s) => s.setToolCallAction)
  const payload = parsePayload(content)
  if (!payload) return null

  const { target, prompt_to_retry } = payload
  const acted = action != null

  const handleJustSwitch = () => {
    setToolMode(target)
    setToolCallAction(messageId, toolPartIdx, 'switched')
  }

  const handleSwitchAndRun = () => {
    setToolMode(target)
    setToolCallAction(messageId, toolPartIdx, 'switched')
    window.dispatchEvent(
      new CustomEvent(MODE_SWITCH_RUN_EVENT, { detail: { prompt: prompt_to_retry } })
    )
  }

  const handleCancel = () => {
    setToolCallAction(messageId, toolPartIdx, 'dismissed')
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={acted}
          onClick={handleSwitchAndRun}
          className="h-7 text-xs"
        >
          <RefreshCwIcon className="mr-1 h-3 w-3" />
          Switch to {MODE_LABEL[target]} &amp; Run
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={acted}
          onClick={handleJustSwitch}
          className="h-7 text-xs"
        >
          <ArrowRightIcon className="mr-1 h-3 w-3" />
          Just Switch
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={acted}
          onClick={handleCancel}
          className="h-7 text-xs"
        >
          <XIcon className="mr-1 h-3 w-3" />
          Cancel
        </Button>
      </div>
      {action === 'switched' && (
        <div className="text-[11px] text-muted-foreground">
          Switched to {MODE_LABEL[target]} Mode.
        </div>
      )}
      {action === 'dismissed' && (
        <div className="text-[11px] text-muted-foreground">
          Dismissed.
        </div>
      )}
    </div>
  )
}

export { MODE_SWITCH_RUN_EVENT }
