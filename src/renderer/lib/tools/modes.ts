/**
 * Mode filtering for tools.
 * Controls which tools are available in each mode.
 */

import type { ToolMode } from '../../../shared/tools/types'
import { getTool, isToolAvailableInMode } from '../../../shared/tools/registry'

const MODE_LABEL: Record<ToolMode, string> = {
  chat: 'Chat',
  editor: 'Editor',
  create: 'Create'
}

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
    return `Tool "${toolName}" is not available in ${MODE_LABEL[mode]} Mode. Switch to Create Mode to use this tool.`
  }

  return null
}

/**
 * Get the default mode for the chat.
 */
export function getDefaultMode(): ToolMode {
  return 'editor'
}
