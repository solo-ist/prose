import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { serializeMarkdown } from '../lib/markdown'

/**
 * Hook that handles automatic saving of documents.
 * - Only saves when autosave is enabled in settings
 * - Only saves documents that have a file path (not new unsaved documents)
 * - Uses a debounced interval to avoid excessive saves
 * - Resets the timer on each change
 */
export function useAutosave() {
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const isSavingRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const performSave = useCallback(async () => {
    const { document, setDirty } = useEditorStore.getState()

    // Don't save if:
    // - Already saving
    // - No file path (new unsaved document)
    // - Document is not dirty
    if (isSavingRef.current || !document.path || !document.isDirty) {
      return
    }

    isSavingRef.current = true

    try {
      const content = serializeMarkdown(document.content, document.frontmatter)
      await window.api?.saveFile(document.path, content)
      setDirty(false)
    } catch (error) {
      console.error('[Autosave] Failed to save:', error)
    } finally {
      isSavingRef.current = false
    }
  }, [])

  useEffect(() => {
    // Subscribe to document changes
    const unsubscribe = useEditorStore.subscribe(
      (state) => ({ isDirty: state.document.isDirty, path: state.document.path }),
      ({ isDirty, path }) => {
        const settings = useSettingsStore.getState().settings

        // Clear any existing timer
        clearTimer()

        // Only set up autosave if:
        // - Autosave is enabled
        // - Document has a path (is saved to disk)
        // - Document is dirty
        if (settings.autosave?.enabled && path && isDirty) {
          const intervalMs = (settings.autosave.intervalSeconds ?? 30) * 1000
          timerRef.current = setTimeout(performSave, intervalMs)
        }
      },
      { equalityFn: (a, b) => a.isDirty === b.isDirty && a.path === b.path }
    )

    // Also subscribe to settings changes to handle autosave being toggled
    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => state.settings.autosave,
      (autosave) => {
        // If autosave was disabled, clear any pending save
        if (!autosave?.enabled) {
          clearTimer()
        }
      }
    )

    return () => {
      clearTimer()
      unsubscribe()
      unsubscribeSettings()
    }
  }, [clearTimer, performSave])

  // Force save function for use by other components
  const forceSave = useCallback(async () => {
    clearTimer()
    await performSave()
  }, [clearTimer, performSave])

  return { forceSave }
}
