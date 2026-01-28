import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { FileItem, RemarkableSyncMetadata, RemarkableCloudNotebook, RemarkableSyncState, GoogleSyncMetadata } from '../types'

type ViewMode = 'recent' | 'folder' | 'notebooks' | 'googledocs'

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
  loadingFolders: Set<string> // Track which folders are currently loading children

  // Google Docs sync state
  isGoogleSyncing: boolean

  // Notebook metadata
  notebookMetadata: RemarkableSyncMetadata | null
  cloudNotebooks: RemarkableCloudNotebook[]
  syncState: RemarkableSyncState | null

  // Google Docs metadata
  googleDocsMetadata: GoogleSyncMetadata | null

  // Actions
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  setViewMode: (mode: ViewMode) => void
  setGoogleSyncing: (syncing: boolean) => void
  setRootPath: (path: string | null) => void
  initializeDefaultPath: () => Promise<void>
  navigateToParent: () => void
  loadFiles: () => Promise<void>
  loadFolderChildren: (folderPath: string) => Promise<void>
  loadNotebooks: (syncDirectory: string) => Promise<void>
  loadCloudNotebooks: (deviceToken: string, syncDirectory: string) => Promise<void>
  toggleNotebookSync: (notebookId: string, syncDirectory: string) => Promise<void>
  loadGoogleDocsMetadata: () => Promise<void>
  selectFile: (path: string | null) => void
  toggleFolder: (path: string) => void
  setExpanded: (path: string, expanded: boolean) => void
  revealAndSelectPath: (path: string) => void
}

export const useFileListStore = create<FileListState>()(
  subscribeWithSelector((set, get) => ({
    isPanelOpen: false,
    isLoading: false,
    viewMode: 'folder' as ViewMode,
    isInitialized: false,
    files: [],
    rootPath: null,
    expandedFolders: new Set<string>(),
    selectedPath: null,
    loadingFolders: new Set<string>(),
    isGoogleSyncing: false,
    googleDocsMetadata: null,
    notebookMetadata: null,
    cloudNotebooks: [],
    syncState: null,

    setGoogleSyncing: (syncing) => set({ isGoogleSyncing: syncing }),

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
        // Use depth 1 for fast initial load - children loaded on demand
        const files = await window.api.listDirectory(rootPath, 1)
        set({ files, isLoading: false })
      } catch (error) {
        console.error('Failed to load files:', error)
        set({ files: [], isLoading: false })
      }
    },

    loadFolderChildren: async (folderPath: string) => {
      if (!window.api) return

      const { loadingFolders } = get()
      if (loadingFolders.has(folderPath)) return // Already loading

      // Mark as loading
      const newLoading = new Set(loadingFolders)
      newLoading.add(folderPath)
      set({ loadingFolders: newLoading })

      try {
        // Load just this folder's children (depth 1)
        const children = await window.api.listDirectory(folderPath, 1)

        // Update the tree by finding and updating the folder
        const { files } = get()
        const updateFolder = (items: FileItem[]): FileItem[] => {
          return items.map(item => {
            if (item.path === folderPath) {
              return { ...item, children, hasChildren: children.length > 0 }
            }
            if (item.children) {
              return { ...item, children: updateFolder(item.children) }
            }
            return item
          })
        }

        set({ files: updateFolder(files) })
      } catch (error) {
        console.error('Failed to load folder children:', error)
      } finally {
        // Remove from loading set
        const { loadingFolders: currentLoading } = get()
        const updatedLoading = new Set(currentLoading)
        updatedLoading.delete(folderPath)
        set({ loadingFolders: updatedLoading })
      }
    },

    loadGoogleDocsMetadata: async () => {
      if (!window.api?.googleGetSyncMetadata) return

      set({ isLoading: true })
      try {
        const metadata = await window.api.googleGetSyncMetadata()
        set({ googleDocsMetadata: metadata, isLoading: false })
      } catch (error) {
        console.error('Failed to load Google Docs metadata:', error)
        set({ googleDocsMetadata: null, isLoading: false })
      }
    },

    loadNotebooks: async (syncDirectory: string) => {
      if (!window.api) return

      set({ isLoading: true })
      try {
        // Load both metadata and sync state
        const [metadata, syncState] = await Promise.all([
          window.api.remarkableGetMetadata(syncDirectory),
          window.api.remarkableGetSyncState(syncDirectory)
        ])
        set({ notebookMetadata: metadata, syncState, isLoading: false })
      } catch (error) {
        console.error('Failed to load notebook metadata:', error)
        set({ notebookMetadata: null, syncState: null, isLoading: false })
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
      const { expandedFolders, files, loadFolderChildren } = get()
      const newExpanded = new Set(expandedFolders)
      const isExpanding = !newExpanded.has(path)

      if (isExpanding) {
        newExpanded.add(path)

        // Check if this folder needs children loaded
        const findFolder = (items: FileItem[]): FileItem | null => {
          for (const item of items) {
            if (item.path === path) return item
            if (item.children) {
              const found = findFolder(item.children)
              if (found) return found
            }
          }
          return null
        }

        const folder = findFolder(files)
        if (folder && folder.hasChildren && !folder.children) {
          // Load children on demand
          loadFolderChildren(path)
        }
      } else {
        newExpanded.delete(path)
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
      const { rootPath, expandedFolders, files } = get()
      if (!rootPath) return

      // Helper to get relative suffix (strip ~ or /Users/xxx prefix)
      const getRelativeSuffix = (p: string) => {
        if (p.startsWith('~/')) return p.slice(2)
        const match = p.match(/^\/Users\/[^/]+\/(.*)$/)
        return match ? match[1] : p
      }

      const pathSuffix = getRelativeSuffix(path)
      const rootSuffix = getRelativeSuffix(rootPath)

      // Check if path is within rootPath
      if (!pathSuffix.startsWith(rootSuffix)) return

      // Find the actual file path in the tree (which uses expanded paths)
      const findActualPath = (items: typeof files, targetSuffix: string): string | null => {
        for (const item of items) {
          const itemSuffix = getRelativeSuffix(item.path)
          if (itemSuffix === targetSuffix) return item.path
          if (item.children) {
            const found = findActualPath(item.children, targetSuffix)
            if (found) return found
          }
        }
        return null
      }

      const actualPath = findActualPath(files, pathSuffix)
      const targetPath = actualPath || path

      // Get relative path from root
      const relativePath = pathSuffix.slice(rootSuffix.length + 1)
      if (!relativePath) return

      const parts = relativePath.split('/')
      const newExpanded = new Set(expandedFolders)

      // Expand all parent folders - use the file tree's path format
      let currentSuffix = rootSuffix
      for (let i = 0; i < parts.length - 1; i++) {
        currentSuffix = `${currentSuffix}/${parts[i]}`
        // Find the actual folder path in the tree
        const folderPath = findActualPath(files, currentSuffix)
        if (folderPath) {
          newExpanded.add(folderPath)
        }
      }

      set({ expandedFolders: newExpanded, selectedPath: targetPath })
    }
  }))
)
