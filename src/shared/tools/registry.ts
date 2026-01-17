/**
 * Tool registry - central registry of all available tools.
 */

import type { ToolConfig, ToolMode, ToolCategory } from './types'
import { documentTools } from './schemas/document'
import { editorTools } from './schemas/editor'
import { fileTools } from './schemas/file'
import { zodToJsonSchema } from './utils'

/**
 * All registered tools.
 */
export const allTools = [...documentTools, ...editorTools, ...fileTools] as const

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
 * Get all tools available in a given mode.
 */
export function getToolsForMode(mode: ToolMode): ToolConfig[] {
  return allTools.filter((tool) => {
    if (tool.requiresMode === null) return true
    if (mode === 'full') return true // Full mode has access to all tools
    if (mode === 'plan') return tool.requiresMode !== 'full' // Plan excludes full-only
    // Suggestions mode: only tools that don't require full or plan
    return tool.requiresMode === 'suggestions' || tool.requiresMode === null
  })
}

/**
 * Check if a tool is available in the given mode.
 */
export function isToolAvailableInMode(name: string, mode: ToolMode): boolean {
  const tool = getTool(name)
  if (!tool) return false
  if (tool.requiresMode === null) return true
  if (mode === 'full') return true
  if (mode === 'plan') return tool.requiresMode !== 'full'
  return tool.requiresMode === null
}

/**
 * Get tools formatted for Claude API tool_use.
 * Returns array of tool definitions with JSON schema.
 */
export function getToolsForClaudeAPI(mode: ToolMode = 'full'): Array<{
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
const mcpToolNames = ['read_document', 'get_outline', 'open_file', 'suggest_edit'] as const

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
