import { create } from 'zustand'
import type { Document } from '../types'

interface EditorState {
  document: Document
  cursorPosition: { line: number; column: number }
  setDocument: (doc: Partial<Document>) => void
  setContent: (content: string) => void
  setPath: (path: string | null) => void
  setDirty: (isDirty: boolean) => void
  setFrontmatter: (frontmatter: Record<string, unknown>) => void
  setCursorPosition: (line: number, column: number) => void
  resetDocument: () => void
}

const initialDocument: Document = {
  path: null,
  content: '',
  frontmatter: {},
  isDirty: false
}

export const useEditorStore = create<EditorState>((set) => ({
  document: initialDocument,
  cursorPosition: { line: 1, column: 1 },

  setDocument: (doc) =>
    set((state) => ({
      document: { ...state.document, ...doc }
    })),

  setContent: (content) =>
    set((state) => ({
      document: { ...state.document, content, isDirty: true }
    })),

  setPath: (path) =>
    set((state) => ({
      document: { ...state.document, path }
    })),

  setDirty: (isDirty) =>
    set((state) => ({
      document: { ...state.document, isDirty }
    })),

  setFrontmatter: (frontmatter) =>
    set((state) => ({
      document: { ...state.document, frontmatter }
    })),

  setCursorPosition: (line, column) =>
    set({ cursorPosition: { line, column } }),

  resetDocument: () =>
    set({ document: initialDocument, cursorPosition: { line: 1, column: 1 } })
}))
