/**
 * projectsStore — runtime UI state for the Projects & Favorites feature.
 *
 * Persisted data (projects[], favorites[], activeProjectId) lives in
 * settingsStore/settings.json. This store owns ephemeral runtime state:
 * which sidebar panel is visible, loading/error states, etc.
 *
 * Design decision: keep persisted data in settings.json (not IndexedDB) because
 * 1. Each project/favorite carries a MAS security-scoped bookmark that must be
 *    activated at startup — the settings:load handler already does that for
 *    masDirectoryBookmark; extending it to arrays is natural.
 * 2. Projects/Favorites are small (<100 entries), stable data — no need for
 *    the schema-versioning overhead of IndexedDB.
 * 3. Consistent with how defaultSaveDirectory + masDirectoryBookmark work today.
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Favorite, Project } from '../types'
import { getApi } from '../lib/browserApi'
import { useSettingsStore } from './settingsStore'

// Stable empty-array references for the selector hooks below. Returning a fresh
// `[]` from a Zustand selector on every call makes useSyncExternalStore treat the
// snapshot as changed each render → infinite re-render ("Maximum update depth
// exceeded"). These constants keep the reference stable when the field is unset.
const EMPTY_PROJECTS: Project[] = []
const EMPTY_FAVORITES: Favorite[] = []

export type ProjectsPanelTab = 'projects' | 'favorites'

interface ProjectsState {
  /** Which tab is currently active in the sidebar panel */
  activeTab: ProjectsPanelTab
  /** Whether the "add project" flow is in progress */
  isAddingProject: boolean
  /** Whether the "add favorite" flow is in progress */
  isAddingFavorite: boolean
  /** Error message for the most recent operation, if any */
  operationError: string | null

  setActiveTab: (tab: ProjectsPanelTab) => void
  setOperationError: (error: string | null) => void

  /**
   * Open the system folder picker, create a new Project from the result,
   * persist it, and (optionally) switch to it immediately.
   */
  addProjectFromPicker: (switchToProject?: boolean) => Promise<Project | null>

  /**
   * Open the system folder picker, create a new Favorite from the result,
   * and persist it.
   */
  addFavoriteFromPicker: () => Promise<Favorite | null>

  /**
   * Switch the active project. Updates lastOpenedAt and navigates the file
   * explorer to the project root.
   */
  switchToProject: (projectId: string) => Promise<void>
  /**
   * Exit the active project back to the selected root folder (the stable
   * defaultSaveDirectory). Clears the active project. Projects are additive
   * pointers, so the selected root is preserved across project navigation.
   */
  exitToRoot: () => Promise<void>

  /**
   * Navigate the file explorer to a favorite folder.
   * Does NOT change the active project.
   */
  navigateToFavorite: (favoriteId: string) => Promise<void>

  /**
   * Remove a project and optionally clean up MAS resources.
   */
  removeProject: (projectId: string) => void

  /**
   * Remove a favorite.
   */
  removeFavorite: (favoriteId: string) => void
}

// Lazy import to avoid circular dependency — fileListStore imports nothing
// from projectsStore, but we need to call setRootPath on it.
async function getFileListStore() {
  const { useFileListStore } = await import('./fileListStore')
  return useFileListStore.getState()
}

export const useProjectsStore = create<ProjectsState>()(
  subscribeWithSelector((set, get) => ({
    activeTab: 'projects',
    isAddingProject: false,
    isAddingFavorite: false,
    operationError: null,

    setActiveTab: (tab) => set({ activeTab: tab }),

    setOperationError: (error) => set({ operationError: error }),

    addProjectFromPicker: async (switchToProject = true): Promise<Project | null> => {
      set({ isAddingProject: true, operationError: null })
      try {
        const api = getApi()
        const result = await api.selectFolder(
          undefined,
          'Choose a folder to add as a project. Prose needs permission to access this folder.'
        )
        if (!result) {
          set({ isAddingProject: false })
          return null
        }

        const name = result.path.split('/').pop() || result.path
        const now = new Date().toISOString()
        const project: Project = {
          id: self.crypto.randomUUID(),
          name,
          path: result.path,
          bookmark: result.bookmark ?? undefined,
          createdAt: now,
          lastOpenedAt: switchToProject ? now : undefined,
        }

        useSettingsStore.getState().addProject(project)

        if (switchToProject) {
          // Also update the file explorer root
          const fileList = await getFileListStore()
          fileList.setRootPath(project.path)
          useSettingsStore.getState().setActiveProject(project.id)
          useSettingsStore.getState().setDefaultSaveDirectory(project.path)
          // Persist bookmark in the legacy single-bookmark slot too so the
          // existing settings:load bookmark restoration still works.
          if (project.bookmark) {
            useSettingsStore.setState((state) => ({
              settings: { ...state.settings, masDirectoryBookmark: project.bookmark }
            }))
          }
          useSettingsStore.getState().saveSettings()
        }

        set({ isAddingProject: false })
        return project
      } catch (err) {
        console.error('[projectsStore] addProjectFromPicker failed:', err)
        set({ isAddingProject: false, operationError: 'Failed to add project. Please try again.' })
        return null
      }
    },

    addFavoriteFromPicker: async (): Promise<Favorite | null> => {
      set({ isAddingFavorite: true, operationError: null })
      try {
        const api = getApi()
        const result = await api.selectFolder(
          undefined,
          'Choose a folder to add to Favorites. Prose needs permission to access this folder.'
        )
        if (!result) {
          set({ isAddingFavorite: false })
          return null
        }

        const name = result.path.split('/').pop() || result.path
        const favorite: Favorite = {
          id: self.crypto.randomUUID(),
          name,
          path: result.path,
          bookmark: result.bookmark ?? undefined,
          addedAt: new Date().toISOString(),
          isDirectory: true, // the picker is folder-only — be explicit rather than relying on undefined
        }

        useSettingsStore.getState().addFavorite(favorite)
        set({ isAddingFavorite: false })
        return favorite
      } catch (err) {
        console.error('[projectsStore] addFavoriteFromPicker failed:', err)
        set({ isAddingFavorite: false, operationError: 'Failed to add favorite. Please try again.' })
        return null
      }
    },

    switchToProject: async (projectId: string): Promise<void> => {
      set({ operationError: null })
      const { settings } = useSettingsStore.getState()
      const project = (settings.projects ?? []).find((p) => p.id === projectId)
      if (!project) return

      useSettingsStore.getState().setActiveProject(projectId)
      // Note: the selected root (defaultSaveDirectory) is intentionally NOT
      // changed here — it stays stable as the base the Back button returns to.
      // Projects are additive pointers layered over the selected root.

      // Sync the legacy single-bookmark slot so the existing startAccessingSecurityScopedResource
      // call in settings:load still works on the next launch.
      if (project.bookmark) {
        useSettingsStore.setState((state) => ({
          settings: { ...state.settings, masDirectoryBookmark: project.bookmark }
        }))
      }
      useSettingsStore.getState().saveSettings()

      const fileList = await getFileListStore()
      fileList.setRootPath(project.path)
      // Stay in the Projects panel — opening a project browses its files in
      // place; the Files panel remains the separate base-root navigator.
      fileList.setViewMode('projects')
    },

    exitToRoot: async (): Promise<void> => {
      set({ operationError: null })
      const baseRoot = useSettingsStore.getState().settings.defaultSaveDirectory
      useSettingsStore.getState().setActiveProject(null)
      useSettingsStore.getState().saveSettings()

      const fileList = await getFileListStore()
      if (baseRoot) {
        fileList.setRootPath(baseRoot)
      }
      // Drop to the base-root Files navigator (contrast: FileListPanel.backToProjectsList
      // clears the active project but stays in the 'projects' panel).
      fileList.setViewMode('folder')
    },

    navigateToFavorite: async (favoriteId: string): Promise<void> => {
      set({ operationError: null })
      const { settings } = useSettingsStore.getState()
      const favorite = (settings.favorites ?? []).find((f) => f.id === favoriteId)
      if (!favorite) return

      const fileList = await getFileListStore()
      fileList.setRootPath(favorite.path)
      fileList.setViewMode('folder')
    },

    removeProject: (projectId: string): void => {
      const wasActive = useSettingsStore.getState().settings.activeProjectId === projectId
      useSettingsStore.getState().removeProject(projectId)
      // If the removed project was the active one, the explorer would otherwise keep
      // showing its folder with no project header. Navigate back to the base root
      // (defaultSaveDirectory) so the view matches the now-removed state.
      if (wasActive) {
        const baseRoot = useSettingsStore.getState().settings.defaultSaveDirectory
        void getFileListStore().then((fileList) => {
          if (baseRoot) fileList.setRootPath(baseRoot)
          fileList.setViewMode('folder')
        })
      }
    },

    removeFavorite: (favoriteId: string): void => {
      useSettingsStore.getState().removeFavorite(favoriteId)
    },
  }))
)

// Convenience selector hooks
export function useProjects(): Project[] {
  return useSettingsStore((s) => s.settings.projects ?? EMPTY_PROJECTS)
}

export function useFavorites(): Favorite[] {
  return useSettingsStore((s) => s.settings.favorites ?? EMPTY_FAVORITES)
}

export function useActiveProject(): Project | null {
  const projects = useSettingsStore((s) => s.settings.projects ?? EMPTY_PROJECTS)
  const activeId = useSettingsStore((s) => s.settings.activeProjectId)
  if (!activeId) return null
  return projects.find((p) => p.id === activeId) ?? null
}
