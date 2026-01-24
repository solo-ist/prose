/**
 * AI Suggestion Mark Extension for TipTap
 *
 * Allows AI to add edit suggestions to text that appear as purple highlights.
 * Users can click to see the suggested change and accept/reject it.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type { AISuggestionOptions, AISuggestionData, SuggestionType } from './types'

/**
 * Markdown serializer for AI suggestion marks - outputs just the text content
 */
export const aiSuggestionMarkdownSerializer: MarkSerializerSpec = {
  open: '',
  close: '',
  mixable: true,
  expelEnclosingWhitespace: true,
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiSuggestion: {
      /**
       * Add an AI suggestion to the current selection (for edits)
       */
      setAISuggestion: (attrs: {
        id: string
        type: SuggestionType
        originalText: string
        suggestedText: string
        explanation: string
      }) => ReturnType
      /**
       * Accept an AI suggestion by ID - replaces text with suggested text
       */
      acceptAISuggestion: (id: string) => ReturnType
      /**
       * Reject an AI suggestion by ID - removes the mark
       */
      rejectAISuggestion: (id: string) => ReturnType
      /**
       * Reject all AI suggestions
       */
      rejectAllAISuggestions: () => ReturnType
    }
  }
}

export const AISuggestion = Mark.create<AISuggestionOptions>({
  name: 'aiSuggestion',

  addOptions() {
    return {
      HTMLAttributes: {},
      onSuggestionAdded: undefined,
      onSuggestionAccepted: undefined,
      onSuggestionRejected: undefined,
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-ai-suggestion-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {}
          return { 'data-ai-suggestion-id': attributes.id }
        },
      },
      type: {
        default: 'edit',
        parseHTML: (element) => element.getAttribute('data-ai-suggestion-type') || 'edit',
        renderHTML: (attributes) => {
          return { 'data-ai-suggestion-type': attributes.type || 'edit' }
        },
      },
      originalText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-original'),
        renderHTML: (attributes) => {
          return { 'data-ai-original': attributes.originalText || '' }
        },
      },
      suggestedText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-suggested'),
        renderHTML: (attributes) => {
          return { 'data-ai-suggested': attributes.suggestedText || '' }
        },
      },
      explanation: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-explanation'),
        renderHTML: (attributes) => {
          return { 'data-ai-explanation': attributes.explanation || '' }
        },
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-ai-created')
          return val ? parseInt(val, 10) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.createdAt) return {}
          return { 'data-ai-created': String(attributes.createdAt) }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ai-suggestion-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes || {}, HTMLAttributes, {
        class: 'ai-suggestion-mark',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setAISuggestion:
        (attrs) =>
        ({ commands, state }) => {
          const { from, to } = state.selection

          const suggestionData: AISuggestionData = {
            id: attrs.id,
            type: attrs.type,
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt: Date.now(),
            from,
            to,
          }

          const result = commands.setMark(this.name, {
            id: attrs.id,
            type: attrs.type,
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt: Date.now(),
          })

          if (result && this.options.onSuggestionAdded) {
            this.options.onSuggestionAdded(suggestionData)
          }

          return result
        },

      acceptAISuggestion:
        (id) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          let suggestionAttrs: Record<string, unknown> | null = null
          const positions: Array<{ pos: number; nodeSize: number }> = []

          // Find all nodes with this suggestion mark (mark can span multiple text nodes
          // when inline formatting like bold/italic is present)
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                if (!suggestionAttrs) {
                  suggestionAttrs = mark.attrs
                }
                positions.push({ pos, nodeSize: node.nodeSize })
              }
            })
          })

          if (positions.length === 0 || !suggestionAttrs) return false

          // Calculate the full range from first to last node
          const markFrom = positions[0].pos
          const lastPos = positions[positions.length - 1]
          const markTo = lastPos.pos + lastPos.nodeSize

          // Get the suggested text
          const suggestedText = (suggestionAttrs as { suggestedText?: string }).suggestedText || ''

          // Remove the mark first
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)

          // Replace the text with suggested text
          tr.replaceWith(markFrom, markTo, state.schema.text(suggestedText))

          dispatch(tr)

          if (this.options.onSuggestionAccepted) {
            this.options.onSuggestionAccepted(id)
          }

          return true
        },

      rejectAISuggestion:
        (id) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          const positions: Array<{ pos: number; nodeSize: number }> = []

          // Find all nodes with this suggestion mark (mark can span multiple text nodes
          // when inline formatting like bold/italic is present)
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                positions.push({ pos, nodeSize: node.nodeSize })
              }
            })
          })

          if (positions.length === 0) return false

          // Calculate the full range from first to last node
          const markFrom = positions[0].pos
          const lastPos = positions[positions.length - 1]
          const markTo = lastPos.pos + lastPos.nodeSize

          // Remove the mark across the entire range
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)

          dispatch(tr)

          if (this.options.onSuggestionRejected) {
            this.options.onSuggestionRejected(id)
          }

          return true
        },

      rejectAllAISuggestions:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          let removed = false

          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name) {
                tr.removeMark(pos, pos + node.nodeSize, mark.type)
                removed = true

                if (this.options.onSuggestionRejected && mark.attrs.id) {
                  this.options.onSuggestionRejected(mark.attrs.id)
                }
              }
            })
          })

          if (removed) {
            dispatch(tr)
            return true
          }

          return false
        },
    }
  },
})

/**
 * Extract all AI suggestions from the editor
 */
export function getAISuggestions(editor: {
  state: {
    doc: {
      descendants: (
        fn: (
          node: {
            marks: Array<{
              type: { name: string }
              attrs: {
                id: string
                type: SuggestionType
                originalText: string
                suggestedText: string
                explanation: string
                createdAt: number
              }
            }>
            nodeSize: number
            textContent: string
          },
          pos: number
        ) => void
      ) => void
    }
  }
}): AISuggestionData[] {
  const suggestions: AISuggestionData[] = []

  editor.state.doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === 'aiSuggestion' && mark.attrs.id) {
        suggestions.push({
          id: mark.attrs.id,
          type: mark.attrs.type || 'edit',
          originalText: mark.attrs.originalText || '',
          suggestedText: mark.attrs.suggestedText || '',
          explanation: mark.attrs.explanation || '',
          createdAt: mark.attrs.createdAt || Date.now(),
          from: pos,
          to: pos + node.nodeSize,
        })
      }
    })
  })

  // Dedupe by ID (marks can span multiple text nodes)
  const seen = new Set<string>()
  return suggestions.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
}

export default AISuggestion
