/**
 * The `document` argument of an MCP tool call (#1237): which open document the
 * call acts on. An MCP client names it by the documentId or path `list_tabs`
 * reported; it resolves to an open tab only, as a binding with no path, so
 * `resolveToolHandle` never reopens a file from disk on a client's say-so (a
 * background reopen reads without the tool path policy `open_file` enforces).
 * Omitted → the call acts on the active tab, as before.
 */

import { useTabStore } from '../../stores/tabStore'
import type { ToolBinding } from '../../document/handle'
import type { ToolResult } from '../../../shared/tools/types'
import { toolError } from '../../../shared/tools/types'
import { MCP_DOCUMENT_ARG, MCP_DOCUMENT_ARG_MAX_LENGTH, isMcpDocumentTool } from '../../../shared/tools/registry'

export type McpTarget =
  | { args: unknown; binding?: ToolBinding }
  | { error: ToolResult }

/**
 * Split an MCP call's arguments into the tool's own and its target. A
 * `document` on a tool that takes none is dropped; on a document tool it must
 * name an open tab.
 */
export function splitMcpTarget(toolName: string, args: unknown, requestId: string): McpTarget {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !(MCP_DOCUMENT_ARG in args)) return { args }
  const { [MCP_DOCUMENT_ARG]: target, ...rest } = args as Record<string, unknown>
  if (!isMcpDocumentTool(toolName)) return { args: rest }
  if (target === undefined || target === null) return { args: rest }
  if (typeof target !== 'string' || !target.trim() || target.length > MCP_DOCUMENT_ARG_MAX_LENGTH) {
    return { error: toolError(`document: a documentId or path from list_tabs (at most ${MCP_DOCUMENT_ARG_MAX_LENGTH} characters)`, 'INVALID_ARGS') }
  }
  const wanted = target.trim()
  const tab = useTabStore.getState().tabs.find((t) => t.documentId === wanted || (t.path !== null && t.path === wanted))
  if (!tab) {
    return {
      error: toolError(
        `No open document matches "${wanted}". Call list_tabs for the open documents, or open_file to open one first.`,
        'DOCUMENT_NOT_OPEN'
      ),
    }
  }
  return { args: rest, binding: { conversationId: requestId, documentId: tab.documentId, path: null, tabId: tab.id } }
}
