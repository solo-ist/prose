import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const focusModePluginKey = new PluginKey('focusMode')

export const FocusMode = Extension.create({
  name: 'focusMode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: focusModePluginKey,
        props: {
          decorations: (state) => {
            const { doc, selection } = state
            const decorations: Decoration[] = []

            // Find the paragraph containing the cursor
            const $pos = selection.$head
            let activeNodePos: number | null = null

            // Walk up to find the nearest block node (paragraph, heading, etc.)
            for (let depth = $pos.depth; depth >= 0; depth--) {
              const node = $pos.node(depth)
              if (node.isBlock && (node.type.name === 'paragraph' || node.type.name === 'heading' || node.type.name === 'blockquote' || node.type.name === 'listItem')) {
                activeNodePos = $pos.before(depth)
                break
              }
            }

            // Add decorations to all block nodes
            doc.descendants((node, pos) => {
              if (node.isBlock && (node.type.name === 'paragraph' || node.type.name === 'heading' || node.type.name === 'blockquote' || node.type.name === 'listItem')) {
                const isActive = pos === activeNodePos
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: isActive ? 'focus-active' : 'focus-dimmed'
                  })
                )
              }
            })

            return DecorationSet.create(doc, decorations)
          }
        }
      })
    ]
  }
})
