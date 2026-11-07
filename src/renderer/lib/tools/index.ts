/**
 * Tool executor dispatch.
 * Routes tool calls to the appropriate executor based on tool name.
 */

import type { ToolResult, ToolMode } from '../../../shared/tools/types'
import { toolError } from '../../../shared/tools/types'
import { getTool, allTools } from '../../../shared/tools/registry'
import { checkToolAccess } from './modes'
import {
  isToolHandleError,
  resolveDocumentHandle,
  resolveToolHandle,
  type DocumentHandle,
  type ToolBinding
} from '../../document/handle'
import { useTabStore } from '../../stores/tabStore'
import { pipelineLog } from '../aiPipelineLog'
import type { ToolContext } from './context'

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
  executeReplyToComment
} from './executors/document'

// Editor executors
import {
  executeEdit,
  executeInsert,
  executeSuggestEdit,
  executeAcceptDiff,
  executeRejectDiff,
  executeListDiffs,
  executeDeleteNode,
  executeMoveCursor,
  resolveToolPosition
} from './executors/editor'

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

import type { ToolProvenance } from './provenanceTypes'
export type { ToolProvenance } from './provenanceTypes'
export type { ToolContext } from './context'

/** Tools that act on a document: `executeTool` resolves its handle before they run. */
const DOCUMENT_TOOLS = new Set([
  'read_document', 'read_selection', 'get_metadata', 'search_document', 'get_outline', 'outline',
  'list_comments', 'add_comment', 'resolve_comment', 'reply_to_comment',
  'edit', 'insert', 'suggest_edit', 'accept_diff', 'reject_diff', 'list_diffs', 'delete_node', 'move_cursor',
  'save_file'
])

/** Tools that write: refused while the target document is open in source mode. */
const WRITING_TOOLS = new Set([
  'add_comment', 'resolve_comment', 'reply_to_comment',
  'edit', 'insert', 'suggest_edit', 'accept_diff', 'reject_diff', 'delete_node', 'move_cursor', 'save_file'
])

/** Tools that put another document in front of the user: a bound turn follows them (#1148, decision 2). */
const TAB_CHANGING_TOOLS = new Set(['open_file', 'new_file', 'create_and_open_file', 'select_tab'])

/**
 * The document a call acts on: a chat turn's binding (its tab, else the tab
 * holding its document, else a background reopen, else closed), or the
 * active tab for every other caller (MCP clients, slash commands, specs).
 */
async function resolveHandleFor(
  toolName: string,
  binding: ToolBinding | undefined
): Promise<{ handle: DocumentHandle | null; error?: ToolResult }> {
  if (!DOCUMENT_TOOLS.has(toolName)) return { handle: null }
  const forWrite = WRITING_TOOLS.has(toolName)
  if (binding) {
    const resolved = await resolveToolHandle(binding, { forWrite })
    if (isToolHandleError(resolved)) return { handle: null, error: toolError(resolved.error, resolved.code) }
    return { handle: resolved }
  }
  const handle = resolveDocumentHandle({ forWrite })
  if (!handle) return { handle: null, error: toolError('Editor not available', 'EDITOR_NOT_AVAILABLE') }
  return { handle }
}

/**
 * Execute a tool by name with the given arguments.
 * Validates the tool exists and checks mode access before executing. A
 * `binding` (a chat turn's, or an MCP call's `document` target) names the
 * document the call acts on; without one the call acts on the active tab.
 * `preserveView` (MCP calls, #1237) keeps the writer's selection and focus.
 */
export async function executeTool(
  toolName: string,
  args: unknown,
  mode: ToolMode = 'create',
  provenance?: ToolProvenance,
  binding?: ToolBinding,
  options: { preserveView?: boolean } = {}
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

  const resolved = await resolveHandleFor(toolName, binding)
  if (resolved.error) return resolved.error
  const ctx: ToolContext = { handle: resolved.handle, provenance, binding, preserveView: options.preserveView === true }
  if (resolved.handle) {
    pipelineLog('tool:call', {
      tool: toolName,
      conversationId: binding?.conversationId ?? provenance?.conversationId ?? null,
      documentId: resolved.handle.documentId,
      tabId: resolved.handle.tabId,
      active: resolved.handle.isActive
    })
  }

  // Dispatch to appropriate executor
  let result: ToolResult
  try {
    switch (toolName) {
      // Document tools
      case 'read_document':
        result = executeReadDocument(ctx)
        break
      case 'read_selection':
        result = executeReadSelection(ctx)
        break
      case 'get_metadata':
        result = await executeGetMetadata(ctx)
        break
      case 'search_document':
        result = executeSearchDocument(validatedArgs, ctx)
        break
      case 'get_outline':
      case 'outline':
        result = executeGetOutline(ctx)
        break
      case 'list_comments':
        result = executeListComments(ctx)
        break
      case 'add_comment':
        result = executeAddComment(validatedArgs, ctx)
        break
      case 'resolve_comment':
        result = executeResolveComment(validatedArgs, ctx)
        break
      case 'reply_to_comment':
        result = executeReplyToComment(validatedArgs, ctx)
        break

      // Editor tools
      case 'edit':
        result = await executeEdit(validatedArgs, ctx)
        break
      case 'insert':
        result = await executeInsert(validatedArgs, ctx)
        break
      case 'suggest_edit':
        result = executeSuggestEdit(validatedArgs, ctx)
        break
      case 'accept_diff':
        result = executeAcceptDiff(validatedArgs, ctx)
        break
      case 'reject_diff':
        result = executeRejectDiff(validatedArgs, ctx)
        break
      case 'list_diffs':
        result = executeListDiffs(ctx)
        break
      case 'delete_node':
        result = executeDeleteNode(validatedArgs, ctx)
        break
      case 'move_cursor':
        result = executeMoveCursor(validatedArgs, ctx)
        break

      // File tools (async)
      case 'open_file':
        result = await executeOpenFile(validatedArgs)
        break
      case 'new_file':
        result = await executeNewFile(validatedArgs)
        break
      case 'save_file':
        result = await executeSaveFile(validatedArgs, ctx)
        break
      case 'list_files':
        result = await executeListFiles(validatedArgs)
        break
      case 'read_file':
        result = await executeReadFile(validatedArgs)
        break
      case 'create_and_open_file':
        result = await executeCreateAndOpenFile(validatedArgs, ctx)
        break

      // Tab tools
      case 'list_tabs':
        result = executeListTabs()
        break
      case 'select_tab':
        result = await executeSelectTab(validatedArgs)
        break

      // UI-coordination tools
      case 'request_mode_switch':
        result = executeRequestModeSwitch(validatedArgs as Parameters<typeof executeRequestModeSwitch>[0])
        break

      default:
        return toolError(`Tool "${toolName}" not implemented`, 'NOT_IMPLEMENTED')
    }
  } catch (e) {
    return toolError(`Tool execution error: ${e}`, 'EXECUTION_ERROR')
  }

  // A tool that put another document in front of the user moves the turn
  // with it: "create a file and write into it" keeps working.
  if (binding && result.success && TAB_CHANGING_TOOLS.has(toolName)) {
    const active = useTabStore.getState().getActiveTab()
    if (active) {
      binding.tabId = active.id
      binding.documentId = active.documentId
      binding.path = active.path
      pipelineLog('tool:rebind', { tool: toolName, conversationId: binding.conversationId, documentId: active.documentId, tabId: active.id })
    }
  }
  return result
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
