/**
 * Editor tool executors - tools for modifying document content.
 */

import type { Editor } from '@tiptap/core'
import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { findNodeById, findNodeByContent, getNodesWithIds } from '../../../extensions/node-ids'
import { generateId } from '../../persistence'
import { getAISuggestions } from '../../../extensions/ai-suggestions'

/**
 * Get the TipTap editor instance.
 * Returns null if editor is not available or source mode is active.
 */
function getEditor(): Editor | null {
  if (useEditorStore.getState().sourceMode) {
    return null
  }
  return useEditorInstanceStore.getState().editor
}

/**
 * Check if the editor is in a read-only mode (reMarkable OCR or preview tab).
 * AI tools should not mutate the document in these modes.
 */
function isEditorReadOnly(): boolean {
  const state = useEditorStore.getState()
  return state.isRemarkableReadOnly || state.isPreviewTab
}

/**
 * Resolve the target document position for an editor-mutating tool call.
 * Used to sort tool calls by position (descending) before batch execution,
 * so bottom-of-document edits don't shift positions of earlier edits.
 * Returns Infinity for tools that don't target a specific position.
 */
export function resolveToolPosition(toolName: string, args: Record<string, unknown>): number {
  const editor = getEditor()
  if (!editor) return Infinity

  if (toolName === 'edit' || toolName === 'suggest_edit') {
    const nodeId = args.nodeId as string
    const search = args.search as string | undefined
    if (!nodeId) return Infinity

    let found = findNodeById(editor.state.doc, nodeId)
    if (!found && search) {
      found = findNodeByContent(editor.state.doc, search)
    }
    return found ? found.pos : Infinity
  }

  if (toolName === 'insert') {
    const position = (args.position as string) || 'cursor'
    switch (position) {
      case 'start': return 0
      case 'end': return editor.state.doc.content.size
      case 'cursor': return editor.state.selection.from
      default: return Infinity
    }
  }

  return Infinity
}

/**
 * edit - Replace the content of a node by its ID.
 * Falls back to content matching if the nodeId is stale.
 */
export function executeEdit(
  args: {
    nodeId: string
    content: string
    search?: string
  },
  provenance?: ToolProvenance
): ToolResult<{ applied: boolean; nodeId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { nodeId, content, search } = args

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  // Find the node by ID, fall back to content matching if stale
  let found = findNodeById(editor.state.doc, nodeId)

  if (!found && search) {
    found = findNodeByContent(editor.state.doc, search)
  }

  if (!found) {
    const available = getNodesWithIds(editor.state.doc)
    const nodeList = available.map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`).join(', ')
    return toolError(
      `Node with ID "${nodeId}" not found. Available nodes: [${nodeList}]`,
      'NODE_NOT_FOUND'
    )
  }

  const { node, pos } = found

  // Replace the node's content
  // For text-containing nodes, we replace from pos+1 to pos+node.nodeSize-1 (inside the node)
  // The node structure is: <node>[content]</node>, so content starts at pos+1
  const contentStart = pos + 1
  const contentEnd = pos + node.nodeSize - 1

  const sizeBefore = editor.state.doc.content.size
  editor
    .chain()
    .focus()
    .setTextSelection({ from: contentStart, to: contentEnd })
    .insertContent(content)
    .run()
  const sizeAfter = editor.state.doc.content.size

  // Create AI annotation for provenance tracking
  if (provenance && provenance.documentId && content.length > 0) {
    useAnnotationStore.getState().addAnnotation({
      documentId: provenance.documentId,
      type: 'replacement',
      from: contentStart,
      // Map the old contentEnd through the edit using the doc size delta.
      // insertContent() may produce multi-paragraph PM nodes where string length
      // does not equal PM position delta, so we use the actual size change.
      to: contentEnd + (sizeAfter - sizeBefore),
      content,
      provenance: {
        model: provenance.model,
        conversationId: provenance.conversationId,
        messageId: provenance.messageId,
      },
    })
  }

  return toolSuccess({
    applied: true,
    nodeId
  })
}

/**
 * insert - Insert text at the specified position.
 */
export function executeInsert(
  args: {
    text: string
    position?: 'cursor' | 'start' | 'end'
  },
  provenance?: ToolProvenance
): ToolResult<{ inserted: boolean; position: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { text, position = 'cursor' } = args

  if (!text) {
    return toolError('Text to insert is required', 'INVALID_INPUT')
  }

  // Capture insertion position before modifying the document
  let insertPos: number
  switch (position) {
    case 'start':
      insertPos = 0
      break
    case 'end':
      insertPos = editor.state.doc.content.size
      break
    case 'cursor':
    default:
      insertPos = editor.state.selection.from
      break
  }

  try {
    const sizeBefore = editor.state.doc.content.size
    switch (position) {
      case 'start':
        editor.chain().focus().setTextSelection(0).insertContent(text).run()
        break
      case 'end':
        editor
          .chain()
          .focus()
          .setTextSelection(editor.state.doc.content.size)
          .insertContent(text)
          .run()
        break
      case 'cursor':
      default:
        editor.chain().focus().insertContent(text).run()
        break
    }
    const sizeAfter = editor.state.doc.content.size

    // Create AI annotation for provenance tracking
    if (provenance && provenance.documentId && text.length > 0) {
      useAnnotationStore.getState().addAnnotation({
        documentId: provenance.documentId,
        type: 'insertion',
        from: insertPos,
        // Use the actual PM size delta instead of string length: insertContent()
        // may produce multi-paragraph nodes where string length != PM position delta.
        to: insertPos + (sizeAfter - sizeBefore),
        content: text,
        provenance: {
          model: provenance.model,
          conversationId: provenance.conversationId,
          messageId: provenance.messageId,
        },
      })
    }

    return toolSuccess({
      inserted: true,
      position
    })
  } catch (e) {
    return toolError(`Failed to insert text: ${e}`, 'INSERT_FAILED')
  }
}

/** Provenance context for AI-generated content tracking */
interface ToolProvenance {
  model: string
  conversationId: string
  messageId: string
  documentId: string
}

/**
 * suggest_edit - Show an AI suggestion as a highlighted mark on text.
 * The user can click the highlighted text to see the suggestion and accept/reject it.
 * Falls back to content matching if the nodeId is stale.
 */
export function executeSuggestEdit(
  args: {
    nodeId: string
    content: string
    comment?: string
    search?: string
  },
  provenance?: ToolProvenance
): ToolResult<{ suggested: boolean; suggestionId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { nodeId, content, comment, search } = args

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  // Find the node by ID, fall back to content matching if stale
  let found = findNodeById(editor.state.doc, nodeId)

  if (!found && search) {
    found = findNodeByContent(editor.state.doc, search)
  }

  if (!found) {
    const available = getNodesWithIds(editor.state.doc)
    const nodeList = available.map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`).join(', ')
    return toolError(
      `Node with ID "${nodeId}" not found. Available nodes: [${nodeList}]`,
      'NODE_NOT_FOUND'
    )
  }

  const { node, pos } = found
  const suggestionId = generateId()

  // Get the original text content
  const originalText = node.textContent

  // Select the text content of the node and apply the AI suggestion mark
  const contentStart = pos + 1
  const contentEnd = pos + node.nodeSize - 1

  editor
    .chain()
    .focus()
    .setTextSelection({ from: contentStart, to: contentEnd })
    .setAISuggestion({
      id: suggestionId,
      type: 'edit',
      originalText,
      suggestedText: content,
      explanation: comment || '',
      provenanceModel: provenance?.model || '',
      provenanceConversationId: provenance?.conversationId || '',
      provenanceMessageId: provenance?.messageId || '',
      documentId: provenance?.documentId || '',
    })
    .run()

  return toolSuccess({
    suggested: true,
    suggestionId
  })
}

/** Suggestion data returned by list_diffs */
interface SuggestionInfo {
  id: string
  originalText: string
  suggestedText: string
  explanation?: string
}

/**
 * accept_diff - Accept pending AI suggestions.
 * If no ID provided, accepts ALL suggestions.
 */
export function executeAcceptDiff(args: {
  id?: string
}): ToolResult<{ accepted: boolean; diffId?: string; count?: number }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const suggestions = getAISuggestions(editor)

  if (suggestions.length === 0) {
    return toolError('No pending suggestions', 'NO_DIFFS')
  }

  if (id) {
    // Accept specific suggestion
    const target = suggestions.find((s) => s.id === id)
    if (!target) {
      return toolError(`Suggestion with id "${id}" not found`, 'DIFF_NOT_FOUND')
    }

    const success = editor.commands.acceptAISuggestion(id)
    if (success) {
      return toolSuccess({ accepted: true, diffId: id, count: 1 })
    } else {
      return toolError('Failed to accept suggestion', 'ACCEPT_FAILED')
    }
  }

  // Accept all suggestions
  const count = suggestions.length
  const success = editor.commands.acceptAllAISuggestions()

  if (success) {
    return toolSuccess({ accepted: true, count })
  } else {
    return toolError('Failed to accept suggestions', 'ACCEPT_FAILED')
  }
}

/**
 * reject_diff - Reject pending AI suggestions.
 * If no ID provided, rejects ALL suggestions.
 */
export function executeRejectDiff(args: {
  id?: string
}): ToolResult<{ rejected: boolean; diffId?: string; count?: number }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const suggestions = getAISuggestions(editor)

  if (suggestions.length === 0) {
    return toolError('No pending suggestions', 'NO_DIFFS')
  }

  if (id) {
    // Reject specific suggestion
    const target = suggestions.find((s) => s.id === id)
    if (!target) {
      return toolError(`Suggestion with id "${id}" not found`, 'DIFF_NOT_FOUND')
    }

    const success = editor.commands.rejectAISuggestion(id)
    if (success) {
      return toolSuccess({ rejected: true, diffId: id, count: 1 })
    } else {
      return toolError('Failed to reject suggestion', 'REJECT_FAILED')
    }
  }

  // Reject all suggestions
  const count = suggestions.length
  const success = editor.commands.rejectAllAISuggestions()

  if (success) {
    return toolSuccess({ rejected: true, count })
  } else {
    return toolError('Failed to reject suggestions', 'REJECT_FAILED')
  }
}

/**
 * List all pending AI suggestions.
 */
export function executeListDiffs(): ToolResult<{ diffs: SuggestionInfo[] }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const suggestions = getAISuggestions(editor)
  const diffs: SuggestionInfo[] = suggestions.map((s) => ({
    id: s.id,
    originalText: s.originalText,
    suggestedText: s.suggestedText,
    explanation: s.explanation || undefined
  }))

  return toolSuccess({ diffs })
}
