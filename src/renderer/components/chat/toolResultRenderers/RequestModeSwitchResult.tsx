import { useState } from 'react'
import { Button } from '../../ui/button'
import { ArrowRightIcon, RefreshCwIcon } from 'lucide-react'
import { useChatStore } from '../../../stores/chatStore'
import type { ToolMode } from '../../../../shared/tools/types'

interface RequestModeSwitchPayload {
  target: ToolMode
  reason: string
  prompt_to_retry: string
}

interface RequestModeSwitchResultProps {
  content: string
}

const MODE_LABEL: Record<ToolMode, string> = {
  chat: 'Chat',
  editor: 'Editor',
  create: 'Create'
}

/**
 * Renders the agent's request_mode_switch tool result as a one-click
 * affordance: the user picks "Switch & Run" (mode-switch + auto-send the
 * agent's prompt_to_retry) or "Just Switch" (mode-switch only). Mode
 * changes never happen without an explicit user click.
 *
 * sendMessage is dispatched via a CustomEvent so this renderer doesn't
 * have to be a useChat consumer (which would couple it tightly to a hook
 * tree shape that may evolve). The ChatPanel listens for the event and
 * calls its local sendMessage. See `chatStore.ts` for the event name
 * constant if introduced; for now, a simple inline string suffices.
 */
const MODE_SWITCH_RUN_EVENT = 'prose:mode-switch-and-run'

export function RequestModeSwitchResult({ content }: RequestModeSwitchResultProps) {
  const [acted, setActed] = useState(false)
  const setToolMode = useChatStore((s) => s.setToolMode)

  let parsed: { data?: RequestModeSwitchPayload } | RequestModeSwitchPayload | null = null
  try {
    const cleaned = content.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="mb-1">Unable to parse mode-switch request.</div>
        <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap">{content}</pre>
      </div>
    )
  }

  // Accept both envelope and raw shapes, like ListFilesResult.
  const payload: RequestModeSwitchPayload | null =
    parsed && 'data' in parsed && parsed.data
      ? parsed.data
      : parsed && 'target' in parsed
        ? (parsed as RequestModeSwitchPayload)
        : null

  if (!payload) {
    return <div className="text-xs text-muted-foreground">Empty mode-switch request.</div>
  }

  const { target, reason, prompt_to_retry } = payload

  const handleJustSwitch = () => {
    setToolMode(target)
    setActed(true)
  }

  const handleSwitchAndRun = () => {
    setToolMode(target)
    setActed(true)
    // Dispatch through a CustomEvent — ChatPanel listens for this and calls
    // its sendMessage. Keeps the renderer decoupled from the chat-hook tree.
    window.dispatchEvent(
      new CustomEvent(MODE_SWITCH_RUN_EVENT, { detail: { prompt: prompt_to_retry } })
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-foreground">{reason}</div>
      <div className="rounded-md border border-border bg-background/50 p-2 text-xs italic text-muted-foreground">
        &ldquo;{prompt_to_retry}&rdquo;
      </div>
      <div className="flex gap-2 pt-1">
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
      </div>
      {acted && (
        <div className="text-[11px] text-muted-foreground">
          Switched to {MODE_LABEL[target]} Mode.
        </div>
      )}
    </div>
  )
}

export { MODE_SWITCH_RUN_EVENT }
