/**
 * Mode filtering for tools.
 * Controls which tools are available in each mode.
 */

import type { ToolMode } from '../../../shared/tools/types'
import { getTool, isToolAvailableInMode } from '../../../shared/tools/registry'

/**
 * Check if a tool can be executed in the current mode.
 * Returns an error message if not allowed, or null if allowed.
 */
export function checkToolAccess(toolName: string, mode: ToolMode): string | null {
  const tool = getTool(toolName)

  if (!tool) {
    return `Unknown tool: ${toolName}`
  }

  if (!isToolAvailableInMode(toolName, mode)) {
    const modeLabel =
      mode === 'suggestions'
        ? 'Suggestions'
        : mode === 'plan'
          ? 'Plan'
          : 'Full Autonomy'

    return `Tool "${toolName}" is not available in ${modeLabel} mode. Switch to Full Autonomy mode to use this tool.`
  }

  return null
}

/**
 * Get the default mode for the chat.
 */
export function getDefaultMode(): ToolMode {
  return 'suggestions'
}
