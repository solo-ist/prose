import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Document } from '../types'
import { generateId, saveDraft, clearDraft } from '../lib/persistence'
import type { FileListState } from '../lib/persistence'
import { useFileListStore } from './fileListStore'
import { isRemarkableOcrPath, remarkableNotebookIdFromPath } from '../lib/remarkablePath'

// reMarkable read-only state is DERIVED from the document path: a hidden
// `.remarkable/<id>/<name>.md` OCR path is read-only, everything else editable.
// Deriving it here — wherever the document is set — keeps it correct on every load
// path (tab switch, file open, AND session restore on launch), and guarantees the
// hidden OCR source file can never be opened as editable (a stray save there would
// clobber sync-managed output).
function remarkableStateForPath(path: string | null): {
  isRemarkableReadOnly: boolean
  remarkableNotebookId: string | null
} {
  return {
    isRemarkableReadOnly: isRemarkableOcrPath(path),
    remarkableNotebookId: remarkableNotebookIdFromPath(path)
  }
}

interface SelectionCache {
  text: string
  from: number
  to: number
}

interface EditorState {
  /**
   * A mirror of the active tab's record (#1151): identity from activation and
   * `setTabIdentity`, content / frontmatter / dirty from the session layer's
   * projection. Nothing computes on it; the tab record is the truth.
   */
  document: Document
  cursorPosition: { line: number; column: number }
  activeChatId: string | null
  isEditing: boolean // True after user creates new doc or opens file
  // reMarkable read-only mode state
  isRemarkableReadOnly: boolean // True when viewing OCR output before transforming to editable
  remarkableNotebookId: string | null // Notebook ID for creating editable version
  // Selection cache for read_selection when editor loses focus
  lastSelection: SelectionCache | null
  // Autosave in-progress flag (true only during the actual save call)
  isAutosaving: boolean
  // AI annotation visibility toggle
  annotationsVisible: boolean
  // Pending frontmatter suggestion from AI — shown as an overlay in FrontmatterEditor.
  // null means no pending suggestion; a Record means an AI-proposed frontmatter diff awaiting accept/reject.
  pendingFrontmatter: Record<string, unknown> | null
  setDocument: (doc: Partial<Document>) => void
  setCursorPosition: (line: number, column: number) => void
  setActiveChatId: (id: string | null) => void
  setEditing: (isEditing: boolean) => void
  // Selection cache methods
  setLastSelection: (sel: SelectionCache | null) => void
  getLastSelection: () => SelectionCache | null
  setAutosaving: (isAutosaving: boolean) => void
  toggleAnnotationsVisible: () => void
  // Pending frontmatter suggestion methods
  setPendingFrontmatter: (frontmatter: Record<string, unknown> | null) => void
  rejectPendingFrontmatter: () => void
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
    lastSelection: null,
    isAutosaving: false,
    annotationsVisible: true,
    pendingFrontmatter: null,

    setDocument: (doc) =>
      set((state) => {
        const documentIdChanged =
          doc.documentId !== undefined && doc.documentId !== state.document.documentId
        const newDocument = { ...state.document, ...doc }
        return {
          document: newDocument,
          // A document change clears the per-document extras: the pending
          // frontmatter overlay (so a Tab A suggestion can't get accepted into
          // Tab B) and the cached selection (so read_selection on B never
          // answers with A's text, #1152).
          ...(documentIdChanged ? { pendingFrontmatter: null, lastSelection: null } : {}),
          // Read-only follows the resulting path (see remarkableStateForPath).
          ...remarkableStateForPath(newDocument.path)
        }
      }),

    setCursorPosition: (line, column) =>
      set({ cursorPosition: { line, column } }),

    setActiveChatId: (id) => set({ activeChatId: id }),

    setEditing: (isEditing) => set({ isEditing }),

    // Selection cache methods
    setLastSelection: (sel) => set({ lastSelection: sel }),

    getLastSelection: () => get().lastSelection,

    setAutosaving: (isAutosaving) => set({ isAutosaving }),

    toggleAnnotationsVisible: () =>
      set((state) => ({ annotationsVisible: !state.annotationsVisible })),

    // Pending frontmatter suggestion methods
    setPendingFrontmatter: (frontmatter) => set({ pendingFrontmatter: frontmatter }),

    rejectPendingFrontmatter: () => set({ pendingFrontmatter: null })
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
