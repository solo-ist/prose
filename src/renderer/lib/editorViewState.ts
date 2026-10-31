/**
 * The part of the editor's view a tab keeps while it is not active: the
 * selection and the scroll offset (#1103).
 *
 * Tabs used to cache only the status bar's line/column, which nothing turned
 * back into a selection, and the document-switch reload then reset the view
 * to the top. The leaving tab captures this on the way out; Editor restores it
 * once the returning tab's content is loaded.
 */

import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

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

/**
 * Put the selection back, clamped to the document that is loaded now, and
 * set the scroll offset. Selection-only: the transaction changes no content,
 * so it adds no undo step and fires no `update`.
 */
export function restoreEditorViewState(editor: Editor, state: EditorViewState): void {
  const { doc } = editor.state
  const size = doc.content.size
  const from = Math.max(0, Math.min(state.selection.from, size))
  const to = Math.max(from, Math.min(state.selection.to, size))
  try {
    const selection = TextSelection.between(doc.resolve(from), doc.resolve(to))
    editor.view.dispatch(editor.state.tr.setSelection(selection))
  } catch (err) {
    console.warn('[editorViewState] selection not restored:', err)
  }
  const container = editorScrollContainer(editor)
  if (container) container.scrollTop = state.scrollTop
}
