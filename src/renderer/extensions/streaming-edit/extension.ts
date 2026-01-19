/**
 * Streaming Edit Extension for TipTap
 *
 * Provides visual feedback during LLM streaming edits.
 * Shows original text struck through with new text appearing character-by-character.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import type { Command } from '@tiptap/core'
import type { StreamingEditOptions, StreamingEditAttributes } from './types'
import { StreamingEditNodeView } from './nodeview'
import { useAnnotationStore } from '../ai-annotations/store'
import type { AnnotationType } from '../../types/annotations'

export const StreamingEdit = Node.create<StreamingEditOptions>({
  name: 'streamingEdit',

  addOptions() {
    return {
      HTMLAttributes: {},
      className: 'streaming-edit',
    }
  },

  group: 'inline',

  inline: true,

  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-streaming-id'),
        renderHTML: (attributes) => ({
          'data-streaming-id': attributes.id,
        }),
      },
      originalText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-original-text'),
        renderHTML: (attributes) => ({
          'data-original-text': attributes.originalText,
        }),
      },
      streamedText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-streamed-text'),
        renderHTML: (attributes) => ({
          'data-streamed-text': attributes.streamedText,
        }),
      },
      isComplete: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-is-complete') === 'true',
        renderHTML: (attributes) => ({
          'data-is-complete': attributes.isComplete ? 'true' : 'false',
        }),
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
        parseHTML: (element) => element.getAttribute('data-provenance-conversation-id'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceConversationId) return {}
          return { 'data-provenance-conversation-id': attributes.provenanceConversationId }
        },
      },
      provenanceMessageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-message-id'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceMessageId) return {}
          return { 'data-provenance-message-id': attributes.provenanceMessageId }
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
        tag: 'span[data-streaming-edit]',
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-streaming-edit': '',
        class: this.options.className,
        contenteditable: 'false',
      }),
      [
        'span',
        { class: 'streaming-edit-original' },
        node.attrs.originalText || '',
      ],
      [
        'span',
        { class: 'streaming-edit-new' },
        node.attrs.streamedText || '',
      ],
      node.attrs.isComplete ? null : ['span', { class: 'streaming-cursor' }],
    ].filter(Boolean)
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      return new StreamingEditNodeView(node, view, getPos, this.options)
    }
  },

  addCommands() {
    return {
      insertStreamingEdit:
        (attributes: Partial<StreamingEditAttributes>): Command =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          })
        },

      updateStreamingEdit:
        (id: string, text: string): Command =>
        ({ state, dispatch, tr }) => {
          if (!dispatch) return false

          let found = false

          state.doc.descendants((node, pos) => {
            if (found) return false
            if (node.type.name !== this.name) return
            if (node.attrs.id !== id) return

            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              streamedText: text,
            })
            found = true
            return false
          })

          if (found) {
            dispatch(tr)
            return true
          }

          return false
        },

      completeStreamingEdit:
        (id: string): Command =>
        ({ state, dispatch, tr }) => {
          if (!dispatch) return false

          let found = false

          state.doc.descendants((node, pos) => {
            if (found) return false
            if (node.type.name !== this.name) return
            if (node.attrs.id !== id) return

            const { streamedText, provenanceModel, provenanceConversationId, provenanceMessageId, documentId } = node.attrs

            // Replace the streaming node with final text
            tr.replaceWith(pos, pos + node.nodeSize, state.schema.text(streamedText || ''))

            // Create AI annotation for provenance tracking
            if (provenanceModel && documentId && streamedText) {
              const annotationType: AnnotationType = 'replacement'
              useAnnotationStore.getState().addAnnotation({
                documentId,
                type: annotationType,
                from: pos,
                to: pos + streamedText.length,
                content: streamedText,
                provenance: {
                  model: provenanceModel,
                  conversationId: provenanceConversationId || '',
                  messageId: provenanceMessageId || '',
                },
              })
            }

            found = true

            // Call onComplete callback if provided
            if (this.options.onComplete) {
              this.options.onComplete(id, streamedText || '')
            }

            return false
          })

          if (found) {
            dispatch(tr)
            return true
          }

          return false
        },

      cancelStreamingEdit:
        (id: string): Command =>
        ({ state, dispatch, tr }) => {
          if (!dispatch) return false

          let found = false

          state.doc.descendants((node, pos) => {
            if (found) return false
            if (node.type.name !== this.name) return
            if (node.attrs.id !== id) return

            const { originalText } = node.attrs

            // Replace the streaming node with original text
            tr.replaceWith(pos, pos + node.nodeSize, state.schema.text(originalText || ''))
            found = true
            return false
          })

          if (found) {
            dispatch(tr)
            return true
          }

          return false
        },
    }
  },
})
