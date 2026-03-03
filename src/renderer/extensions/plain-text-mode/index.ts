/**
 * PlainTextMode extension - enforces plain text editing for .txt files.
 *
 * When enabled, strips all formatting marks and converts block nodes
 * (headings, lists, blockquotes, code blocks) to plain paragraphs.
 * This prevents markdown input rules and keyboard shortcuts from
 * applying formatting in plain text files.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'

const plainTextKey = new PluginKey('plainTextMode')

// Block node types that should be converted to paragraphs
const STRUCTURED_BLOCKS = new Set([
  'heading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
])

export const PlainTextMode = Extension.create({
  name: 'plainTextMode',

  addStorage() {
    return {
      enabled: false,
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: plainTextKey,

        appendTransaction(_transactions, _oldState, newState) {
          if (!extension.storage.enabled) return null

          const { tr, schema } = newState
          let modified = false

          // Strip all marks from the document
          newState.doc.descendants((node, pos) => {
            if (node.isText && node.marks.length > 0) {
              tr.removeMark(pos, pos + node.nodeSize)
              modified = true
            }
          })

          // Flatten structured block nodes to paragraphs.
          // Process in reverse document order so position offsets stay valid.
          const replacements: { from: number; to: number; content: Fragment }[] = []
          const paragraphType = schema.nodes.paragraph

          newState.doc.descendants((node, pos) => {
            if (!STRUCTURED_BLOCKS.has(node.type.name)) return

            // For wrapper nodes (lists, blockquote), collect their text
            // content and replace the entire node with paragraph(s).
            // For leaf blocks (heading, codeBlock), convert directly.
            if (node.type.name === 'heading' || node.type.name === 'codeBlock') {
              replacements.push({
                from: pos,
                to: pos + node.nodeSize,
                content: Fragment.from(paragraphType.create(null, node.textContent ? schema.text(node.textContent) : null)),
              })
              return false // don't descend
            }

            // For list/blockquote wrappers, extract all text lines as paragraphs
            if (['bulletList', 'orderedList', 'taskList', 'blockquote'].includes(node.type.name)) {
              const paragraphs: typeof paragraphType[] = []
              node.descendants((child) => {
                if (child.isTextblock && child.textContent) {
                  paragraphs.push(
                    paragraphType.create(null, schema.text(child.textContent)) as any
                  )
                }
              })
              if (paragraphs.length > 0) {
                replacements.push({
                  from: pos,
                  to: pos + node.nodeSize,
                  content: Fragment.from(paragraphs),
                })
              }
              return false // don't descend
            }
          })

          // Apply replacements in reverse order to preserve positions
          for (let i = replacements.length - 1; i >= 0; i--) {
            const { from, to, content } = replacements[i]
            tr.replaceWith(from, to, content)
            modified = true
          }

          return modified ? tr : null
        },
      }),
    ]
  },
})
