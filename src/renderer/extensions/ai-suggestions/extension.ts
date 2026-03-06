/**
 * AI Suggestion Mark Extension for TipTap
 *
 * Allows AI to add edit suggestions to text that appear as purple highlights.
 * Users can click to see the suggested change and accept/reject it.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type { AISuggestionOptions, AISuggestionData, SuggestionType } from './types'
import { useAnnotationStore } from '../ai-annotations'

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
        provenanceModel?: string
        provenanceConversationId?: string
        provenanceMessageId?: string
        documentId?: string
      }) => ReturnType
      /**
       * Set user reply on an AI suggestion by ID
       */
      setAISuggestionReply: (id: string, reply: string) => ReturnType
      /**
       * Accept an AI suggestion by ID - replaces text with suggested text
       */
      acceptAISuggestion: (id: string) => ReturnType
      /**
       * Reject an AI suggestion by ID - removes the mark
       */
      rejectAISuggestion: (id: string) => ReturnType
      /**
       * Accept all AI suggestions
       */
      acceptAllAISuggestions: () => ReturnType
      /**
       * Reject all AI suggestions
       */
      rejectAllAISuggestions: () => ReturnType
      /**
       * Restore AI suggestions from persisted data (used after tab switch)
       */
      restoreAISuggestions: (suggestions: AISuggestionData[]) => ReturnType
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

  addStorage() {
    return {
      markdown: {
        serialize: aiSuggestionMarkdownSerializer,
      },
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
      userReply: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-ai-user-reply'),
        renderHTML: (attributes) => {
          if (!attributes.userReply) return {}
          return { 'data-ai-user-reply': attributes.userReply }
        },
      },
      provenanceModel: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-model'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceModel) return {}
          return { 'data-provenance-model': attributes.provenanceModel }
        },
      },
      provenanceConversationId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-conversation'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceConversationId) return {}
          return { 'data-provenance-conversation': attributes.provenanceConversationId }
        },
      },
      provenanceMessageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-message'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceMessageId) return {}
          return { 'data-provenance-message': attributes.provenanceMessageId }
        },
      },
      documentId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-document-id'),
        renderHTML: (attributes) => {
          if (!attributes.documentId) return {}
          return { 'data-document-id': attributes.documentId }
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
            provenanceModel: attrs.provenanceModel || '',
            provenanceConversationId: attrs.provenanceConversationId || '',
            provenanceMessageId: attrs.provenanceMessageId || '',
            documentId: attrs.documentId || '',
          })

          if (result && this.options.onSuggestionAdded) {
            this.options.onSuggestionAdded(suggestionData)
          }

          return result
        },

      setAISuggestionReply:
        (id, reply) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          const positions: Array<{ pos: number; nodeSize: number; mark: typeof state.schema.marks.aiSuggestion }> = []
          let existingAttrs: Record<string, unknown> | null = null

          // Find all nodes with this suggestion mark
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                if (!existingAttrs) {
                  existingAttrs = mark.attrs
                }
                positions.push({ pos, nodeSize: node.nodeSize, mark: mark.type })
              }
            })
          })

          if (positions.length === 0 || !existingAttrs) return false

          // Calculate the full range
          const markFrom = positions[0].pos
          const lastPos = positions[positions.length - 1]
          const markTo = lastPos.pos + lastPos.nodeSize

          // Remove the old mark and add new one with userReply
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)
          tr.addMark(
            markFrom,
            markTo,
            state.schema.marks.aiSuggestion.create({
              ...existingAttrs,
              userReply: reply
            })
          )

          dispatch(tr)
          return true
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

          // Replace the text with suggested text, or delete if empty
          if (suggestedText.length > 0) {
            tr.replaceWith(markFrom, markTo, state.schema.text(suggestedText))
          } else {
            tr.delete(markFrom, markTo)
          }

          // Create AI annotation for provenance tracking
          const attrs = suggestionAttrs as {
            provenanceModel?: string
            provenanceConversationId?: string
            provenanceMessageId?: string
            documentId?: string
          }

          // Use fallbacks: store's documentId, or 'unknown' for model
          const annotationStore = useAnnotationStore.getState()
          const docId = attrs.documentId || annotationStore.documentId
          const model = attrs.provenanceModel || 'unknown'

          dispatch(tr)

          // Create annotation after dispatch so positions reference the updated document.
          // Use transaction mapping: replaceWith(markFrom, markTo, text) places the new
          // text at [markFrom, markFrom + text.nodeSize) in the new state.
          if (docId && suggestedText.length > 0) {
            const newFrom = tr.mapping.map(markFrom, -1)
            const newTo = tr.mapping.map(markTo, 1)
            console.log('[AISuggestion] Creating annotation:', { docId, model, from: newFrom, to: newTo })
            annotationStore.addAnnotation({
              documentId: docId,
              type: 'insertion',
              from: newFrom,
              to: newTo,
              content: suggestedText,
              provenance: {
                model,
                conversationId: attrs.provenanceConversationId || '',
                messageId: attrs.provenanceMessageId || '',
              },
            })
          } else {
            console.warn('[AISuggestion] Cannot create annotation - missing docId:', { docId, suggestedText: suggestedText.length })
          }

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

      acceptAllAISuggestions:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state

          // Collect all suggestions with their positions and data
          // We need to process from end to start to avoid position shifts
          const suggestions: Array<{
            id: string
            from: number
            to: number
            suggestedText: string
          }> = []

          // First pass: collect all unique suggestion IDs and their ranges
          const seenIds = new Set<string>()
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id && !seenIds.has(mark.attrs.id)) {
                seenIds.add(mark.attrs.id)

                // Find full range of this suggestion
                const positions: Array<{ pos: number; nodeSize: number }> = []
                doc.descendants((n, p) => {
                  n.marks.forEach((m) => {
                    if (m.type.name === this.name && m.attrs.id === mark.attrs.id) {
                      positions.push({ pos: p, nodeSize: n.nodeSize })
                    }
                  })
                })

                if (positions.length > 0) {
                  const from = positions[0].pos
                  const lastPos = positions[positions.length - 1]
                  const to = lastPos.pos + lastPos.nodeSize

                  suggestions.push({
                    id: mark.attrs.id,
                    from,
                    to,
                    suggestedText: mark.attrs.suggestedText || ''
                  })
                }
              }
            })
          })

          if (suggestions.length === 0) return false

          // Sort by position descending so we can apply from end to start
          suggestions.sort((a, b) => b.from - a.from)

          // Apply each suggestion
          for (const suggestion of suggestions) {
            tr.removeMark(suggestion.from, suggestion.to, state.schema.marks.aiSuggestion)
            if (suggestion.suggestedText.length > 0) {
              tr.replaceWith(suggestion.from, suggestion.to, state.schema.text(suggestion.suggestedText))
            } else {
              tr.delete(suggestion.from, suggestion.to)
            }

            if (this.options.onSuggestionAccepted) {
              this.options.onSuggestionAccepted(suggestion.id)
            }
          }

          dispatch(tr)
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

      restoreAISuggestions:
        (suggestions) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch || suggestions.length === 0) return false

          const { doc, schema } = state
          let restored = 0

          // Process each suggestion
          for (const suggestion of suggestions) {
            // Find the original text in the document
            const docText = doc.textContent
            const searchText = suggestion.originalText

            if (!searchText) {
              console.warn('[AISuggestion] Cannot restore suggestion without originalText:', suggestion.id)
              continue
            }

            // Find position of originalText in document
            const textIndex = docText.indexOf(searchText)
            if (textIndex === -1) {
              console.warn('[AISuggestion] Cannot find originalText in document:', {
                id: suggestion.id,
                originalText: searchText.substring(0, 50)
              })
              continue
            }

            // Convert text index to document position
            // We need to walk the document to find the correct ProseMirror position
            let pos = 0
            let charCount = 0
            let foundStart = -1
            let foundEnd = -1

            doc.descendants((node, nodePos) => {
              if (foundStart !== -1 && foundEnd !== -1) return false // Already found

              if (node.isText && node.text) {
                const nodeText = node.text
                const nodeStart = charCount
                const nodeEnd = charCount + nodeText.length

                // Check if our target text starts in this node
                if (foundStart === -1 && textIndex >= nodeStart && textIndex < nodeEnd) {
                  // Target starts in this node
                  const offsetInNode = textIndex - nodeStart
                  foundStart = nodePos + offsetInNode
                }

                // Check if our target text ends in this node
                const targetEnd = textIndex + searchText.length
                if (foundStart !== -1 && targetEnd > nodeStart && targetEnd <= nodeEnd) {
                  const offsetInNode = targetEnd - nodeStart
                  foundEnd = nodePos + offsetInNode
                  return false // Stop searching
                }

                charCount += nodeText.length
              }
            })

            if (foundStart === -1 || foundEnd === -1) {
              console.warn('[AISuggestion] Could not map text position:', suggestion.id)
              continue
            }

            // Apply the suggestion mark
            const mark = schema.marks.aiSuggestion.create({
              id: suggestion.id,
              type: suggestion.type,
              originalText: suggestion.originalText,
              suggestedText: suggestion.suggestedText,
              explanation: suggestion.explanation,
              createdAt: suggestion.createdAt,
              userReply: suggestion.userReply || null,
              provenanceModel: suggestion.provenanceModel || '',
              provenanceConversationId: suggestion.provenanceConversationId || '',
              provenanceMessageId: suggestion.provenanceMessageId || '',
              documentId: suggestion.documentId || '',
            })

            tr.addMark(foundStart, foundEnd, mark)
            restored++

            console.log('[AISuggestion] Restored suggestion:', {
              id: suggestion.id,
              from: foundStart,
              to: foundEnd
            })
          }

          if (restored > 0) {
            dispatch(tr)
            console.log('[AISuggestion] Restored', restored, 'of', suggestions.length, 'suggestions')
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
                userReply?: string
                provenanceModel?: string
                provenanceConversationId?: string
                provenanceMessageId?: string
                documentId?: string
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
          userReply: mark.attrs.userReply || undefined,
          provenanceModel: mark.attrs.provenanceModel || undefined,
          provenanceConversationId: mark.attrs.provenanceConversationId || undefined,
          provenanceMessageId: mark.attrs.provenanceMessageId || undefined,
          documentId: mark.attrs.documentId || undefined,
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

/**
 * Get AI suggestions that have pending user feedback (userReply set)
 */
export function getSuggestionsWithFeedback(editor: Parameters<typeof getAISuggestions>[0]): AISuggestionData[] {
  return getAISuggestions(editor).filter((s) => s.userReply && s.userReply.trim() !== '')
}

export default AISuggestion
