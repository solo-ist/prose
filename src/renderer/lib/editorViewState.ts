/**
 * The part of the editor's view a tab keeps while it is not active: the
 * selection and the scroll offset (#1103).
 *
 * The selection lives in the tab's own EditorState while a session is open
 * (#1145); this shape is what the saved session and a closed-tab snapshot
 * carry, and what a session is created from on launch.
 */

import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'

export interface EditorViewState {
  selection: { from: number; to: number }
  scrollTop: number
}

/** The scrolling ancestor of the editor, the one the top-reset writes to. */
export function editorScrollContainer(editor: Editor): HTMLElement | null {
  return editor.view.dom.closest('.overflow-auto') as HTMLElement | null
}

export function captureEditorViewState(editor: Editor | null): EditorViewState | undefined {
  if (!editor || editor.isDestroyed) return undefined
  const { from, to } = editor.state.selection
  return {
    selection: { from, to },
    scrollTop: editorScrollContainer(editor)?.scrollTop ?? 0,
  }
}

/** A selection in `doc` at the saved offsets, clamped to the document that is loaded now. */
export function selectionFromViewState(doc: PMNode, state: EditorViewState): Selection {
  const size = doc.content.size
  const from = Math.max(0, Math.min(state.selection.from, size))
  const to = Math.max(from, Math.min(state.selection.to, size))
  try {
    return TextSelection.between(doc.resolve(from), doc.resolve(to))
  } catch (err) {
    console.warn('[editorViewState] selection not restored:', err)
    return Selection.atStart(doc)
  }
}
