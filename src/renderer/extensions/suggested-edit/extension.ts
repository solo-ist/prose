/**
 * Suggested Edit Mark Extension for TipTap
 *
 * Uses marks instead of nodes for edit suggestions. Marks automatically
 * track through document changes, solving the position cascade problem
 * when multiple suggestions exist.
 *
 * Key advantages over node-based approach:
 * - Positions track automatically through document edits
 * - Multiple suggestions don't interfere with each other
 * - Simpler to accept/reject individual suggestions
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import type { Command } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { SuggestedEditOptions, SuggestedEditAttributes, SuggestedEditMeta } from './types'
import { useAnnotationStore } from '../ai-annotations/store'
import type { AnnotationType } from '../../types/annotations'

export const suggestedEditPluginKey = new PluginKey('suggestedEdit')

export const SuggestedEdit = Mark.create<SuggestedEditOptions>({
  name: 'suggestedEdit',

  addOptions() {
    return {
      HTMLAttributes: {},
      className: 'suggested-edit',
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-suggestion-id'),
        renderHTML: (attributes) => ({
          'data-suggestion-id': attributes.id,
        }),
      },
      suggestedText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-suggested-text'),
        renderHTML: (attributes) => ({
          'data-suggested-text': attributes.suggestedText,
        }),
      },
      comment: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-comment'),
        renderHTML: (attributes) => ({
          'data-comment': attributes.comment || '',
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
      userReply: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-user-reply'),
        renderHTML: (attributes) => {
          if (!attributes.userReply) return {}
          return { 'data-user-reply': attributes.userReply }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-suggested-edit]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-suggested-edit': '',
        class: this.options.className,
      }),
      0, // Content placeholder
    ]
  },

  addCommands() {
    return {
      setSuggestedEdit:
        (attributes: Partial<SuggestedEditAttributes>): Command =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },

      unsetSuggestedEdit:
        (): Command =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },

      acceptSuggestedEdit:
        (id?: string): Command =>
        ({ state, dispatch, tr }) => {
          if (!dispatch) return false

          const { doc } = state
          let found = false
          const replacements: Array<{
            from: number
            to: number
            text: string
            attrs: SuggestedEditAttributes
          }> = []

          // Find all suggestions (or just the one with matching ID)
          doc.descendants((node, pos) => {
            if (!node.isText) return

            const mark = node.marks.find((m) => m.type.name === this.name)
            if (!mark) return
            if (id && mark.attrs.id !== id) return

            replacements.push({
              from: pos,
              to: pos + node.nodeSize,
              text: mark.attrs.suggestedText || '',
              attrs: mark.attrs as SuggestedEditAttributes,
            })
            found = true

            // If searching for specific ID and found, stop
            if (id) return false
          })

          if (!found) return false

          // Sort by position descending to apply from end to start
          replacements.sort((a, b) => b.from - a.from)

          // Apply replacements
          for (const { from, to, text, attrs } of replacements) {
            // Replace marked text with suggested text
            if (text) {
              tr.replaceWith(from, to, state.schema.text(text))
            } else {
              tr.delete(from, to)
            }

            // Create AI annotation for provenance tracking
            if (attrs.provenanceModel && attrs.documentId && text) {
              const annotationType: AnnotationType = 'replacement'
              useAnnotationStore.getState().addAnnotation({
                documentId: attrs.documentId,
                type: annotationType,
                from,
                to: from + text.length,
                content: text,
                provenance: {
                  model: attrs.provenanceModel,
                  conversationId: attrs.provenanceConversationId || '',
                  messageId: attrs.provenanceMessageId || '',
                },
              })
            }

            // Call onAccept callback if provided
            if (this.options.onAccept) {
              const meta: SuggestedEditMeta = {
                id: attrs.id,
                originalText: '', // Original is the marked text
                suggestedText: text,
                comment: attrs.comment,
                accepted: true,
              }
              this.options.onAccept(meta)
            }
          }

          dispatch(tr)
          return true
        },

      rejectSuggestedEdit:
        (id?: string): Command =>
        ({ state, dispatch, tr }) => {
          if (!dispatch) return false

          const { doc } = state
          let found = false
          const removals: Array<{ from: number; to: number; attrs: SuggestedEditAttributes }> = []

          // Find all suggestions (or just the one with matching ID)
          doc.descendants((node, pos) => {
            if (!node.isText) return

            const mark = node.marks.find((m) => m.type.name === this.name)
            if (!mark) return
            if (id && mark.attrs.id !== id) return

            removals.push({
              from: pos,
              to: pos + node.nodeSize,
              attrs: mark.attrs as SuggestedEditAttributes,
            })
            found = true

            // If searching for specific ID and found, stop
            if (id) return false
          })

          if (!found) return false

          // Sort by position descending
          removals.sort((a, b) => b.from - a.from)

          // Remove marks (keep original text)
          for (const { from, to, attrs } of removals) {
            tr.removeMark(from, to, state.schema.marks[this.name])

            // Call onReject callback if provided
            if (this.options.onReject) {
              const meta: SuggestedEditMeta = {
                id: attrs.id,
                originalText: doc.textBetween(from, to),
                suggestedText: attrs.suggestedText,
                comment: attrs.comment,
                accepted: false,
              }
              this.options.onReject(meta)
            }
          }

          dispatch(tr)
          return true
        },

      acceptAllSuggestedEdits:
        (): Command =>
        ({ commands }) => {
          return commands.acceptSuggestedEdit()
        },

      rejectAllSuggestedEdits:
        (): Command =>
        ({ commands }) => {
          return commands.rejectSuggestedEdit()
        },

      updateSuggestedEditReply:
        (id: string, reply: string): Command =>
        ({ state, dispatch, tr }) => {
          if (!dispatch) return false

          const { doc } = state
          let found = false
          const updates: Array<{ from: number; to: number }> = []

          // Find all text nodes with this suggestion mark
          doc.descendants((node, pos) => {
            if (!node.isText) return

            const mark = node.marks.find((m) => m.type.name === this.name && m.attrs.id === id)
            if (!mark) return

            updates.push({
              from: pos,
              to: pos + node.nodeSize,
            })
            found = true
          })

          if (!found) return false

          // Sort updates in reverse order to preserve positions when modifying
          updates.sort((a, b) => b.from - a.from)

          // Update the mark's userReply attribute
          for (const { from, to } of updates) {
            const existingMark = doc.resolve(from).marks().find((m) => m.type.name === this.name && m.attrs.id === id)
            if (existingMark) {
              const newMark = existingMark.type.create({
                ...existingMark.attrs,
                userReply: reply,
              })
              tr.removeMark(from, to, existingMark)
              tr.addMark(from, to, newMark)
            }
          }

          dispatch(tr)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: suggestedEditPluginKey,
        props: {
          // Handle clicks on suggestions to show panel/popup
          handleClick(view, pos) {
            const { state } = view
            const { doc } = state

            // Check if click is on a suggestion mark
            const $pos = doc.resolve(pos)
            const node = $pos.parent
            if (!node.isTextblock) return false

            const marks = $pos.marks()
            const suggestionMark = marks.find((m) => m.type.name === extension.name)

            if (suggestionMark) {
              // Find the full range of this mark to extract originalText
              const markId = suggestionMark.attrs.id
              let markStart = pos
              let markEnd = pos

              // Find the start and end of the marked text
              doc.descendants((n, p) => {
                if (!n.isText) return
                const m = n.marks.find((mk) => mk.type.name === extension.name && mk.attrs.id === markId)
                if (m) {
                  const nodeEnd = p + n.nodeSize
                  if (p < markStart) markStart = p
                  if (nodeEnd > markEnd) markEnd = nodeEnd
                }
              })

              const originalText = doc.textBetween(markStart, markEnd, ' ')

              // Dispatch a custom event that components can listen to
              const event = new CustomEvent('suggested-edit-clicked', {
                detail: {
                  id: suggestionMark.attrs.id,
                  originalText,
                  suggestedText: suggestionMark.attrs.suggestedText,
                  comment: suggestionMark.attrs.comment,
                  userReply: suggestionMark.attrs.userReply || '',
                  pos,
                },
              })
              window.dispatchEvent(event)
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})
