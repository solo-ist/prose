/**
 * Apply edit blocks to the TipTap editor as inline diff suggestions.
 */

import type { Editor } from '@tiptap/core'
import type { EditBlock } from './editBlocks'

export interface ApplyResult {
  success: boolean
  error?: string
  matchCount?: number
  diffId?: string
}

export interface TextMatch {
  from: number
  to: number
}

/**
 * Find all occurrences of a search string in the document.
 * Returns positions suitable for TipTap text selection.
 */
export function findTextInDocument(editor: Editor, search: string): TextMatch[] {
  const matches: TextMatch[] = []
  const doc = editor.state.doc

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      let index = 0
      const text = node.text

      while ((index = text.indexOf(search, index)) !== -1) {
        matches.push({
          from: pos + index,
          to: pos + index + search.length,
        })
        index += 1
      }
    }
  })

  return matches
}

/**
 * Apply a single edit as an inline diff suggestion.
 * The edit will appear in the document with accept/reject buttons.
 */
export function applyEditAsDiff(
  editor: Editor,
  editBlock: EditBlock,
  comment?: string
): ApplyResult {
  const { id, search, replace } = editBlock

  // Validate inputs
  if (!search) {
    return {
      success: false,
      error: 'Search text is empty',
    }
  }

  // Find the search text in the document
  const matches = findTextInDocument(editor, search)

  if (matches.length === 0) {
    return {
      success: false,
      error: `Text not found: "${search.slice(0, 50)}${search.length > 50 ? '...' : ''}"`,
      matchCount: 0,
    }
  }

  // Use the first match
  const match = matches[0]

  // Insert the diff suggestion node
  editor
    .chain()
    .focus()
    .setTextSelection(match)
    .insertContent({
      type: 'diffSuggestion',
      attrs: {
        id,
        comment: comment || '',
        originalText: search,
        suggestedText: replace,
      },
    })
    .run()

  return {
    success: true,
    matchCount: matches.length,
    diffId: id,
  }
}

/**
 * Apply multiple edits as inline diff suggestions.
 * Applies in reverse order to preserve positions.
 */
export function applyEditsAsDiffs(
  editor: Editor,
  editBlocks: EditBlock[],
  comment?: string
): ApplyResult[] {
  const results: ApplyResult[] = []

  // Apply in reverse order to preserve positions
  for (let i = editBlocks.length - 1; i >= 0; i--) {
    const result = applyEditAsDiff(editor, editBlocks[i], comment)
    results.unshift(result) // Add to front to maintain original order
  }

  return results
}

/**
 * Get count of pending diff suggestions in the document.
 */
export function countPendingDiffs(editor: Editor): number {
  let count = 0

  editor.state.doc.descendants((node) => {
    if (node.type.name === 'diffSuggestion') {
      count++
    }
  })

  return count
}
