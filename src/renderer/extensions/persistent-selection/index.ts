import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Persistent visual selection across focus changes.
 *
 * Native browser `::selection` highlighting is suppressed the moment the
 * editor loses focus (e.g., user clicks into the chat input). That makes
 * tools like `read_selection` opaque — you can't see what's about to be
 * read. This extension paints an inline ProseMirror decoration over the
 * selection range while the editor is blurred, so the highlight persists
 * visually. When the editor regains focus, the decoration clears and
 * native `::selection` takes over.
 *
 * The decoration class `.persistent-selection` is styled in
 * `src/renderer/index.css` to match the global `::selection` background.
 */

interface PersistentSelectionState {
  isBlurred: boolean
  from: number | null
  to: number | null
}

const persistentSelectionKey = new PluginKey<PersistentSelectionState>('persistentSelection')

export const PersistentSelection = Extension.create({
  name: 'persistentSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin<PersistentSelectionState>({
        key: persistentSelectionKey,
        state: {
          init(): PersistentSelectionState {
            return { isBlurred: false, from: null, to: null }
          },
          apply(tr, prev): PersistentSelectionState {
            const meta = tr.getMeta(persistentSelectionKey) as PersistentSelectionState | undefined
            if (meta) {
              return meta
            }
            // Map stored range across doc edits so the decoration stays
            // attached to the right span even if the doc is mutated while
            // the editor is blurred (e.g., agent applies an edit).
            if (prev.from !== null && prev.to !== null && tr.docChanged) {
              return {
                isBlurred: prev.isBlurred,
                from: tr.mapping.map(prev.from),
                to: tr.mapping.map(prev.to)
              }
            }
            return prev
          }
        },
        props: {
          decorations(state) {
            const pluginState = persistentSelectionKey.getState(state)
            if (
              !pluginState ||
              !pluginState.isBlurred ||
              pluginState.from === null ||
              pluginState.to === null ||
              pluginState.from === pluginState.to
            ) {
              return DecorationSet.empty
            }
            return DecorationSet.create(state.doc, [
              Decoration.inline(pluginState.from, pluginState.to, {
                class: 'persistent-selection'
              })
            ])
          },
          handleDOMEvents: {
            blur(view) {
              const { from, to } = view.state.selection
              view.dispatch(
                view.state.tr.setMeta(persistentSelectionKey, {
                  isBlurred: true,
                  from: from === to ? null : from,
                  to: from === to ? null : to
                } satisfies PersistentSelectionState)
              )
              return false
            },
            focus(view) {
              view.dispatch(
                view.state.tr.setMeta(persistentSelectionKey, {
                  isBlurred: false,
                  from: null,
                  to: null
                } satisfies PersistentSelectionState)
              )
              return false
            }
          }
        }
      })
    ]
  }
})
