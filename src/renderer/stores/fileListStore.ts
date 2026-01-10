import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { FileItem, RemarkableSyncMetadata, RemarkableCloudNotebook, RemarkableSyncState } from '../types'

type ViewMode = 'recent' | 'folder' | 'notebooks'

interface FileListState {
  // Panel state
  isPanelOpen: boolean
  isLoading: boolean
  viewMode: ViewMode
  isInitialized: boolean

  // File tree state
  files: FileItem[]
  rootPath: string | null
  expandedFolders: Set<string>
  selectedPath: string | null

  // Notebook metadata
  notebookMetadata: RemarkableSyncMetadata | null
  cloudNotebooks: RemarkableCloudNotebook[]
  syncState: RemarkableSyncState | null

  // Actions
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  setViewMode: (mode: ViewMode) => void
  setRootPath: (path: string | null) => void
  initializeDefaultPath: () => Promise<void>
  navigateToParent: () => void
  loadFiles: () => Promise<void>
  loadNotebooks: (syncDirectory: string) => Promise<void>
  loadCloudNotebooks: (deviceToken: string, syncDirectory: string) => Promise<void>
  toggleNotebookSync: (notebookId: string, syncDirectory: string) => Promise<void>
  selectFile: (path: string | null) => void
  toggleFolder: (path: string) => void
  setExpanded: (path: string, expanded: boolean) => void
  revealAndSelectPath: (path: string) => void
}

export const useFileListStore = create<FileListState>()(
  subscribeWithSelector((set, get) => ({
    isPanelOpen: false,
    isLoading: false,
    viewMode: 'notebooks' as ViewMode,
    isInitialized: false,
    files: [],
    rootPath: null,
    expandedFolders: new Set<string>(),
    selectedPath: null,
    notebookMetadata: null,
    cloudNotebooks: [],
    syncState: null,

    togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

    setPanelOpen: (open) => set({ isPanelOpen: open }),

    setViewMode: (mode) => set({ viewMode: mode }),

    setRootPath: (path) => {
      set({ rootPath: path, files: [], expandedFolders: new Set() })
      if (path) {
        get().loadFiles()
      }
    },

    initializeDefaultPath: async () => {
      const { isInitialized, rootPath } = get()
      if (isInitialized || rootPath) return

      if (window.api) {
        try {
          const documentsPath = await window.api.getDocumentsPath()
          set({ rootPath: documentsPath, isInitialized: true })
          get().loadFiles()
        } catch (error) {
          console.error('Failed to get documents path:', error)
          set({ isInitialized: true })
        }
      } else {
        set({ isInitialized: true })
      }
    },

    navigateToParent: () => {
      const { rootPath } = get()
      if (!rootPath) return

      // Get parent directory
      const parentPath = rootPath.split('/').slice(0, -1).join('/')
      if (parentPath) {
        set({ rootPath: parentPath, files: [], expandedFolders: new Set() })
        get().loadFiles()
      }
    },

    loadFiles: async () => {
      const { rootPath } = get()
      if (!rootPath || !window.api) return

      set({ isLoading: true })
      try {
        const files = await window.api.listDirectory(rootPath)
        set({ files, isLoading: false })
      } catch (error) {
        console.error('Failed to load files:', error)
        set({ files: [], isLoading: false })
      }
    },

    loadNotebooks: async (syncDirectory: string) => {
      if (!window.api) return

      set({ isLoading: true })
      try {
        const metadata = await window.api.remarkableGetMetadata(syncDirectory)
        set({ notebookMetadata: metadata, isLoading: false })
      } catch (error) {
        console.error('Failed to load notebook metadata:', error)
        set({ notebookMetadata: null, isLoading: false })
      }
    },

    loadCloudNotebooks: async (deviceToken: string, syncDirectory: string) => {
      if (!window.api) return

      set({ isLoading: true })
      try {
        const [cloudNotebooks, syncState] = await Promise.all([
          window.api.remarkableListCloudNotebooks(deviceToken),
          window.api.remarkableGetSyncState(syncDirectory)
        ])
        set({ cloudNotebooks, syncState, isLoading: false })
      } catch (error) {
        console.error('Failed to load cloud notebooks:', error)
        set({ cloudNotebooks: [], syncState: null, isLoading: false })
      }
    },

    toggleNotebookSync: async (notebookId: string, syncDirectory: string) => {
      if (!window.api) return

      const { syncState } = get()
      const currentSelected = syncState?.selectedNotebooks || []
      const isCurrentlySelected = currentSelected.includes(notebookId)

      const newSelected = isCurrentlySelected
        ? currentSelected.filter(id => id !== notebookId)
        : [...currentSelected, notebookId]

      try {
        await window.api.remarkableUpdateSyncSelection(syncDirectory, newSelected)
        set({
          syncState: {
            selectedNotebooks: newSelected,
            lastUpdated: new Date().toISOString()
          }
        })
      } catch (error) {
        console.error('Failed to toggle notebook sync:', error)
      }
    },

    selectFile: (path) => set({ selectedPath: path }),

    toggleFolder: (path) => {
      const { expandedFolders } = get()
      const newExpanded = new Set(expandedFolders)
      if (newExpanded.has(path)) {
        newExpanded.delete(path)
      } else {
        newExpanded.add(path)
      }
      set({ expandedFolders: newExpanded })
    },

    setExpanded: (path, expanded) => {
      const { expandedFolders } = get()
      const newExpanded = new Set(expandedFolders)
      if (expanded) {
        newExpanded.add(path)
      } else {
        newExpanded.delete(path)
      }
      set({ expandedFolders: newExpanded })
    },

    revealAndSelectPath: (path: string) => {
      const { rootPath, expandedFolders } = get()
      if (!rootPath || !path.startsWith(rootPath)) return

      // Get all parent directories between rootPath and the file
      const relativePath = path.slice(rootPath.length + 1)
      const parts = relativePath.split('/')
      const newExpanded = new Set(expandedFolders)

      // Expand all parent folders
      let currentPath = rootPath
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = `${currentPath}/${parts[i]}`
        newExpanded.add(currentPath)
      }

      set({ expandedFolders: newExpanded, selectedPath: path })
    }
  }))
)
