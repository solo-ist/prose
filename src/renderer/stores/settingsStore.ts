import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Appearance, AppearanceOnDisk, ColorTheme, Favorite, LegacyTheme, Project, Settings, SettingsOnDisk } from '../types'
import { initRendererSentry, setRendererSentryEnabled } from '../lib/sentry'
import { getDefaultModel } from '../../shared/llm/models'
import type { ModelInfo } from '../../shared/llm/models'
import type { ToolMode } from '../../shared/tools/types'

const MAX_RECENT_FILES = 15

/** Shared promise for concurrent `loadSettings` callers; see `loadSettings`. */
let loadInFlight: Promise<void> | null = null

/** Tail of the settings-write chain; see `saveSettings`. */
let saveQueue: Promise<void> = Promise.resolve()

type SettingsTab = 'general' | 'appearance' | 'editor' | 'llm' | 'integrations' | 'account'

export const AI_CONSENT_VERSION = 1

const FRESH_INSTALL_APPEARANCE: Appearance = {
  lightColor: 'mono',
  darkColor: 'prose',
  mode: 'system',
  icon: 'pilcrow',
}

function appearanceFromSingleColor(
  color: ColorTheme,
  mode: Appearance['mode'],
): Appearance {
  return {
    lightColor: color,
    darkColor: color,
    mode,
    icon: 'pilcrow',
  }
}

// Migrated users keep their color/mode (derived from the legacy theme) but
// adopt the new default Pilcrow icon.
const LEGACY_THEME_TO_APPEARANCE: Record<LegacyTheme, Appearance> = {
  light:               appearanceFromSingleColor('mono', 'light'),
  dark:                appearanceFromSingleColor('mono', 'dark'),
  system:              appearanceFromSingleColor('mono', 'system'),
  'termy-green-light': appearanceFromSingleColor('termy', 'light'),
  'termy-green-dark':  appearanceFromSingleColor('termy', 'dark'),
}

function resolveEffectiveMode(mode: Appearance['mode']): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function resolveEffectiveColor(appearance: Appearance): ColorTheme {
  return resolveEffectiveMode(appearance.mode) === 'dark' ? appearance.darkColor : appearance.lightColor
}

function normalizeAppearance(appearance: AppearanceOnDisk | undefined): Appearance {
  if (!appearance) return FRESH_INSTALL_APPEARANCE

  const fallbackColor = appearance.color ?? FRESH_INSTALL_APPEARANCE.lightColor
  return {
    lightColor: appearance.lightColor ?? fallbackColor,
    darkColor: appearance.darkColor ?? fallbackColor,
    mode: appearance.mode ?? FRESH_INSTALL_APPEARANCE.mode,
    // Pilcrow is the only icon as of 1.9.0 (#1052). Any other stored value —
    // one of the six removed variants, or the nonexistent 'default' some test
    // fixtures seeded — is coerced rather than carried forward.
    icon: 'pilcrow',
  }
}

// Toggle theme classes on <html>. Mono is implicit — no `theme-mono` class —
// so `:root` defaults apply naturally for that palette.
function applyAppearance(appearance: Appearance): void {
  const html = document.documentElement
  const effectiveMode = resolveEffectiveMode(appearance.mode)
  const effectiveColor = resolveEffectiveColor(appearance)
  // Remove every class this module may have written, including legacy v1.1
  // class names that older settings files would have produced before migration.
  html.classList.remove('dark', 'theme-prose', 'theme-termy', 'termy-green-dark', 'termy-green-light')

  if (effectiveColor === 'prose' || effectiveColor === 'termy') {
    html.classList.add(`theme-${effectiveColor}`)
  }
  if (effectiveMode === 'dark') {
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
  effectiveColor: ColorTheme
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
  setLLMConfig: (config: Partial<Settings['llm']>) => void
  setEditorConfig: (config: Partial<Settings['editor']>) => void
  setRecoveryConfig: (config: Partial<NonNullable<Settings['recovery']>>) => void
  setDefaultSaveDirectory: (path: string) => void
  setRemarkableConfig: (config: Partial<NonNullable<Settings['remarkable']>>) => void
  setFileAssociationConfig: (config: Partial<NonNullable<Settings['fileAssociation']>>) => void
  setAutosaveConfig: (config: Partial<NonNullable<Settings['autosave']>>) => void
  toggleAutosaveActive: () => void
  addRecentFile: (path: string) => void
  removeRecentFile: (path: string) => void
  pruneRecentFiles: (paths: string[]) => void
  setErrorTracking: (enabled: boolean) => void
  setFeatureFlag: (flag: keyof NonNullable<Settings['featureFlags']>, enabled: boolean) => void
  setAIConsent: (consented: boolean) => void
  isAIConsentDialogOpen: boolean
  setAIConsentDialogOpen: (open: boolean) => void
  // Release notes modal (#1058)
  isReleaseNotesOpen: boolean
  setReleaseNotesOpen: (open: boolean) => void
  setLastSeenVersion: (version: string) => void
  setPersistedToolMode: (mode: ToolMode) => void
  // Projects
  addProject: (project: Project) => void
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>) => void
  removeProject: (id: string) => void
  setActiveProject: (id: string | null) => void
  // Favorites
  addFavorite: (favorite: Favorite) => void
  removeFavorite: (id: string) => void
  updateFavorite: (id: string, patch: Partial<Omit<Favorite, 'id'>>) => void
  // Menu customization
  setMenuCustomization: (menuId: string, config: { order: string[]; hidden: string[]; barCount?: number }) => void
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
    resolved = normalizeAppearance(appearance)
  } else {
    resolved = FRESH_INSTALL_APPEARANCE
  }

  // Heal a base root clobbered by addProjectFromPicker in v1.6.0/v1.6.1, which
  // set defaultSaveDirectory to the newly added project's path. The explorer's
  // back-navigation (backToProjectsList / exitToRoot) returns to
  // defaultSaveDirectory, so a base root equal to a project path resolved
  // straight back into the project — trapping navigation inside it. Clearing
  // it falls back to the documents default; the Files panel's folder picker
  // re-sets it on the next explicit pick.
  let defaultSaveDirectory = rest.defaultSaveDirectory
  if (defaultSaveDirectory && (rest.projects ?? []).some((p) => p.path === defaultSaveDirectory)) {
    defaultSaveDirectory = undefined
  }

  // Heal a base-root bookmark clobbered by addProjectFromPicker/switchToProject
  // in v1.6.0–v1.6.2 (#654), which synced the active project's bookmark into
  // the legacy masDirectoryBookmark slot — destroying the base root's only
  // bookmark. If the slot holds a project/favorite bookmark it is the clobber
  // artifact, not the base root's: clear it and the now-inaccessible base-root
  // path so the Files panel falls back to the folder picker; the next explicit
  // pick re-establishes both.
  let masDirectoryBookmark = rest.masDirectoryBookmark
  if (
    masDirectoryBookmark &&
    [...(rest.projects ?? []), ...(rest.favorites ?? [])].some((e) => e.bookmark === masDirectoryBookmark)
  ) {
    masDirectoryBookmark = undefined
    defaultSaveDirectory = undefined
  }

  return { ...rest, defaultSaveDirectory, masDirectoryBookmark, appearance: resolved }
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
    const effectiveTheme = resolveEffectiveMode(appearance.mode)
    applyAppearance(appearance)
    set({ effectiveTheme, effectiveColor: resolveEffectiveColor(appearance) })
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
  effectiveColor: FRESH_INSTALL_APPEARANCE.darkColor,
  autosaveActive: true, // Runtime toggle, starts active

  setSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings }
    })),

  loadSettings: async () => {
    // Every component using `useSettings()` fires its own load while `isLoaded` is
    // false, so a cold start issues ~7 concurrent reads. Each one ends by REPLACING
    // `settings` with what it read, so the last to resolve wins — and silently
    // discards anything written while it was in flight. That is how #1058's
    // `lastSeenVersion` was lost on a fresh install: it was written, then a load
    // that had read the file beforehand landed on top of it.
    //
    // Coalescing makes the concurrent callers share one read, so there is no stale
    // snapshot to land late. A later, genuinely new load still runs normally.
    if (loadInFlight) return loadInFlight
    loadInFlight = (async () => {
      try {
        // Guard for when running in browser without Electron
        if (!window.api) {
          console.warn('window.api not available - using default settings')
          const effectiveTheme = resolveEffectiveMode(defaultSettings.appearance.mode)
          applyAppearance(defaultSettings.appearance)
          set({
            isLoaded: true,
            effectiveTheme,
            effectiveColor: resolveEffectiveColor(defaultSettings.appearance)
          })
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
        const effectiveColor = resolveEffectiveColor(migrated.appearance)

        set({
          settings: { ...defaultSettings, ...migrated },
          isLoaded: true,
          effectiveTheme,
          effectiveColor
        })

        // Apply appearance and (re)attach the system-mode listener
        applyAppearance(migrated.appearance)
        setupSystemModeListener(migrated.appearance, set)

        // Pin the dock tile to Pilcrow on launch (macOS only; no-op elsewhere).
        // Dev-only in effect: the main-side handler early-returns when packaged
        // (#1095), because pinning a bitmap there overrides the Assets.car
        // bundle icon and kills #812's appearance variants on the dock. Left as
        // an unconditional call so the dev fix stays in one place — main owns
        // the packaged/dev decision.
        window.api.applyDockIcon?.()

        // If we migrated a legacy theme field or healed a project-clobbered
        // base root / bookmark slot, persist the cleaned shape so the next
        // launch reads the new values and the migration code path becomes a
        // no-op for this user.
        if (
          raw.theme ||
          (raw.appearance && (
            raw.appearance.color !== undefined ||
            raw.appearance.lightColor === undefined ||
            raw.appearance.darkColor === undefined
          )) ||
          raw.defaultSaveDirectory !== migrated.defaultSaveDirectory ||
          raw.masDirectoryBookmark !== migrated.masDirectoryBookmark
        ) {
          get().saveSettings().catch((err) => {
            console.warn('[settings] failed to persist migrated appearance:', err)
          })
        }

        // Hydrate chatStore toolMode from persisted settings (global, applies to all tabs).
        // Import lazily to avoid a static top-level import that could cause sandbox issues.
        // The persisted value takes priority; fall back to the store's in-memory default.
        const persistedToolMode = migrated.toolMode ?? defaultSettings.toolMode ?? 'editor'
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
    })().finally(() => {
      loadInFlight = null
    })
    return loadInFlight
  },

  saveSettings: async () => {
    // Serialized, and the snapshot is taken when the write runs rather than when
    // it is queued. Concurrent callers are ordinary here — `loadSettings` persists
    // a migrated shape while a component writes its own key — and two overlapping
    // `writeFile`s have no defined completion order, so the earlier caller could
    // land last and silently drop the later one's change. That cost the #1058
    // `lastSeenVersion` write on every fresh install, which races the migration
    // save exactly.
    saveQueue = saveQueue.then(async () => {
      try {
        if (!window.api) return
        await window.api.saveSettings(get().settings)
      } catch (error) {
        console.error('Failed to save settings:', error)
      }
    })
    return saveQueue
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
    const merged: Appearance = { ...get().settings.appearance, ...patch }
    const effectiveTheme = resolveEffectiveMode(merged.mode)
    const effectiveColor = resolveEffectiveColor(merged)
    set((state) => ({
      settings: { ...state.settings, appearance: merged },
      effectiveTheme,
      effectiveColor
    }))

    applyAppearance(merged)
    setupSystemModeListener(merged, set)


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
    get().saveSettings().then(() => {
      window.api?.refreshRecentMenu()
    })
  },

  pruneRecentFiles: (paths) => {
    const stale = new Set(paths)
    let changed = false
    set((state) => {
      const current = state.settings.recentFiles || []
      const filtered = current.filter((p) => !stale.has(p))
      if (filtered.length === current.length) return state
      changed = true
      return {
        settings: { ...state.settings, recentFiles: filtered }
      }
    })
    if (changed) {
      get().saveSettings().then(() => {
        window.api?.refreshRecentMenu()
      })
    }
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

  isReleaseNotesOpen: false,

  setReleaseNotesOpen: (open) => set({ isReleaseNotesOpen: open }),

  setLastSeenVersion: (version) => {
    set((state) => ({
      settings: { ...state.settings, lastSeenVersion: version }
    }))
    get().saveSettings()
  },

  setPersistedToolMode: (mode) => {
    set((state) => ({
      settings: { ...state.settings, toolMode: mode }
    }))
    get().saveSettings()
  },

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  addProject: (project) => {
    set((state) => ({
      settings: {
        ...state.settings,
        projects: [...(state.settings.projects ?? []), project]
      }
    }))
    get().saveSettings()
  },

  updateProject: (id, patch) => {
    set((state) => ({
      settings: {
        ...state.settings,
        projects: (state.settings.projects ?? []).map((p) =>
          p.id === id ? { ...p, ...patch } : p
        )
      }
    }))
    get().saveSettings()
  },

  removeProject: (id) => {
    set((state) => {
      const updated = (state.settings.projects ?? []).filter((p) => p.id !== id)
      const activeId = state.settings.activeProjectId
      return {
        settings: {
          ...state.settings,
          projects: updated,
          // Clear active project if the removed project was active
          activeProjectId: activeId === id ? null : activeId
        }
      }
    })
    get().saveSettings()
  },

  setActiveProject: (id) => {
    set((state) => ({
      settings: {
        ...state.settings,
        activeProjectId: id,
        // Update lastOpenedAt on the project when switching to it
        projects: id === null
          ? state.settings.projects
          : (state.settings.projects ?? []).map((p) =>
              p.id === id ? { ...p, lastOpenedAt: new Date().toISOString() } : p
            )
      }
    }))
    get().saveSettings()
  },

  // -------------------------------------------------------------------------
  // Favorites
  // -------------------------------------------------------------------------

  addFavorite: (favorite) => {
    set((state) => ({
      settings: {
        ...state.settings,
        favorites: [...(state.settings.favorites ?? []), favorite]
      }
    }))
    get().saveSettings()
  },

  removeFavorite: (id) => {
    set((state) => ({
      settings: {
        ...state.settings,
        favorites: (state.settings.favorites ?? []).filter((f) => f.id !== id)
      }
    }))
    get().saveSettings()
  },

  updateFavorite: (id, patch) => {
    set((state) => ({
      settings: {
        ...state.settings,
        favorites: (state.settings.favorites ?? []).map((f) =>
          f.id === id ? { ...f, ...patch } : f
        )
      }
    }))
    get().saveSettings()
  },

  // -------------------------------------------------------------------------
  // Menu customization
  // -------------------------------------------------------------------------

  setMenuCustomization: (menuId, config) => {
    set((state) => ({
      settings: {
        ...state.settings,
        menuCustomization: {
          ...(state.settings.menuCustomization ?? {}),
          [menuId]: config
        }
      }
    }))
    get().saveSettings()
  }
})))
