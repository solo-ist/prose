import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { FileItem } from '../types'

interface FileListState {
  // Panel state
  isPanelOpen: boolean
  isLoading: boolean

  // File tree state
  files: FileItem[]
  rootPath: string | null
  expandedFolders: Set<string>
  selectedPath: string | null

  // Actions
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  setRootPath: (path: string | null) => void
  loadFiles: () => Promise<void>
  selectFile: (path: string | null) => void
  toggleFolder: (path: string) => void
  setExpanded: (path: string, expanded: boolean) => void
}

export const useFileListStore = create<FileListState>()(
  subscribeWithSelector((set, get) => ({
    isPanelOpen: false,
    isLoading: false,
    files: [],
    rootPath: null,
    expandedFolders: new Set<string>(),
    selectedPath: null,

    togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

    setPanelOpen: (open) => set({ isPanelOpen: open }),

    setRootPath: (path) => {
      set({ rootPath: path, files: [], expandedFolders: new Set() })
      if (path) {
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
    }
  }))
)
