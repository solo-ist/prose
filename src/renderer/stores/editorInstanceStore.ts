/**
 * Store for the TipTap editor instance.
 * Allows ChatMessage to access the editor for applying edits.
 */

import { create } from 'zustand'
import type { Editor } from '@tiptap/core'

interface EditorInstanceState {
  editor: Editor | null
  setEditor: (editor: Editor | null) => void
}

export const useEditorInstanceStore = create<EditorInstanceState>((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
}))
