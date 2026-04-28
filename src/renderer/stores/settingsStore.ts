import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Settings } from '../types'
import { initRendererSentry, setRendererSentryEnabled } from '../lib/sentry'

const MAX_RECENT_FILES = 15

type SettingsTab = 'general' | 'editor' | 'llm' | 'integrations' | 'account'

export const AI_CONSENT_VERSION = 1

// Helper to apply theme to document
function applyTheme(theme: Settings['theme']): void {
  // Remove all theme classes first
  document.documentElement.classList.remove('dark', 'termy-green-dark', 'termy-green-light')

  // Apply the appropriate theme class(es)
  if (theme === 'termy-green-dark') {
    document.documentElement.classList.add('dark', 'termy-green-dark')
  } else if (theme === 'termy-green-light') {
    document.documentElement.classList.add('termy-green-light')
  } else {
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (isDark) {
      document.documentElement.classList.add('dark')
    }
  }
}

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  isDialogOpen: boolean
  isShortcutsDialogOpen: boolean
  isAboutDialogOpen: boolean
  isModelPickerOpen: boolean
  dialogTab: SettingsTab
  effectiveTheme: 'dark' | 'light'
  // Runtime state for autosave toggle (not persisted)
  autosaveActive: boolean
  setSettings: (settings: Partial<Settings>) => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  setDialogOpen: (open: boolean, tab?: SettingsTab) => void
  setDialogTab: (tab: SettingsTab) => void
  setShortcutsDialogOpen: (open: boolean) => void
  setAboutDialogOpen: (open: boolean) => void
  setModelPickerOpen: (open: boolean) => void
  setTheme: (theme: Settings['theme']) => void
  setLLMConfig: (config: Partial<Settings['llm']>) => void
  setEditorConfig: (config: Partial<Settings['editor']>) => void
  setRecoveryConfig: (config: Partial<NonNullable<Settings['recovery']>>) => void
  setDefaultSaveDirectory: (path: string) => void
  setRemarkableConfig: (config: Partial<NonNullable<Settings['remarkable']>>) => void
  setGoogleConfig: (config: Partial<NonNullable<Settings['google']>> | undefined) => void
  setFileAssociationConfig: (config: Partial<NonNullable<Settings['fileAssociation']>>) => void
  setAutosaveConfig: (config: Partial<NonNullable<Settings['autosave']>>) => void
  toggleAutosaveActive: () => void
  addRecentFile: (path: string) => void
  removeRecentFile: (path: string) => void
  setErrorTracking: (enabled: boolean) => void
  setFeatureFlag: (flag: keyof NonNullable<Settings['featureFlags']>, enabled: boolean) => void
  setAIConsent: (consented: boolean) => void
  isAIConsentDialogOpen: boolean
  setAIConsentDialogOpen: (open: boolean) => void
}

const defaultSettings: Settings = {
  theme: 'dark',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKey: '',
    emojiIcons: false
  },
  editor: {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: '"IBM Plex Mono", monospace'
  },
  recovery: {
    mode: 'silent'
  },
  autosave: {
    mode: 'off',
    intervalSeconds: 30
  }
}

// Helper to compute effective theme
function getEffectiveTheme(theme: Settings['theme']): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  if (theme === 'termy-green-dark') {
    return 'dark'
  }
  if (theme === 'termy-green-light') {
    return 'light'
  }
  return theme
}

// Track system theme listeners
let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null
let effectiveThemeListener: ((e: MediaQueryListEvent) => void) | null = null

function setupSystemThemeListener(theme: Settings['theme'], set: (state: Partial<SettingsState>) => void): void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  // Remove existing listeners if any
  if (systemThemeListener) {
    mediaQuery.removeEventListener('change', systemThemeListener)
    systemThemeListener = null
  }
  if (effectiveThemeListener) {
    mediaQuery.removeEventListener('change', effectiveThemeListener)
    effectiveThemeListener = null
  }

  // Only add listeners if theme is 'system'
  if (theme === 'system') {
    systemThemeListener = () => {
      applyTheme('system')
    }
    effectiveThemeListener = () => {
      set({ effectiveTheme: getEffectiveTheme('system') })
    }
    mediaQuery.addEventListener('change', systemThemeListener)
    mediaQuery.addEventListener('change', effectiveThemeListener)
  }
}

export const useSettingsStore = create<SettingsState>()(subscribeWithSelector((set, get) => ({
  settings: defaultSettings,
  isLoaded: false,
  isDialogOpen: false,
  isShortcutsDialogOpen: false,
  isAboutDialogOpen: false,
  isModelPickerOpen: false,
  isAIConsentDialogOpen: false,
  dialogTab: 'general' as SettingsTab,
  effectiveTheme: 'dark',
  autosaveActive: true, // Runtime toggle, starts active

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
      const theme = settings.theme || 'dark'
      const effectiveTheme = getEffectiveTheme(theme)

      // Backwards compatibility: migrate old autosave.enabled to autosave.mode
      if (settings.autosave && 'enabled' in settings.autosave) {
        const oldAutosave = settings.autosave as { enabled: boolean; intervalSeconds: number }
        settings.autosave = {
          mode: oldAutosave.enabled ? 'custom' : 'off',
          intervalSeconds: oldAutosave.intervalSeconds ?? 30
        }
      }

      set({
        settings: { ...defaultSettings, ...settings },
        isLoaded: true,
        effectiveTheme
      })

      // Apply theme and set up listener
      applyTheme(theme)
      setupSystemThemeListener(theme, set)

      // Initialize Sentry if user has opted in
      initRendererSentry(settings?.errorTracking?.enabled === true)
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

  setModelPickerOpen: (open) => set({ isModelPickerOpen: open }),

  setTheme: (theme) => {
    const effectiveTheme = getEffectiveTheme(theme)
    set((state) => ({
      settings: { ...state.settings, theme },
      effectiveTheme
    }))

    applyTheme(theme)
    setupSystemThemeListener(theme, set)
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

  setGoogleConfig: (config) => {
    set((state) => ({
      settings: {
        ...state.settings,
        google: config === undefined ? undefined : { ...state.settings.google, ...config } as Settings['google']
      }
    }))
    // Auto-save after updating Google config
    get().saveSettings()
  },

  setFileAssociationConfig: (config) => {
    set((state) => ({
      settings: {
        ...state.settings,
        fileAssociation: { ...state.settings.fileAssociation, ...config }
      }
    }))
    // Auto-save after updating file association
    get().saveSettings()
  },

  setAutosaveConfig: (config) => {
    set((state) => ({
      settings: {
        ...state.settings,
        autosave: { ...state.settings.autosave, ...config } as Settings['autosave']
      }
    }))
    // Auto-save settings after updating autosave config
    get().saveSettings()
  },

  toggleAutosaveActive: () => set((state) => ({ autosaveActive: !state.autosaveActive })),

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
    // Auto-save after adding recent file, then refresh the native menu
    get().saveSettings().then(() => {
      window.api?.refreshRecentMenu()
    })
  },

  removeRecentFile: (path) => {
    set((state) => {
      const current = state.settings.recentFiles || []
      const filtered = current.filter((p) => p !== path)
      return {
        settings: { ...state.settings, recentFiles: filtered }
      }
    })
    get().saveSettings()
  },

  setFeatureFlag: (flag, enabled) => {
    set((state) => ({
      settings: {
        ...state.settings,
        featureFlags: {
          ...state.settings.featureFlags,
          [flag]: enabled
        }
      }
    }))
    get().saveSettings()
  },

  setErrorTracking: (enabled) => {
    set((state) => ({
      settings: {
        ...state.settings,
        errorTracking: {
          enabled,
          enabledAt: enabled ? new Date().toISOString() : state.settings.errorTracking?.enabledAt
        }
      }
    }))
    // Toggle Sentry in both processes
    setRendererSentryEnabled(enabled)
    window.api?.sentrySetEnabled(enabled)
    // Persist
    get().saveSettings()
  },

  setAIConsent: (consented) => {
    set((state) => ({
      settings: {
        ...state.settings,
        aiConsent: {
          consented,
          consentedAt: new Date().toISOString(),
          version: AI_CONSENT_VERSION
        }
      }
    }))
    get().saveSettings()
  },

  setAIConsentDialogOpen: (open) => set({ isAIConsentDialogOpen: open })
})))
