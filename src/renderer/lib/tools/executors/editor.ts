/**
 * Editor tool executors - tools for modifying document content.
 */

import type { Editor } from '@tiptap/core'
import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { findNodeById } from '../../../extensions/node-ids'
import { generateId } from '../../persistence'
import { getAISuggestions } from '../../../extensions/ai-suggestions'

/**
 * Get the TipTap editor instance.
 */
function getEditor(): Editor | null {
  return useEditorInstanceStore.getState().editor
}

/**
 * edit - Replace the content of a node by its ID.
 */
export function executeEdit(args: {
  nodeId: string
  content: string
}): ToolResult<{ applied: boolean; nodeId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { nodeId, content } = args

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  // Find the node by ID
  const found = findNodeById(editor.state.doc, nodeId)

  if (!found) {
    return toolError(
      `Node with ID "${nodeId}" not found. Use read_document to get current node IDs.`,
      'NODE_NOT_FOUND'
    )
  }

  const { node, pos } = found

  // Replace the node's content
  // For text-containing nodes, we replace from pos+1 to pos+node.nodeSize-1 (inside the node)
  // The node structure is: <node>[content]</node>, so content starts at pos+1
  const contentStart = pos + 1
  const contentEnd = pos + node.nodeSize - 1

  editor
    .chain()
    .focus()
    .setTextSelection({ from: contentStart, to: contentEnd })
    .insertContent(content)
    .run()

  return toolSuccess({
    applied: true,
    nodeId
  })
}

/**
 * insert - Insert text at the specified position.
 */
export function executeInsert(args: {
  text: string
  position?: 'cursor' | 'start' | 'end'
}): ToolResult<{ inserted: boolean; position: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { text, position = 'cursor' } = args

  if (!text) {
    return toolError('Text to insert is required', 'INVALID_INPUT')
  }

  try {
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

    return toolSuccess({
      inserted: true,
      position
    })
  } catch (e) {
    return toolError(`Failed to insert text: ${e}`, 'INSERT_FAILED')
  }
}

/**
 * suggest_edit - Show an AI suggestion as a highlighted mark on text.
 * The user can click the highlighted text to see the suggestion and accept/reject it.
 */
export function executeSuggestEdit(args: {
  nodeId: string
  content: string
  comment?: string
}): ToolResult<{ suggested: boolean; suggestionId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { nodeId, content, comment } = args

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  // Find the node by ID
  const found = findNodeById(editor.state.doc, nodeId)

  if (!found) {
    return toolError(
      `Node with ID "${nodeId}" not found. Use read_document to get current node IDs.`,
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
      explanation: comment || ''
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
