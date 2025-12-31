import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Document } from '../types'
import { generateId, saveDraft, clearDraft } from '../lib/persistence'
import type { DraftState } from '../lib/persistence'

interface EditorState {
  document: Document
  cursorPosition: { line: number; column: number }
  activeChatId: string | null
  isEditing: boolean // True after user creates new doc or opens file
  setDocument: (doc: Partial<Document>) => void
  setContent: (content: string) => void
  setPath: (path: string | null) => void
  setDirty: (isDirty: boolean) => void
  setFrontmatter: (frontmatter: Record<string, unknown>) => void
  setCursorPosition: (line: number, column: number) => void
  setActiveChatId: (id: string | null) => void
  setEditing: (isEditing: boolean) => void
  resetDocument: () => void
  hydrateFromDraft: (draft: DraftState) => void
}

function createInitialDocument(): Document {
  return {
    documentId: generateId(),
    path: null,
    content: '',
    frontmatter: {},
    isDirty: false
  }
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set) => ({
    document: createInitialDocument(),
    cursorPosition: { line: 1, column: 1 },
    activeChatId: null,
    isEditing: false,

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

    setActiveChatId: (id) => set({ activeChatId: id }),

    setEditing: (isEditing) => set({ isEditing }),

    resetDocument: () =>
      set({
        document: createInitialDocument(),
        cursorPosition: { line: 1, column: 1 },
        activeChatId: null,
        isEditing: true // User explicitly created new document
      }),

    hydrateFromDraft: (draft) =>
      set({
        document: draft.document,
        cursorPosition: draft.cursorPosition ?? { line: 1, column: 1 },
        activeChatId: draft.activeChatId,
        isEditing: true // Recovered from draft means user was editing
      })
  }))
)

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T {
  let timeoutId: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T
}

// Subscribe to changes and persist draft (debounced)
const debouncedSaveDraft = debounce(async (state: EditorState) => {
  // Only save if there's content or the document is dirty
  if (state.document.content || state.document.isDirty) {
    await saveDraft({
      document: state.document,
      cursorPosition: state.cursorPosition,
      activeChatId: state.activeChatId,
      savedAt: Date.now()
    })
  } else {
    // Clear draft if document is empty and clean
    await clearDraft()
  }
}, 1000)

useEditorStore.subscribe(
  (state) => ({
    document: state.document,
    cursorPosition: state.cursorPosition,
    activeChatId: state.activeChatId
  }),
  (current) => {
    debouncedSaveDraft(useEditorStore.getState())
  }
)
