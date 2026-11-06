import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore, activeTabOf } from '../stores/tabStore'
import { handleMissingPath, isMissingPathFileError } from '../lib/stalePath'
import { isDiskNewerThanBaseline, notifyExternalEditConflict } from '../lib/diskSync'
import { hasSession, saveSnapshot } from '../document/session'
import { markTabSaved } from '../tabs/actions'
import { planAutosave, type AutosaveMode } from './autosavePlan'

/** `auto` mode: this long after the last projection of a dirty tab (itself 500 ms after the last keystroke). */
export const AUTOSAVE_AUTO_DELAY_MS = 1500

/**
 * Autosave (#1151): one timer per dirty tab with a path, armed from the tab
 * record rather than the editor's `update` event, so a frontmatter-only
 * edit, a source-mode edit and a background edit (a chat turn) all save; a
 * tab switch cancels nothing, and a save marks the tab it wrote.
 * - Off: nothing.
 * - Auto: a dirty tab's debounce re-arms on every projection (typing stopped).
 * - Custom: the clean→dirty transition arms the interval once.
 */
export function useAutosave() {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const saving = useRef(new Set<string>())
  const blockedPathRef = useRef<string | null>(null)

  const clearTimer = useCallback((tabId: string) => {
    const timer = timers.current.get(tabId)
    if (!timer) return
    clearTimeout(timer)
    timers.current.delete(tabId)
  }, [])

  const clearAll = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])

  const performSave = useCallback(async (tabId: string) => {
    const tab = useTabStore.getState().getTabById(tabId)
    if (!tab?.path || !hasSession(tabId) || saving.current.has(tabId) || blockedPathRef.current === tab.path) return
    const path = tab.path
    // The projection lands inside the snapshot; the dirty flag is read after it.
    const snapshot = saveSnapshot(tabId)
    if (!useTabStore.getState().getTabById(tabId)?.isDirty) return

    // External-edit guard (#843): never autosave over a file that changed on
    // disk after our baseline — skip the write and surface the persistent
    // conflict toast instead (a dialog from a background timer would be
    // hostile). Re-checked on every attempt, so resolving the conflict
    // ("Load disk version" or a manual overwrite) resumes autosave.
    if (await isDiskNewerThanBaseline(path)) {
      notifyExternalEditConflict(tabId, path)
      return
    }

    saving.current.add(tabId)
    useEditorStore.getState().setAutosaving(true)
    try {
      // Run the save and a minimum display time in parallel so "saving..." is visible.
      await Promise.all([window.api?.saveFile(path, snapshot.text), new Promise((r) => setTimeout(r, 500))])
      blockedPathRef.current = null
      // The tab that was written, with what was written: typing during the write keeps it dirty.
      await markTabSaved(tabId, path, snapshot)
    } catch (error) {
      if (isMissingPathFileError(error)) {
        blockedPathRef.current = path
        clearTimer(tabId)
        handleMissingPath(path, 'autosave')
        return
      }
      console.error('[Autosave] Failed to save:', error)
    } finally {
      saving.current.delete(tabId)
      if (saving.current.size === 0) useEditorStore.getState().setAutosaving(false)
    }
  }, [clearTimer])

  const arm = useCallback((tabId: string, delay: number) => {
    clearTimer(tabId)
    timers.current.set(
      tabId,
      setTimeout(() => {
        timers.current.delete(tabId)
        void performSave(tabId)
      }, delay)
    )
  }, [clearTimer, performSave])

  useEffect(() => {
    const modeOf = (): AutosaveMode => {
      const { settings, autosaveActive } = useSettingsStore.getState()
      return autosaveActive ? (settings.autosave?.mode ?? 'off') : 'off'
    }
    const delayOf = (mode: AutosaveMode): number =>
      mode === 'auto' ? AUTOSAVE_AUTO_DELAY_MS : (useSettingsStore.getState().settings.autosave?.intervalSeconds ?? 30) * 1000

    const unsubscribeTabs = useTabStore.subscribe(
      (state) => state.tabs,
      (tabs, prev) => {
        const mode = modeOf()
        const plan = planAutosave(prev, tabs, mode)
        for (const id of plan.clear) clearTimer(id)
        for (const id of plan.arm) arm(id, delayOf(mode))
      }
    )

    // A mode change drops every pending timer; custom mode re-arms the dirty tabs.
    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => ({ autosave: state.settings.autosave, autosaveActive: state.autosaveActive }),
      () => {
        clearAll()
        const mode = modeOf()
        if (mode !== 'custom') return
        for (const tab of useTabStore.getState().tabs) {
          if (tab.isDirty && tab.path) arm(tab.id, delayOf(mode))
        }
      },
      { equalityFn: (a, b) => a.autosave === b.autosave && a.autosaveActive === b.autosaveActive }
    )

    // A blocked (missing) path unblocks once the shown document moves off it.
    const unsubscribePath = useTabStore.subscribe(
      (state) => activeTabOf(state)?.path ?? null,
      (path) => {
        if (path !== blockedPathRef.current) blockedPathRef.current = null
      }
    )

    return () => {
      clearAll()
      unsubscribeTabs()
      unsubscribeSettings()
      unsubscribePath()
    }
  }, [arm, clearAll, clearTimer])

  // Force save function for use by other components
  const forceSave = useCallback(async () => {
    const tabId = useTabStore.getState().activeTabId
    if (!tabId) return
    clearTimer(tabId)
    await performSave(tabId)
  }, [clearTimer, performSave])

  return { forceSave }
}
