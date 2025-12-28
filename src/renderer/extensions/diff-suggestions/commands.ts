/**
 * Diff Suggestions Extension for TipTap
 *
 * Originally from: https://github.com/bsachinthana/tiptap-diff-suggestions
 * Author: Buddhima Sachinthana (@buddhima_a)
 * License: MIT
 *
 * Vendored and modified for Prose by solo.ist
 */

import type { Command } from '@tiptap/core'
import type { DiffSuggestionAttributes, DiffSuggestionMeta } from './types'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diffSuggestion: {
      insertDiffSuggestion: (options: DiffSuggestionAttributes) => ReturnType
      acceptDiffSuggestion: (id?: string) => ReturnType
      rejectDiffSuggestion: (id?: string) => ReturnType
      acceptAllDiffSuggestions: () => ReturnType
      rejectAllDiffSuggestions: () => ReturnType
    }
  }
}

export const defaultHandleSuggestion = (
  action: 'accept' | 'reject',
  onAction?: (meta: DiffSuggestionMeta) => void
): Command =>
  ({ state, dispatch }) => {
    const { selection } = state
    const { $from } = selection
    const node = $from.parent

    if (node?.type?.name !== 'diffSuggestion') return false

    const content =
      action === 'accept' ? node.attrs.suggestedText : node.attrs.originalText

    const meta: DiffSuggestionMeta = {
      id: node.attrs.id || '',
      comment: node.attrs.comment,
      accepted: action === 'accept',
      originalText: node.attrs.originalText || '',
      suggestedText: node.attrs.suggestedText || '',
    }

    if (content && dispatch) {
      const tr = state.tr
      const { from, to } = selection
      tr.insertText(content, from, to)
      dispatch(tr)
      onAction?.(meta)
      return true
    }

    return false
  }

export const commands = {
  insertDiffSuggestion:
    (options: DiffSuggestionAttributes): Command =>
    ({ commands }) => {
      return commands.insertContent({
        type: 'diffSuggestion',
        attrs: options,
      })
    },

  acceptDiffSuggestion:
    (_id?: string): Command =>
    (props) => {
      const extension = (
        props as { editor?: { extensionManager?: { extensions?: Array<{ name: string; options?: Record<string, unknown> }> } } }
      ).editor?.extensionManager?.extensions?.find(
        (ext) => ext.name === 'diffSuggestion'
      )

      const { handleAccept, onAccept } = (extension?.options as { handleAccept?: Command; onAccept?: (meta: DiffSuggestionMeta) => void }) || {}

      return handleAccept
        ? handleAccept(props)
        : defaultHandleSuggestion('accept', onAccept)(props)
    },

  rejectDiffSuggestion:
    (_id?: string): Command =>
    (props) => {
      const extension = (
        props as { editor?: { extensionManager?: { extensions?: Array<{ name: string; options?: Record<string, unknown> }> } } }
      ).editor?.extensionManager?.extensions?.find(
        (ext) => ext.name === 'diffSuggestion'
      )

      const { handleReject, onReject } = (extension?.options as { handleReject?: Command; onReject?: (meta: DiffSuggestionMeta) => void }) || {}

      return handleReject
        ? handleReject(props)
        : defaultHandleSuggestion('reject', onReject)(props)
    },

  acceptAllDiffSuggestions:
    (): Command =>
    ({ state, dispatch }) => {
      if (!dispatch) return false

      const { tr } = state
      let modified = false
      const replacements: Array<{ pos: number; nodeSize: number; text: string }> = []

      state.doc.descendants((node, pos) => {
        if (node.type.name === 'diffSuggestion') {
          const suggestedText = node.attrs.suggestedText || ''
          if (suggestedText) {
            replacements.push({ pos, nodeSize: node.nodeSize, text: suggestedText })
            modified = true
          }
        }
      })

      // Apply replacements in reverse order to preserve positions
      for (let i = replacements.length - 1; i >= 0; i--) {
        const { pos, nodeSize, text } = replacements[i]
        tr.replaceWith(pos, pos + nodeSize, state.schema.text(text))
      }

      if (modified) {
        dispatch(tr)
        return true
      }

      return false
    },

  rejectAllDiffSuggestions:
    (): Command =>
    ({ state, dispatch }) => {
      if (!dispatch) return false

      const { tr } = state
      let modified = false
      const replacements: Array<{ pos: number; nodeSize: number; text: string }> = []

      state.doc.descendants((node, pos) => {
        if (node.type.name === 'diffSuggestion') {
          const originalText = node.attrs.originalText || ''
          if (originalText) {
            replacements.push({ pos, nodeSize: node.nodeSize, text: originalText })
            modified = true
          }
        }
      })

      // Apply replacements in reverse order to preserve positions
      for (let i = replacements.length - 1; i >= 0; i--) {
        const { pos, nodeSize, text } = replacements[i]
        tr.replaceWith(pos, pos + nodeSize, state.schema.text(text))
      }

      if (modified) {
        dispatch(tr)
        return true
      }

      return false
    },
}
