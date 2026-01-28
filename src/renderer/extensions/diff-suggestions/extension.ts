/**
 * Diff Suggestions Extension for TipTap
 *
 * Originally from: https://github.com/bsachinthana/tiptap-diff-suggestions
 * Author: Buddhima Sachinthana (@buddhima_a)
 * License: MIT
 *
 * Vendored and modified for Prose by solo.ist
 */

import { Node, mergeAttributes } from '@tiptap/core'
import type { DiffSuggestionOptions } from './types'
import { DiffSuggestionNodeView } from './nodeview'
import { commands } from './commands'

export const DiffSuggestion = Node.create<DiffSuggestionOptions>({
  name: 'diffSuggestion',

  addOptions() {
    return {
      HTMLAttributes: {},
      className: 'diff-suggestion',
      showButtons: true,
      buttons: {
        accept: '✓',
        reject: '✗',
      },
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: { attrs: { originalText?: string } }) {
          // Output the original text (suggestion not yet accepted)
          state.write(node.attrs.originalText || '')
        },
        parse: {},
      },
    }
  },

  group: 'inline',

  inline: true,

  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-diff-suggestion-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {}
          }
          return {
            'data-diff-suggestion-id': attributes.id,
          }
        },
      },
      comment: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-diff-suggestion-comment'),
        renderHTML: (attributes) => {
          return {
            'data-diff-suggestion-comment': attributes.comment || '',
          }
        },
      },
      originalText: {
        default: '',
        parseHTML: (element) => {
          const oldSpan = element.querySelector('[data-diff-suggestion-old]')
          return oldSpan?.textContent || ''
        },
        renderHTML: () => {
          return {}
        },
      },
      suggestedText: {
        default: '',
        parseHTML: (element) => {
          const newSpan = element.querySelector('[data-diff-suggestion-new]')
          return newSpan?.textContent || ''
        },
        renderHTML: () => {
          return {}
        },
      },
      // AI provenance attributes for annotation creation on accept
      provenanceModel: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-model') || '',
        renderHTML: (attributes) => {
          if (!attributes.provenanceModel) return {}
          return { 'data-provenance-model': attributes.provenanceModel }
        },
      },
      provenanceConversationId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-conversation-id') || '',
        renderHTML: (attributes) => {
          if (!attributes.provenanceConversationId) return {}
          return { 'data-provenance-conversation-id': attributes.provenanceConversationId }
        },
      },
      provenanceMessageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-message-id') || '',
        renderHTML: (attributes) => {
          if (!attributes.provenanceMessageId) return {}
          return { 'data-provenance-message-id': attributes.provenanceMessageId }
        },
      },
      documentId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-document-id') || '',
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
        tag: 'span[data-diff-suggestion]',
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-diff-suggestion': '',
        'data-diff-suggestion-id': node.attrs.id,
        'data-diff-suggestion-comment': node.attrs.comment ?? '',
        contenteditable: 'false',
        class: this.options.className,
      }),
      ['span', { 'data-diff-suggestion-old': '' }, node.attrs.originalText || ''],
      ['span', { 'data-diff-suggestion-new': '' }, node.attrs.suggestedText || ''],
    ]
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      return new DiffSuggestionNodeView(node, view, getPos, this.options)
    }
  },

  addCommands() {
    return commands
  },
})
