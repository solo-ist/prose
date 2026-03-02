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

const plainTextKey = new PluginKey('plainTextMode')

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

          // Convert non-paragraph block nodes to paragraphs
          const paragraphType = schema.nodes.paragraph
          newState.doc.descendants((node, pos) => {
            if (
              node.isBlock &&
              node.type !== schema.nodes.doc &&
              node.type !== paragraphType &&
              node.type !== schema.nodes.text
            ) {
              // For list items, task items, blockquotes — unwrap to paragraph
              // For headings, code blocks — convert to paragraph
              if (node.type.name === 'heading' || node.type.name === 'codeBlock') {
                tr.setBlockType(pos, pos + node.nodeSize, paragraphType)
                modified = true
              }
            }
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})
