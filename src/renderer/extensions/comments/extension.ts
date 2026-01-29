/**
 * Comment Mark Extension for TipTap
 *
 * Allows users to add comments to selected text.
 * Comments are instructions for AI to process.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type { CommentOptions, CommentData } from './types'

/**
 * Markdown serializer for comment marks - outputs just the text content
 * so comments don't appear as HTML in markdown output
 */
export const commentMarkdownSerializer: MarkSerializerSpec = {
  open: '',
  close: '',
  mixable: true,
  expelEnclosingWhitespace: true,
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /**
       * Add a comment to the current selection
       */
      setComment: (attrs: { id: string; comment: string }) => ReturnType
      /**
       * Remove a comment by ID
       */
      unsetComment: (id?: string) => ReturnType
      /**
       * Remove all comments
       */
      unsetAllComments: () => ReturnType
    }
  }
}

export const Comment = Mark.create<CommentOptions>({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentAdded: undefined,
      onCommentRemoved: undefined,
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: commentMarkdownSerializer,
      },
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {}
          return { 'data-comment-id': attributes.id }
        },
      },
      comment: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-comment'),
        renderHTML: (attributes) => {
          return { 'data-comment': attributes.comment || '' }
        },
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-comment-created')
          return val ? parseInt(val, 10) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.createdAt) return {}
          return { 'data-comment-created': String(attributes.createdAt) }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes || {}, HTMLAttributes, {
        class: 'comment-mark',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setComment:
        (attrs) =>
        ({ commands, state }) => {
          const { from, to } = state.selection

          // Get the selected text
          const markedText = state.doc.textBetween(from, to, ' ')

          const commentData: CommentData = {
            id: attrs.id,
            markedText,
            comment: attrs.comment,
            createdAt: Date.now(),
            from,
            to,
          }

          const result = commands.setMark(this.name, {
            id: attrs.id,
            comment: attrs.comment,
            createdAt: Date.now(),
          })

          if (result && this.options.onCommentAdded) {
            this.options.onCommentAdded(commentData)
          }

          return result
        },

      unsetComment:
        (id) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          let removed = false

          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name) {
                // If no ID specified, remove all; otherwise match ID
                if (!id || mark.attrs.id === id) {
                  tr.removeMark(pos, pos + node.nodeSize, mark.type)
                  removed = true

                  if (this.options.onCommentRemoved && mark.attrs.id) {
                    this.options.onCommentRemoved(mark.attrs.id)
                  }
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

      unsetAllComments:
        () =>
        ({ commands }) => {
          return commands.unsetComment()
        },
    }
  },
})

/**
 * Extract all comments from the editor
 */
export function getComments(editor: { state: { doc: { descendants: (fn: (node: { marks: Array<{ type: { name: string }; attrs: { id: string; comment: string; createdAt: number } }>; nodeSize: number; textContent: string }, pos: number) => void) => void } } }): CommentData[] {
  // Map to collect all text nodes for each comment ID
  const commentMap = new Map<string, {
    texts: string[]
    comment: string
    createdAt: number
    from: number
    to: number
  }>()

  editor.state.doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === 'comment' && mark.attrs.id) {
        const existing = commentMap.get(mark.attrs.id)

        if (existing) {
          // Add this node's text to the existing comment
          existing.texts.push(node.textContent)
          // Extend the range to include this node
          existing.to = pos + node.nodeSize
        } else {
          // First occurrence of this comment ID
          commentMap.set(mark.attrs.id, {
            texts: [node.textContent],
            comment: mark.attrs.comment || '',
            createdAt: mark.attrs.createdAt || Date.now(),
            from: pos,
            to: pos + node.nodeSize,
          })
        }
      }
    })
  })

  // Convert map to array, joining all text nodes with paragraph separator
  const comments: CommentData[] = []
  commentMap.forEach((data, id) => {
    comments.push({
      id,
      markedText: data.texts.join('\n\n'),
      comment: data.comment,
      createdAt: data.createdAt,
      from: data.from,
      to: data.to,
    })
  })

  return comments
}

export default Comment
