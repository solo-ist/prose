import { create } from 'zustand'
import type { Settings, RecentFile } from '../types'

const MAX_RECENT_FILES = 10

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  isDialogOpen: boolean
  isShortcutsDialogOpen: boolean
  setSettings: (settings: Partial<Settings>) => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  setDialogOpen: (open: boolean) => void
  setShortcutsDialogOpen: (open: boolean) => void
  setTheme: (theme: Settings['theme']) => void
  setLLMConfig: (config: Partial<Settings['llm']>) => void
  setEditorConfig: (config: Partial<Settings['editor']>) => void
  setRecoveryConfig: (config: Partial<NonNullable<Settings['recovery']>>) => void
  addRecentFile: (path: string) => void
  clearRecentFiles: () => void
  getRecentFiles: () => RecentFile[]
}

const defaultSettings: Settings = {
  theme: 'dark',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: ''
  },
  editor: {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: "'Source Code Pro', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
  },
  recovery: {
    mode: 'silent'
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  isLoaded: false,
  isDialogOpen: false,
  isShortcutsDialogOpen: false,

  setSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings }
    })),

  loadSettings: async () => {
    try {
      // Guard for when running in browser without Electron
      if (!window.api) {
        console.warn('window.api not available - using default settings')
        set({ isLoaded: true })
        return
      }
      const settings = await window.api.loadSettings()
      set({ settings: { ...defaultSettings, ...settings }, isLoaded: true })

      // Apply theme on load
      const theme = settings.theme || 'dark'
      if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
      set({ isLoaded: true })
    }
  },

  saveSettings: async () => {
    try {
      if (!window.api) return
      await window.api.saveSettings(get().settings)
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  },

  setDialogOpen: (open) => set({ isDialogOpen: open }),

  setShortcutsDialogOpen: (open) => set({ isShortcutsDialogOpen: open }),

  setTheme: (theme) => {
    set((state) => ({
      settings: { ...state.settings, theme }
    }))

    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },

  setLLMConfig: (config) =>
    set((state) => ({
      settings: {
        ...state.settings,
        llm: { ...state.settings.llm, ...config }
      }
    })),

  setEditorConfig: (config) =>
    set((state) => ({
      settings: {
        ...state.settings,
        editor: { ...state.settings.editor, ...config }
      }
    })),

  setRecoveryConfig: (config) =>
    set((state) => ({
      settings: {
        ...state.settings,
        recovery: { ...state.settings.recovery, ...config }
      }
    })),

  addRecentFile: (path: string) => {
    const name = path.split('/').pop() || path
    const newRecent: RecentFile = {
      path,
      name,
      openedAt: Date.now()
    }

    set((state) => {
      // Remove existing entry for this path if present
      const existing = state.settings.recentFiles || []
      const filtered = existing.filter((f) => f.path !== path)
      // Add to front and limit to MAX_RECENT_FILES
      const updated = [newRecent, ...filtered].slice(0, MAX_RECENT_FILES)
      return {
        settings: {
          ...state.settings,
          recentFiles: updated
        }
      }
    })

    // Auto-save and rebuild native menu
    get().saveSettings().then(() => {
      if (window.api) {
        window.api.rebuildMenu()
      }
    })
  },

  clearRecentFiles: () => {
    set((state) => ({
      settings: {
        ...state.settings,
        recentFiles: []
      }
    }))
    // Auto-save and rebuild native menu
    get().saveSettings().then(() => {
      if (window.api) {
        window.api.rebuildMenu()
      }
    })
  },

  getRecentFiles: () => {
    return get().settings.recentFiles || []
  }
}))
