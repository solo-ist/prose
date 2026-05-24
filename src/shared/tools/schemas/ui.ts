/**
 * UI-coordination tool schemas — tools that don't read or mutate the
 * document; they help the agent coordinate UX flows with the user.
 */

import { z } from 'zod'
import type { ToolConfig } from '../types'

// ============================================================================
// request_mode_switch
// ============================================================================

export const requestModeSwitchSchema = z.object({
  target: z
    .enum(['chat', 'editor', 'create'])
    .describe(
      'The mode the user should switch to in order to do what they asked.'
    ),
  reason: z
    .string()
    .describe(
      'One short sentence explaining what the new mode enables. Shown above the button in the chat. Keep under 20 words.'
    ),
  prompt_to_retry: z
    .string()
    .describe(
      'The exact prompt to run after the switch. The user can click "Switch & Run" to mode-switch + auto-send this, or "Just Switch" to mode-switch and re-ask manually. Phrase this as if the user wrote it.'
    )
})

export const requestModeSwitchConfig: ToolConfig<typeof requestModeSwitchSchema> = {
  name: 'request_mode_switch',
  description:
    "Offer the user a one-click switch to a different mode when their request requires capabilities the current mode doesn't have. Use this INSTEAD of explaining the mode system in prose. Renders as a small in-chat button: 'Switch & Run' performs the switch and re-sends prompt_to_retry; 'Just Switch' only changes the mode. DO NOT call this tool if you can fulfill the user's request with the tools already available to you in the current mode — that creates a confusing double-switch loop. If the system prompt notes that the user just switched modes, do NOT call this tool in that turn at all — they've already switched. Available in every mode — it's the agent's escape valve when the user asks for something out of scope.",
  schema: requestModeSwitchSchema,
  category: 'ui',
  requiresMode: null,
  dangerous: false
}

// ============================================================================
// Export all UI tools
// ============================================================================

export const uiTools = [requestModeSwitchConfig] as const
