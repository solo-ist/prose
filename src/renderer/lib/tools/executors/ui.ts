import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess } from '../../../../shared/tools/types'
import type { ToolMode } from '../../../../shared/tools/types'

/**
 * Executor for request_mode_switch.
 *
 * Does NOT actually change the mode — that would bypass the user's intent.
 * It just packages the agent's request as a tool result, which the chat-side
 * renderer (`RequestModeSwitchResult.tsx` — `RequestModeSwitchBody` /
 * `RequestModeSwitchActions`) turns into a one-click button.
 *
 * The user clicks the button; the renderer calls `setToolMode` and (for
 * "Switch & Run") `sendMessage(prompt_to_retry)`. Mode change is always
 * gated on an explicit user action.
 */
export interface RequestModeSwitchPayload {
  target: ToolMode
  reason: string
  prompt_to_retry: string
}

export function executeRequestModeSwitch(
  args: RequestModeSwitchPayload
): ToolResult<RequestModeSwitchPayload> {
  return toolSuccess(args)
}
