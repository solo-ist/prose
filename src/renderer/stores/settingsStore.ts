import { create } from 'zustand'
import type { Settings } from '../types'

const MAX_RECENT_FILES = 15

type SettingsTab = 'general' | 'editor' | 'appearance' | 'llm' | 'integrations' | 'account'

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  isDialogOpen: boolean
  isShortcutsDialogOpen: boolean
  isAboutDialogOpen: boolean
  dialogTab: SettingsTab
  setSettings: (settings: Partial<Settings>) => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  setDialogOpen: (open: boolean, tab?: SettingsTab) => void
  setDialogTab: (tab: SettingsTab) => void
  setShortcutsDialogOpen: (open: boolean) => void
  setAboutDialogOpen: (open: boolean) => void
  setTheme: (theme: Settings['theme']) => void
  setLLMConfig: (config: Partial<Settings['llm']>) => void
  setEditorConfig: (config: Partial<Settings['editor']>) => void
  setRecoveryConfig: (config: Partial<NonNullable<Settings['recovery']>>) => void
  setDefaultSaveDirectory: (path: string) => void
  setRemarkableConfig: (config: Partial<NonNullable<Settings['remarkable']>>) => void
  addRecentFile: (path: string) => void
  setCustomCSS: (css: string) => void
}

const CUSTOM_CSS_STYLE_ID = 'prose-custom-css'

/**
 * Inject or update custom CSS in the document
 */
function injectCustomCSS(css: string | undefined): void {
  let styleEl = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null

  if (!css) {
    // Remove the style element if CSS is empty
    if (styleEl) {
      styleEl.remove()
    }
    return
  }

  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = CUSTOM_CSS_STYLE_ID
    document.head.appendChild(styleEl)
  }

  styleEl.textContent = css
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
    fontFamily: '"IBM Plex Mono", monospace'
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
  isAboutDialogOpen: false,
  dialogTab: 'general' as SettingsTab,

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

      // Apply custom CSS on load
      injectCustomCSS(settings.customCSS)
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

  setDialogOpen: (open, tab) => set({
    isDialogOpen: open,
    dialogTab: tab ?? (open ? get().dialogTab : 'general')
  }),

  setDialogTab: (tab) => set({ dialogTab: tab }),

  setShortcutsDialogOpen: (open) => set({ isShortcutsDialogOpen: open }),

  setAboutDialogOpen: (open) => set({ isAboutDialogOpen: open }),

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

  setDefaultSaveDirectory: (path) =>
    set((state) => ({
      settings: { ...state.settings, defaultSaveDirectory: path }
    })),

  setRemarkableConfig: (config) =>
    set((state) => ({
      settings: {
        ...state.settings,
        remarkable: { ...state.settings.remarkable, ...config } as Settings['remarkable']
      }
    })),

  addRecentFile: (path) => {
    set((state) => {
      const current = state.settings.recentFiles || []
      // Remove if already exists, then add to front
      const filtered = current.filter((p) => p !== path)
      const updated = [path, ...filtered].slice(0, MAX_RECENT_FILES)
      return {
        settings: { ...state.settings, recentFiles: updated }
      }
    })
    // Auto-save after adding recent file
    get().saveSettings()
  },

  setCustomCSS: (css) => {
    set((state) => ({
      settings: { ...state.settings, customCSS: css }
    }))
    // Apply custom CSS immediately
    injectCustomCSS(css)
  }
}))
