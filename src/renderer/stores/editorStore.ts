import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Document } from '../types'
import { generateId, saveDraft, clearDraft } from '../lib/persistence'
import type { DraftState, FileListState } from '../lib/persistence'
import { useFileListStore } from './fileListStore'

interface ReadCache {
  content: string | null
  documentId: string | null
}

interface SelectionCache {
  text: string
  from: number
  to: number
}

interface EditorState {
  document: Document
  cursorPosition: { line: number; column: number }
  activeChatId: string | null
  isEditing: boolean // True after user creates new doc or opens file
  // reMarkable read-only mode state
  isRemarkableReadOnly: boolean // True when viewing OCR output before transforming to editable
  remarkableNotebookId: string | null // Notebook ID for creating editable version
  // Read cache for avoiding redundant read_document calls
  readCache: ReadCache
  // Selection cache for read_selection when editor loses focus
  lastSelection: SelectionCache | null
  // Autosave in-progress flag (true only during the actual save call)
  isAutosaving: boolean
  // Preview tab mode: single-click file opens as non-editable preview; clicking editor promotes to edit
  isPreviewTab: boolean
  // AI annotation visibility toggle
  annotationsVisible: boolean
  setDocument: (doc: Partial<Document>) => void
  setContent: (content: string) => void
  setPath: (path: string | null) => void
  setDirty: (isDirty: boolean) => void
  setFrontmatter: (frontmatter: Record<string, unknown>) => void
  setCursorPosition: (line: number, column: number) => void
  setActiveChatId: (id: string | null) => void
  setEditing: (isEditing: boolean) => void
  setRemarkableReadOnly: (isReadOnly: boolean, notebookId?: string | null) => void
  resetDocument: () => void
  hydrateFromDraft: (draft: DraftState) => void
  // Read cache methods
  getCachedRead: () => string | null
  updateReadCache: (content: string) => void
  invalidateReadCache: () => void
  // Selection cache methods
  setLastSelection: (sel: SelectionCache | null) => void
  getLastSelection: () => SelectionCache | null
  setAutosaving: (isAutosaving: boolean) => void
  setPreviewTab: (val: boolean) => void
  toggleAnnotationsVisible: () => void
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
  subscribeWithSelector((set, get) => ({
    document: createInitialDocument(),
    cursorPosition: { line: 1, column: 1 },
    activeChatId: null,
    isEditing: false,
    isRemarkableReadOnly: false,
    remarkableNotebookId: null,
    readCache: { content: null, documentId: null },
    lastSelection: null,
    isAutosaving: false,
    isPreviewTab: false,
    annotationsVisible: true,

    setDocument: (doc) =>
      set((state) => ({
        document: { ...state.document, ...doc },
        // Invalidate cache when document changes
        readCache: { content: null, documentId: null }
      })),

    setContent: (content) =>
      set((state) => {
        const contentChanged = state.document.content !== content
        // Only mark dirty if content actually changed
        // Preserve existing dirty state if content is the same
        const newDirty = contentChanged ? true : state.document.isDirty
        return {
          document: { ...state.document, content, isDirty: newDirty },
          // Only invalidate cache when content actually changes
          readCache: contentChanged
            ? { content: null, documentId: null }
            : state.readCache
        }
      }),

    setPath: (path) =>
      set((state) => ({
        document: { ...state.document, path }
      })),

    setDirty: (isDirty) =>
      set((state) => ({
        document: { ...state.document, isDirty },
        // Invalidate cache when dirty flag is set to true
        readCache: isDirty ? { content: null, documentId: null } : state.readCache
      })),

    setFrontmatter: (frontmatter) =>
      set((state) => ({
        document: { ...state.document, frontmatter }
      })),

    setCursorPosition: (line, column) =>
      set({ cursorPosition: { line, column } }),

    setActiveChatId: (id) => set({ activeChatId: id }),

    setEditing: (isEditing) => set({ isEditing }),

    setRemarkableReadOnly: (isReadOnly, notebookId = null) =>
      set({
        isRemarkableReadOnly: isReadOnly,
        remarkableNotebookId: notebookId
      }),

    resetDocument: () =>
      set({
        document: createInitialDocument(),
        cursorPosition: { line: 1, column: 1 },
        activeChatId: null,
        isEditing: true, // User explicitly created new document
        isRemarkableReadOnly: false,
        remarkableNotebookId: null,
        readCache: { content: null, documentId: null },
        lastSelection: null
      }),

    hydrateFromDraft: (draft) =>
      set({
        document: draft.document,
        cursorPosition: draft.cursorPosition ?? { line: 1, column: 1 },
        activeChatId: draft.activeChatId,
        isEditing: true, // Recovered from draft means user was editing
        readCache: { content: null, documentId: null },
        lastSelection: null
      }),

    // Read cache methods
    getCachedRead: () => {
      const state = get()
      const { readCache, document } = state
      // Return cached content only if:
      // 1. Cache exists
      // 2. Document ID matches
      // 3. Document is not dirty
      if (
        readCache.content !== null &&
        readCache.documentId === document.documentId &&
        !document.isDirty
      ) {
        return readCache.content
      }
      return null
    },

    updateReadCache: (content: string) => {
      const { document } = get()
      set({
        readCache: {
          content,
          documentId: document.documentId
        }
      })
    },

    invalidateReadCache: () =>
      set({ readCache: { content: null, documentId: null } }),

    // Selection cache methods
    setLastSelection: (sel) => set({ lastSelection: sel }),

    getLastSelection: () => get().lastSelection,

    setAutosaving: (isAutosaving) => set({ isAutosaving }),
    setPreviewTab: (val) => set({ isPreviewTab: val }),

    toggleAnnotationsVisible: () =>
      set((state) => ({ annotationsVisible: !state.annotationsVisible }))
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

// Helper to get serializable file list state
function getFileListState(): FileListState {
  const { viewMode, rootPath, expandedFolders, selectedPath } = useFileListStore.getState()
  return {
    viewMode,
    rootPath,
    expandedFolders: Array.from(expandedFolders), // Convert Set to Array for serialization
    selectedPath
  }
}

// Subscribe to changes and persist draft (debounced)
const debouncedSaveDraft = debounce(async (state: EditorState) => {
  // Only save if there's content or the document is dirty
  if (state.document.content || state.document.isDirty) {
    await saveDraft({
      document: state.document,
      cursorPosition: state.cursorPosition,
      activeChatId: state.activeChatId,
      savedAt: Date.now(),
      fileList: getFileListState()
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

// Also subscribe to file list state changes to persist selectedPath
useFileListStore.subscribe(
  (state) => ({
    viewMode: state.viewMode,
    rootPath: state.rootPath,
    expandedFolders: state.expandedFolders,
    selectedPath: state.selectedPath
  }),
  () => {
    // Only save if there's editor content (otherwise draft saving is disabled)
    const editorState = useEditorStore.getState()
    if (editorState.document.content || editorState.document.isDirty) {
      debouncedSaveDraft(editorState)
    }
  }
)
