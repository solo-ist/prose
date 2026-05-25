import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Appearance, LegacyTheme, Settings, SettingsOnDisk } from '../types'
import { initRendererSentry, setRendererSentryEnabled } from '../lib/sentry'
import { getDefaultModel } from '../../shared/llm/models'
import type { ModelInfo } from '../../shared/llm/models'
import type { ToolMode } from '../../shared/tools/types'

const MAX_RECENT_FILES = 15

type SettingsTab = 'general' | 'appearance' | 'editor' | 'llm' | 'integrations' | 'account'

export const AI_CONSENT_VERSION = 1

const FRESH_INSTALL_APPEARANCE: Appearance = {
  color: 'mono',
  mode: 'system',
  icon: 'pilcrow',
  // Fresh installs never had a legacy theme to migrate from, so the v1.2
  // migration toast must not fire for them.
  migrationToastShown: true,
}

// Migrated users keep their color/mode (derived from the legacy theme) but
// adopt the new default Pilcrow icon.
const LEGACY_THEME_TO_APPEARANCE: Record<LegacyTheme, Appearance> = {
  light:               { color: 'mono',  mode: 'light',  icon: 'pilcrow', migrationToastShown: false },
  dark:                { color: 'mono',  mode: 'dark',   icon: 'pilcrow', migrationToastShown: false },
  system:              { color: 'mono',  mode: 'system', icon: 'pilcrow', migrationToastShown: false },
  'termy-green-light': { color: 'termy', mode: 'light',  icon: 'pilcrow', migrationToastShown: false },
  'termy-green-dark':  { color: 'termy', mode: 'dark',   icon: 'pilcrow', migrationToastShown: false },
}

function resolveEffectiveMode(mode: Appearance['mode']): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

// Toggle theme classes on <html>. Mono is implicit — no `theme-mono` class —
// so `:root` defaults apply naturally for that palette.
function applyAppearance(appearance: Appearance): void {
  const html = document.documentElement
  // Remove every class this module may have written, including legacy v1.1
  // class names that older settings files would have produced before migration.
  html.classList.remove('dark', 'theme-prose', 'theme-termy', 'termy-green-dark', 'termy-green-light')

  if (appearance.color === 'prose' || appearance.color === 'termy') {
    html.classList.add(`theme-${appearance.color}`)
  }
  if (resolveEffectiveMode(appearance.mode) === 'dark') {
    html.classList.add('dark')
  }
}

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  isDialogOpen: boolean
  isShortcutsDialogOpen: boolean
  isAboutDialogOpen: boolean
  isModelPickerOpen: boolean
  // Live model list fetched from provider, cached in memory until next launch
  fetchedModels: ModelInfo[] | null
  fetchedModelsAt: number | null
  isFetchingModels: boolean
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
  fetchModels: () => Promise<void>
  setAppearance: (patch: Partial<Appearance>) => void
  markMigrationToastShown: () => void
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
  setPersistedToolMode: (mode: ToolMode) => void
}

const defaultSettings: Settings = {
  appearance: FRESH_INSTALL_APPEARANCE,
  llm: {
    provider: 'anthropic',
    model: getDefaultModel('anthropic'),
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

// Drives the v1.1 → v1.2 migration. If the on-disk file has a `theme` field,
// it predates v1.2 and we derive `appearance` from it. The default-merged
// `appearance` (which carries fresh-install values) is discarded in that case.
function migrateOnDiskSettings(raw: SettingsOnDisk): Settings {
  // Strip the legacy `theme` field so it can't leak into in-memory Settings —
  // every consumer should see the migrated `appearance` instead.
  const { theme, appearance, ...rest } = raw

  let resolved: Appearance
  if (theme && LEGACY_THEME_TO_APPEARANCE[theme]) {
    resolved = LEGACY_THEME_TO_APPEARANCE[theme]
  } else if (appearance) {
    resolved = appearance
  } else {
    resolved = FRESH_INSTALL_APPEARANCE
  }

  return { ...rest, appearance: resolved }
}

// Single tracked cleanup for the prefers-color-scheme listener. Stored at
// module scope (not on the store) so hot reloads and rapid mode flips don't
// stack handlers.
let systemModeCleanup: (() => void) | null = null

function setupSystemModeListener(
  appearance: Appearance,
  set: (state: Partial<SettingsState>) => void,
): void {
  // Always tear down the previous listener before deciding whether to attach
  // a new one — handles mode changes both into and out of 'system'.
  if (systemModeCleanup) {
    systemModeCleanup()
    systemModeCleanup = null
  }

  if (appearance.mode !== 'system') return

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    applyAppearance(appearance)
    set({ effectiveTheme: resolveEffectiveMode(appearance.mode) })
  }
  mediaQuery.addEventListener('change', handler)
  systemModeCleanup = () => mediaQuery.removeEventListener('change', handler)
}

export const useSettingsStore = create<SettingsState>()(subscribeWithSelector((set, get) => ({
  settings: defaultSettings,
  isLoaded: false,
  isDialogOpen: false,
  isShortcutsDialogOpen: false,
  isAboutDialogOpen: false,
  isModelPickerOpen: false,
  fetchedModels: null,
  fetchedModelsAt: null,
  isFetchingModels: false,
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
        applyAppearance(defaultSettings.appearance)
        set({ isLoaded: true })
        return
      }
      const raw = await window.api.loadSettings()

      // Backwards compatibility: migrate old autosave.enabled to autosave.mode
      if (raw.autosave && 'enabled' in raw.autosave) {
        const oldAutosave = raw.autosave as { enabled: boolean; intervalSeconds: number }
        raw.autosave = {
          mode: oldAutosave.enabled ? 'custom' : 'off',
          intervalSeconds: oldAutosave.intervalSeconds ?? 30
        }
      }

      const migrated = migrateOnDiskSettings(raw)
      const effectiveTheme = resolveEffectiveMode(migrated.appearance.mode)

      set({
        settings: { ...defaultSettings, ...migrated },
        isLoaded: true,
        effectiveTheme
      })

      // Apply appearance and (re)attach the system-mode listener
      applyAppearance(migrated.appearance)
      setupSystemModeListener(migrated.appearance, set)

      // Re-apply the saved dock icon on launch (macOS only; no-op elsewhere) —
      // otherwise the dock reverts to the bundle default until the user next
      // changes the icon. This is what makes the icon choice persist visually.
      window.api.setAppIcon?.(migrated.appearance.icon)

      // If we migrated a legacy theme field, persist the cleaned shape so the
      // next launch reads the new schema and the migration code path becomes
      // a no-op for this user.
      if (raw.theme) {
        get().saveSettings().catch((err) => {
          console.warn('[settings] failed to persist migrated appearance:', err)
        })
      }

      // Hydrate chatStore toolMode from persisted settings (global, applies to all tabs).
      // Import lazily to avoid a static top-level import that could cause sandbox issues.
      // The persisted value takes priority; fall back to the store's in-memory default.
      const persistedToolMode = settings.toolMode ?? defaultSettings.toolMode ?? 'editor'
      const { useChatStore } = await import('./chatStore')
      useChatStore.getState().setToolMode(persistedToolMode)

      // Initialize Sentry if user has opted in
      initRendererSentry(raw?.errorTracking?.enabled === true)

      // Refresh the live model list in the background if we have an API key
      if (raw?.llm?.apiKey) {
        get().fetchModels().catch(() => { /* surfaced via state, not a crash */ })
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

  setDialogOpen: (open, tab) => set({
    isDialogOpen: open,
    dialogTab: tab ?? (open ? get().dialogTab : 'general')
  }),

  setDialogTab: (tab) => set({ dialogTab: tab }),

  setShortcutsDialogOpen: (open) => set({ isShortcutsDialogOpen: open }),

  setAboutDialogOpen: (open) => set({ isAboutDialogOpen: open }),

  setModelPickerOpen: (open) => set({ isModelPickerOpen: open }),

  fetchModels: async () => {
    const { settings, isFetchingModels } = get()
    if (isFetchingModels) return
    if (!settings.llm.apiKey) return
    if (typeof window === 'undefined' || !window.api?.fetchModels) return

    set({ isFetchingModels: true })
    try {
      const result = await window.api.fetchModels({
        provider: settings.llm.provider,
        apiKey: settings.llm.apiKey
      })
      if (result.models && result.models.length > 0) {
        set({ fetchedModels: result.models, fetchedModelsAt: Date.now() })
      }
    } catch (err) {
      console.warn('[settings] fetchModels failed:', err)
    } finally {
      set({ isFetchingModels: false })
    }
  },

  setAppearance: (patch) => {
    const prevIcon = get().settings.appearance.icon
    const merged: Appearance = { ...get().settings.appearance, ...patch }
    const effectiveTheme = resolveEffectiveMode(merged.mode)
    set((state) => ({
      settings: { ...state.settings, appearance: merged },
      effectiveTheme
    }))

    applyAppearance(merged)
    setupSystemModeListener(merged, set)

    // Live dock icon swap when the icon preference changes (macOS only)
    if (patch.icon !== undefined && patch.icon !== prevIcon) {
      window.api?.setAppIcon?.(patch.icon)
    }

    get().saveSettings()
  },

  // One-time post-migration toast (#499 PR 4). Flips the persisted
  // `migrationToastShown` sentinel so the toast never fires again.
  markMigrationToastShown: () => {
    if (get().settings.appearance.migrationToastShown) return
    set((state) => ({
      settings: {
        ...state.settings,
        appearance: { ...state.settings.appearance, migrationToastShown: true }
      }
    }))
    get().saveSettings()
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

  // Sets the consent value only — does NOT close the AI consent dialog. The
  // OSS two-step flow needs the dialog to stay open after consent so it can
  // hand off to the skill-download step; the caller is responsible for
  // closing via setAIConsentDialogOpen(false) at the appropriate moment.
  // (The MAS branch closes via AlertDialogAction's built-in onOpenChange.)
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

  setAIConsentDialogOpen: (open) => set({ isAIConsentDialogOpen: open }),

  setPersistedToolMode: (mode) => {
    set((state) => ({
      settings: { ...state.settings, toolMode: mode }
    }))
    get().saveSettings()
  }
})))
