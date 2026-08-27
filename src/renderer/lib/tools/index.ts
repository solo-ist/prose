/**
 * Tool executor dispatch.
 * Routes tool calls to the appropriate executor based on tool name.
 */

import type { ToolResult, ToolMode, ToolExecutionContext } from '../../../shared/tools/types'
import { toolError } from '../../../shared/tools/types'
import { getTool, allTools, isToolExposedViaMCP } from '../../../shared/tools/registry'
import { checkToolAccess } from './modes'

// Document executors
import {
  executeReadDocument,
  executeReadSelection,
  executeGetMetadata,
  executeSearchDocument,
  executeGetOutline,
  executeListComments,
  executeAddComment,
  executeResolveComment,
  executeReplyToComment,
  executeReopenComment
} from './executors/document'

// Editor executors
import {
  executeEdit,
  executeInsert,
  executeInsertAfter,
  executeSuggestDelete,
  executeSuggestEdit,
  executeAcceptDiff,
  executeRejectDiff,
  executeListDiffs,
  executeDeleteNode,
  executeMoveCursor,
  resolveToolPosition
} from './executors/editor'
import {
  executeListSuggestions,
  executeAddSuggestionFeedback,
  executeReviseSuggestion,
  executeDecideSuggestion,
  executeListReviewEvents,
  executeGetReviewStatus,
} from './executors/review'

// File executors
import {
  executeOpenFile,
  executeNewFile,
  executeSaveFile,
  executeListFiles,
  executeReadFile,
  executeCreateAndOpenFile
} from './executors/file'

// Tab executors
import {
  executeListTabs,
  executeSelectTab
} from './executors/tabs'

// UI-coordination executors
import { executeRequestModeSwitch } from './executors/ui'

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
  mode: ToolMode = 'create',
  provenance?: ToolProvenance,
  executionContext?: ToolExecutionContext
): Promise<ToolResult> {
  if (executionContext?.origin === 'mcp' && !isToolExposedViaMCP(toolName)) {
    return toolError(`Tool "${toolName}" is not exposed through MCP`, 'MCP_TOOL_NOT_EXPOSED')
  }

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
        return await executeGetMetadata()
      case 'search_document':
        return executeSearchDocument(validatedArgs)
      case 'get_outline':
      case 'outline':
        return executeGetOutline()
      case 'list_comments':
        return executeListComments(executionContext)
      case 'add_comment':
        return await executeAddComment(validatedArgs, executionContext)
      case 'resolve_comment':
        return await executeResolveComment(validatedArgs, executionContext)
      case 'reopen_comment':
        return await executeReopenComment(validatedArgs, executionContext)
      case 'reply_to_comment':
        return await executeReplyToComment(validatedArgs, executionContext)

      // Review-collaboration tools
      case 'list_suggestions':
        return executeListSuggestions(validatedArgs, executionContext)
      case 'add_suggestion_feedback':
        return await executeAddSuggestionFeedback(validatedArgs, executionContext)
      case 'revise_suggestion':
        return await executeReviseSuggestion(validatedArgs, executionContext)
      case 'decide_suggestion':
        return await executeDecideSuggestion(validatedArgs, executionContext)
      case 'list_review_events':
        return executeListReviewEvents(validatedArgs, executionContext)
      case 'get_review_status':
        return executeGetReviewStatus(executionContext)

      // Editor tools
      case 'edit':
        return executeEdit(validatedArgs, provenance)
      case 'insert':
        return executeInsert(validatedArgs, provenance)
      case 'insert_after':
        return await executeInsertAfter(validatedArgs, provenance, executionContext)
      case 'suggest_delete':
        return await executeSuggestDelete(validatedArgs, provenance, executionContext)
      case 'suggest_edit':
        return await executeSuggestEdit(validatedArgs, provenance, executionContext)
      case 'accept_diff':
        return executeAcceptDiff(validatedArgs)
      case 'reject_diff':
        return executeRejectDiff(validatedArgs)
      case 'list_diffs':
        return executeListDiffs()
      case 'delete_node':
        return executeDeleteNode(validatedArgs, provenance)
      case 'move_cursor':
        return executeMoveCursor(validatedArgs)

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
      case 'create_and_open_file':
        return await executeCreateAndOpenFile(validatedArgs, provenance)

      // Tab tools
      case 'list_tabs':
        return executeListTabs()
      case 'select_tab':
        return await executeSelectTab(validatedArgs)

      // UI-coordination tools
      case 'request_mode_switch':
        return executeRequestModeSwitch(validatedArgs as Parameters<typeof executeRequestModeSwitch>[0])

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
export { isToolAvailableInMode } from '../../../shared/tools/registry'
export { resolveToolPosition }
export type { ToolResult, ToolMode } from '../../../shared/tools/types'
export { toolSuccess, toolError } from '../../../shared/tools/types'
