/**
 * Tool executor dispatch.
 * Routes tool calls to the appropriate executor based on tool name.
 */

import type { ToolResult, ToolMode } from '../../../shared/tools/types'
import { toolError } from '../../../shared/tools/types'
import { getTool, allTools } from '../../../shared/tools/registry'
import { checkToolAccess } from './modes'

// Document executors
import {
  executeReadDocument,
  executeReadSelection,
  executeGetMetadata,
  executeSearchDocument,
  executeGetOutline
} from './executors/document'

// Editor executors
import {
  executeEdit,
  executeInsert,
  executeSuggestEdit,
  executeAcceptDiff,
  executeRejectDiff,
  executeListDiffs
} from './executors/editor'

// File executors
import {
  executeOpenFile,
  executeNewFile,
  executeSaveFile,
  executeListFiles,
  executeReadFile
} from './executors/file'

/** Provenance context for AI-generated content tracking */
export interface ToolProvenance {
  model: string
  conversationId: string
  messageId: string
  documentId: string
}

/**
 * Execute a tool by name with the given arguments.
 * Validates the tool exists and checks mode access before executing.
 */
export async function executeTool(
  toolName: string,
  args: unknown,
  mode: ToolMode = 'full',
  provenance?: ToolProvenance
): Promise<ToolResult> {
  // Check if tool exists
  const tool = getTool(toolName)
  if (!tool) {
    return toolError(`Unknown tool: ${toolName}`, 'UNKNOWN_TOOL')
  }

  // Check mode access
  const accessError = checkToolAccess(toolName, mode)
  if (accessError) {
    return toolError(accessError, 'MODE_RESTRICTED')
  }

  // Validate args against schema
  const parseResult = tool.schema.safeParse(args)
  if (!parseResult.success) {
    const errorMessage = parseResult.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ')
    return toolError(`Invalid arguments: ${errorMessage}`, 'INVALID_ARGS')
  }

  const validatedArgs = parseResult.data

  // Dispatch to appropriate executor
  try {
    switch (toolName) {
      // Document tools
      case 'read_document':
        return executeReadDocument()
      case 'read_selection':
        return executeReadSelection()
      case 'get_metadata':
        return executeGetMetadata()
      case 'search_document':
        return executeSearchDocument(validatedArgs)
      case 'get_outline':
        return executeGetOutline()

      // Editor tools
      case 'edit':
        return executeEdit(validatedArgs)
      case 'insert':
        return executeInsert(validatedArgs)
      case 'suggest_edit':
        return executeSuggestEdit(validatedArgs, provenance)
      case 'accept_diff':
        return executeAcceptDiff(validatedArgs)
      case 'reject_diff':
        return executeRejectDiff(validatedArgs)
      case 'list_diffs':
        return executeListDiffs()

      // File tools (async)
      case 'open_file':
        return await executeOpenFile(validatedArgs)
      case 'new_file':
        return await executeNewFile(validatedArgs)
      case 'save_file':
        return await executeSaveFile(validatedArgs)
      case 'list_files':
        return await executeListFiles(validatedArgs)
      case 'read_file':
        return await executeReadFile(validatedArgs)

      default:
        return toolError(`Tool "${toolName}" not implemented`, 'NOT_IMPLEMENTED')
    }
  } catch (e) {
    return toolError(`Tool execution error: ${e}`, 'EXECUTION_ERROR')
  }
}

/**
 * Get all available tool names.
 */
export function getAvailableTools(): string[] {
  return allTools.map((t) => t.name)
}

/**
 * Re-export types and utilities.
 */
export { checkToolAccess, getDefaultMode } from './modes'
export type { ToolResult, ToolMode } from '../../../shared/tools/types'
export { toolSuccess, toolError } from '../../../shared/tools/types'
