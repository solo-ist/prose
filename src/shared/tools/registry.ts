/**
 * Tool registry - central registry of all available tools.
 */

import type { ToolConfig, ToolMode, ToolCategory } from './types'
import { documentTools } from './schemas/document'
import { editorTools } from './schemas/editor'
import { fileTools } from './schemas/file'
import { tabTools } from './schemas/tabs'
import { zodToJsonSchema } from './utils'

/**
 * All registered tools.
 */
export const allTools = [...documentTools, ...editorTools, ...fileTools, ...tabTools] as const

/**
 * Tool name type (union of all tool names).
 */
export type ToolName = (typeof allTools)[number]['name']

/**
 * Map of tool name to tool config.
 */
export const toolRegistry: Record<string, ToolConfig> = Object.fromEntries(
  allTools.map((tool) => [tool.name, tool])
)

/**
 * Get a tool config by name.
 */
export function getTool(name: string): ToolConfig | undefined {
  return toolRegistry[name]
}

/**
 * Get all tools in a category.
 */
export function getToolsByCategory(category: ToolCategory): ToolConfig[] {
  return allTools.filter((tool) => tool.category === category)
}

/**
 * Mode capability ladder: each mode includes everything below it.
 *
 *   chat   ⊂ editor ⊂ create
 *
 * A tool with `requiresMode: 'editor'` is available in editor and create, not chat.
 * `requiresMode: 'create'` is create-only. `requiresMode: null` is available everywhere.
 *
 * Note: `chat` is at the bottom of the ladder for gating purposes — at runtime,
 * Chat Mode's actual tool surface is narrowed further at the useChat call site
 * to a read-only subset (see CHAT_MODE_TOOL_NAMES in src/renderer/hooks/useChat.ts).
 */
const MODE_LEVEL: Record<ToolMode, number> = {
  chat: 0,
  editor: 1,
  create: 2
}

/**
 * Get all tools available in a given mode.
 */
export function getToolsForMode(mode: ToolMode): ToolConfig[] {
  const modeLevel = MODE_LEVEL[mode]
  return allTools.filter((tool) => {
    if (tool.requiresMode === null) return true
    return MODE_LEVEL[tool.requiresMode] <= modeLevel
  })
}

/**
 * Check if a tool is available in the given mode.
 */
export function isToolAvailableInMode(name: string, mode: ToolMode): boolean {
  const tool = getTool(name)
  if (!tool) return false
  if (tool.requiresMode === null) return true
  return MODE_LEVEL[tool.requiresMode] <= MODE_LEVEL[mode]
}

/**
 * Get tools formatted for Claude API tool_use.
 * Returns array of tool definitions with JSON schema.
 */
export function getToolsForClaudeAPI(mode: ToolMode = 'create'): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return getToolsForMode(mode).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.schema)
  }))
}

/**
 * Tools exposed via MCP server.
 * Focused subset for Claude Desktop integration.
 */
const mcpToolNames = [
  'read_document',
  'get_outline',
  'open_file',
  'suggest_edit',
  'create_and_open_file',
  'list_comments',
  'add_comment',
  'resolve_comment',
  'list_tabs',
  'select_tab'
] as const

/**
 * Get tools formatted for MCP server.
 * Returns a focused subset of tools for Claude Desktop integration.
 */
export function getToolsForMCP(): Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}> {
  return allTools
    .filter((tool) => (mcpToolNames as readonly string[]).includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.schema)
    }))
}
