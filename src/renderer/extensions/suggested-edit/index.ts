/**
 * Mark-based Suggested Edit Extension
 *
 * Exports the TipTap mark extension and related components for
 * managing inline edit suggestions that track through document changes.
 */

import type { Editor } from '@tiptap/core'
import type { SuggestedEditAttributes } from './types'

export { SuggestedEdit, suggestedEditPluginKey } from './extension'
export { SuggestionPanel } from './SuggestionPanel'
export type {
  SuggestedEditAttributes,
  SuggestedEditOptions,
  SuggestedEditMeta,
} from './types'

/**
 * Get all suggestions that have a user reply attached.
 * Used by processSuggestionReplies to send replies to the LLM for revision.
 */
export interface SuggestionWithReply {
  id: string
  originalText: string
  suggestedText: string
  comment: string
  userReply: string
}

export function getSuggestionsWithReplies(editor: Editor): SuggestionWithReply[] {
  const suggestions: SuggestionWithReply[] = []
  const seenIds = new Set<string>()

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return

    const mark = node.marks.find((m) => m.type.name === 'suggestedEdit')
    if (!mark) return

    const attrs = mark.attrs as SuggestedEditAttributes
    if (!attrs.id || !attrs.userReply || seenIds.has(attrs.id)) return

    seenIds.add(attrs.id)

    // Find the full range of this mark to get originalText
    let markStart = pos
    let markEnd = pos

    editor.state.doc.descendants((n, p) => {
      if (!n.isText) return
      const m = n.marks.find((mk) => mk.type.name === 'suggestedEdit' && mk.attrs.id === attrs.id)
      if (m) {
        const nodeEnd = p + n.nodeSize
        if (p < markStart) markStart = p
        if (nodeEnd > markEnd) markEnd = nodeEnd
      }
    })

    const originalText = editor.state.doc.textBetween(markStart, markEnd, ' ')

    suggestions.push({
      id: attrs.id,
      originalText,
      suggestedText: attrs.suggestedText,
      comment: attrs.comment,
      userReply: attrs.userReply,
    })
  })

  return suggestions
}
