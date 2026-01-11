/**
 * Editor tool executors - tools for modifying document content.
 */

import type { Editor } from '@tiptap/core'
import type { ToolResult, DiffSuggestion } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import {
  findTextInDocument,
  findFuzzyMatch,
  applyEditDirect,
  applyEditAsDiff
} from '../../applyEdit'
import { generateId } from '../../persistence'

/**
 * Get the TipTap editor instance.
 */
function getEditor(): Editor | null {
  return useEditorInstanceStore.getState().editor
}

/**
 * edit - Replace text in the document using SEARCH/REPLACE pattern.
 */
export function executeEdit(args: {
  search: string
  replace: string
  fuzzy?: boolean
}): ToolResult<{ applied: boolean; matchInfo?: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { search, replace, fuzzy = true } = args

  if (!search) {
    return toolError('Search text is required', 'INVALID_INPUT')
  }

  const { document } = useEditorStore.getState()

  const result = applyEditDirect(
    editor,
    { id: generateId(), search, replace },
    undefined, // No provenance for tool-based edits (added at higher level)
    document.documentId
  )

  if (result.success) {
    return toolSuccess({
      applied: true,
      matchInfo: `Replaced "${search.slice(0, 30)}${search.length > 30 ? '...' : ''}" with "${replace.slice(0, 30)}${replace.length > 30 ? '...' : ''}"`
    })
  } else {
    // If exact match failed and fuzzy is enabled, the applyEditDirect already tried fuzzy
    return toolError(result.error || 'Failed to apply edit', 'EDIT_FAILED')
  }
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
 * suggest_edit - Show a diff suggestion without applying it.
 */
export function executeSuggestEdit(args: {
  search: string
  replace: string
  comment?: string
  fuzzy?: boolean
}): ToolResult<{ suggested: boolean; diffId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { search, replace, comment, fuzzy = true } = args

  if (!search) {
    return toolError('Search text is required', 'INVALID_INPUT')
  }

  const { document } = useEditorStore.getState()
  const diffId = generateId()

  const result = applyEditAsDiff(
    editor,
    { id: diffId, search, replace },
    comment,
    undefined, // Provenance added at higher level if needed
    document.documentId
  )

  if (result.success) {
    return toolSuccess({
      suggested: true,
      diffId: result.diffId || diffId
    })
  } else {
    return toolError(result.error || 'Failed to create suggestion', 'SUGGEST_FAILED')
  }
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
 */
export function executeAcceptDiff(args: {
  id?: string
}): ToolResult<{ accepted: boolean; diffId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const diffs = getPendingDiffs(editor)

  if (diffs.length === 0) {
    return toolError('No pending diff suggestions', 'NO_DIFFS')
  }

  // Find the diff to accept
  const targetDiff = id ? diffs.find((d) => d.id === id) : diffs[0]

  if (!targetDiff) {
    return toolError(`Diff with id "${id}" not found`, 'DIFF_NOT_FOUND')
  }

  // Use the editor command to accept the diff
  const success = editor.commands.acceptDiffSuggestion(targetDiff.id)

  if (success) {
    return toolSuccess({
      accepted: true,
      diffId: targetDiff.id
    })
  } else {
    return toolError('Failed to accept diff', 'ACCEPT_FAILED')
  }
}

/**
 * reject_diff - Reject a pending diff suggestion.
 */
export function executeRejectDiff(args: {
  id?: string
}): ToolResult<{ rejected: boolean; diffId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const diffs = getPendingDiffs(editor)

  if (diffs.length === 0) {
    return toolError('No pending diff suggestions', 'NO_DIFFS')
  }

  // Find the diff to reject
  const targetDiff = id ? diffs.find((d) => d.id === id) : diffs[0]

  if (!targetDiff) {
    return toolError(`Diff with id "${id}" not found`, 'DIFF_NOT_FOUND')
  }

  // Use the editor command to reject the diff
  const success = editor.commands.rejectDiffSuggestion(targetDiff.id)

  if (success) {
    return toolSuccess({
      rejected: true,
      diffId: targetDiff.id
    })
  } else {
    return toolError('Failed to reject diff', 'REJECT_FAILED')
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
