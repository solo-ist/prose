import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

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
 *
 * Clearing waits for a pointer press to end (#1264). The decoration is an
 * extra span around the text, so removing it between `mousedown` and
 * `mouseup` takes the press's target out of the DOM and the browser never
 * dispatches its `click`: the first click on a suggestion or comment under
 * the highlight would open nothing. A focus that arrives during a press keeps
 * the decoration until the press ends, then clears it on the next task, after
 * the `click` has gone out. Any other focus (keyboard, `commands.focus()`)
 * clears at once.
 */

interface PersistentSelectionState {
  isBlurred: boolean
  from: number | null
  to: number | null
}

const persistentSelectionKey = new PluginKey<PersistentSelectionState>('persistentSelection')

const CLEARED: PersistentSelectionState = { isBlurred: false, from: null, to: null }

/** Clear the decoration on whatever state the view shows (the meta only resets the blur flag). */
function clearDecoration(view: EditorView): void {
  if (view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(persistentSelectionKey, CLEARED))
}

export const PersistentSelection = Extension.create({
  name: 'persistentSelection',

  addProseMirrorPlugins() {
    // A pointer press on the editor is in progress (mousedown seen, not yet released).
    let pressing = false
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
            mousedown() {
              pressing = true
              const release = () => {
                pressing = false
                window.removeEventListener('pointerup', release, true)
                window.removeEventListener('pointercancel', release, true)
              }
              window.addEventListener('pointerup', release, true)
              window.addEventListener('pointercancel', release, true)
              return false
            },
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
              if (!pressing) {
                clearDecoration(view)
                return false
              }
              // Focus from a press: keep the span until the press ends, then
              // clear after its click has been dispatched (#1264).
              const settle = () => {
                window.removeEventListener('pointerup', settle, true)
                window.removeEventListener('pointercancel', settle, true)
                setTimeout(() => clearDecoration(view), 0)
              }
              window.addEventListener('pointerup', settle, true)
              window.addEventListener('pointercancel', settle, true)
              return false
            }
          }
        }
      })
    ]
  }
})
