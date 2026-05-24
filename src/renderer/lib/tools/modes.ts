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
    // Point the user/agent at the *minimum* mode that exposes this tool — not
    // always Create. A suggest_edit attempted from Chat Mode should say "Switch
    // to Editor", not "Switch to Create". `tool.requiresMode` is guaranteed
    // non-null here (the `requiresMode === null` branch in isToolAvailableInMode
    // would have returned true already), but we default for type-safety.
    const required = tool.requiresMode ? MODE_LABEL[tool.requiresMode] : 'Create'
    return `Tool "${toolName}" is not available in ${MODE_LABEL[mode]} Mode. Switch to ${required} Mode to use this tool.`
  }

  return null
}

/**
 * Get the default mode for the chat.
 */
export function getDefaultMode(): ToolMode {
  return 'editor'
}
