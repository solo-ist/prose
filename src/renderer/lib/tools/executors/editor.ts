/**
 * Editor tool executors - tools for modifying document content.
 */

import type { Editor } from '@tiptap/core'
import type { ToolResult, DiffSuggestion } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { findNodeById } from '../../../extensions/node-ids'
import { generateId } from '../../persistence'

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

/**
 * Get all pending diff suggestions in the document.
 */
function getPendingDiffs(editor: Editor): DiffSuggestion[] {
  const diffs: DiffSuggestion[] = []

  editor.state.doc.descendants((node) => {
    if (node.type.name === 'diffSuggestion') {
      diffs.push({
        id: node.attrs.id,
        originalText: node.attrs.originalText,
        suggestedText: node.attrs.suggestedText,
        comment: node.attrs.comment || undefined
      })
    }
  })

  return diffs
}

/**
 * accept_diff - Accept a pending diff suggestion.
 * If no ID provided and multiple diffs exist, accepts ALL diffs.
 * Creates AI annotations for accepted text to track provenance.
 */
export function executeAcceptDiff(args: {
  id?: string
}): ToolResult<{ accepted: boolean; diffId?: string; count?: number }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const documentId = useEditorStore.getState().document.documentId

  // Collect all diff nodes with their data before modifying
  const diffNodes: Array<{
    id: string
    pos: number
    nodeSize: number
    suggestedText: string
    provenanceModel: string
    provenanceConversationId: string
    provenanceMessageId: string
    documentId: string
  }> = []

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'diffSuggestion') {
      // If ID specified, only collect that one
      if (id && node.attrs.id !== id) return

      diffNodes.push({
        id: node.attrs.id,
        pos,
        nodeSize: node.nodeSize,
        suggestedText: node.attrs.suggestedText || '',
        provenanceModel: node.attrs.provenanceModel || '',
        provenanceConversationId: node.attrs.provenanceConversationId || '',
        provenanceMessageId: node.attrs.provenanceMessageId || '',
        documentId: node.attrs.documentId || documentId
      })
    }
  })

  if (diffNodes.length === 0) {
    if (id) {
      return toolError(`Diff with id "${id}" not found`, 'DIFF_NOT_FOUND')
    }
    return toolError('No pending diff suggestions', 'NO_DIFFS')
  }

  // Sort by position descending so we can apply in reverse order (preserves positions)
  diffNodes.sort((a, b) => b.pos - a.pos)

  let acceptedCount = 0

  // Accept each diff and create annotation
  for (const diff of diffNodes) {
    const { pos, nodeSize, suggestedText, provenanceModel, provenanceConversationId, provenanceMessageId } = diff

    // Replace diff node with suggested text
    editor.chain()
      .focus()
      .setTextSelection({ from: pos, to: pos + nodeSize })
      .insertContent(suggestedText)
      .run()

    acceptedCount++

    // Create AI annotation if we have provenance data
    if (provenanceModel && suggestedText && diff.documentId) {
      const newFrom = pos
      const newTo = pos + suggestedText.length

      useAnnotationStore.getState().addAnnotation({
        documentId: diff.documentId,
        type: 'replacement',
        from: newFrom,
        to: newTo,
        content: suggestedText,
        provenance: {
          model: provenanceModel,
          conversationId: provenanceConversationId,
          messageId: provenanceMessageId
        }
      })
    }
  }

  if (acceptedCount > 0) {
    return toolSuccess({
      accepted: true,
      diffId: id,
      count: acceptedCount
    })
  } else {
    return toolError('Failed to accept diffs', 'ACCEPT_FAILED')
  }
}

/**
 * reject_diff - Reject a pending diff suggestion.
 * If no ID provided and multiple diffs exist, rejects ALL diffs.
 *
 * Note: The rejectDiffSuggestion(id) command ignores the ID and relies on
 * cursor position, so we use rejectAllDiffSuggestions() which correctly
 * iterates through the document. For specific diff rejection, we filter
 * and apply manually.
 */
export function executeRejectDiff(args: {
  id?: string
}): ToolResult<{ rejected: boolean; diffId?: string; count?: number }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const diffs = getPendingDiffs(editor)

  if (diffs.length === 0) {
    return toolError('No pending diff suggestions', 'NO_DIFFS')
  }

  // If ID provided, reject specific diff by manually applying the change
  if (id) {
    const targetDiff = diffs.find((d) => d.id === id)
    if (!targetDiff) {
      return toolError(`Diff with id "${id}" not found`, 'DIFF_NOT_FOUND')
    }

    // Find the diff node in the document and replace it with original text
    let found = false
    editor.state.doc.descendants((node, pos) => {
      if (found) return false
      if (node.type.name === 'diffSuggestion' && node.attrs.id === id) {
        const originalText = node.attrs.originalText || ''
        editor.chain()
          .focus()
          .setTextSelection({ from: pos, to: pos + node.nodeSize })
          .insertContent(originalText)
          .run()
        found = true
        return false
      }
    })

    if (found) {
      return toolSuccess({
        rejected: true,
        diffId: id
      })
    } else {
      return toolError('Failed to reject diff', 'REJECT_FAILED')
    }
  }

  // No ID provided - reject ALL diffs using the built-in command
  const success = editor.commands.rejectAllDiffSuggestions()

  if (success) {
    return toolSuccess({
      rejected: true,
      count: diffs.length
    })
  } else {
    return toolError('Failed to reject diffs', 'REJECT_FAILED')
  }
}

/**
 * List all pending diffs (helper for other tools).
 */
export function executeListDiffs(): ToolResult<{ diffs: DiffSuggestion[] }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const diffs = getPendingDiffs(editor)
  return toolSuccess({ diffs })
}
