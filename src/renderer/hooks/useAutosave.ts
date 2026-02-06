import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { serializeMarkdown } from '../lib/markdown'

/**
 * Hook that handles automatic saving of documents.
 * - Off mode: No autosave
 * - Auto mode: Save after user stops typing (debounced editor updates)
 * - Custom mode: Save on interval (user-configurable timer)
 * - Only saves documents that have a file path (not new unsaved documents)
 */
export function useAutosave() {
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const isSavingRef = useRef(false)
  const editorUnsubscribeRef = useRef<(() => void) | null>(null)

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
    const { settings, autosaveActive } = useSettingsStore.getState()
    const autosaveMode = settings.autosave?.mode ?? 'off'

    // Clean up any existing editor listener
    if (editorUnsubscribeRef.current) {
      editorUnsubscribeRef.current()
      editorUnsubscribeRef.current = null
    }

    // Setup based on mode
    if (autosaveMode === 'auto' && autosaveActive) {
      // Auto mode: Listen to editor updates and debounce
      const { editor } = useEditorInstanceStore.getState()
      if (editor) {
        const handleUpdate = () => {
          const { document } = useEditorStore.getState()

          // Clear existing timer
          clearTimer()

          // Only schedule save if document has path and is dirty
          if (document.path && document.isDirty) {
            // Debounce: wait 1.5 seconds after last edit
            timerRef.current = setTimeout(performSave, 1500)
          }
        }

        editor.on('update', handleUpdate)
        editorUnsubscribeRef.current = () => {
          editor.off('update', handleUpdate)
        }
      }
    }

    // Subscribe to document changes for custom mode
    const unsubscribe = useEditorStore.subscribe(
      (state) => ({ isDirty: state.document.isDirty, path: state.document.path }),
      ({ isDirty, path }) => {
        const { settings, autosaveActive } = useSettingsStore.getState()
        const mode = settings.autosave?.mode ?? 'off'

        // Clear any existing timer
        clearTimer()

        // Custom mode: interval-based autosave
        if (mode === 'custom' && autosaveActive && path && isDirty) {
          const intervalMs = (settings.autosave?.intervalSeconds ?? 30) * 1000
          timerRef.current = setTimeout(performSave, intervalMs)
        }
      },
      { equalityFn: (a, b) => a.isDirty === b.isDirty && a.path === b.path }
    )

    // Subscribe to settings changes to handle mode switching
    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => ({ autosave: state.settings.autosave, autosaveActive: state.autosaveActive }),
      ({ autosave, autosaveActive }) => {
        const mode = autosave?.mode ?? 'off'
        // If switched to off or runtime toggle is off, clear any pending save
        if (mode === 'off' || !autosaveActive) {
          clearTimer()
        }
      }
    )

    // Subscribe to editor instance changes (for auto mode)
    const unsubscribeEditor = useEditorInstanceStore.subscribe(
      (state) => state.editor,
      (editor) => {
        const { settings, autosaveActive } = useSettingsStore.getState()
        const mode = settings.autosave?.mode ?? 'off'

        // Clean up old listener
        if (editorUnsubscribeRef.current) {
          editorUnsubscribeRef.current()
          editorUnsubscribeRef.current = null
        }

        // Setup new listener if in auto mode
        if (mode === 'auto' && autosaveActive && editor) {
          const handleUpdate = () => {
            const { document } = useEditorStore.getState()
            clearTimer()
            if (document.path && document.isDirty) {
              timerRef.current = setTimeout(performSave, 1500)
            }
          }

          editor.on('update', handleUpdate)
          editorUnsubscribeRef.current = () => {
            editor.off('update', handleUpdate)
          }
        }
      }
    )

    return () => {
      clearTimer()
      if (editorUnsubscribeRef.current) {
        editorUnsubscribeRef.current()
        editorUnsubscribeRef.current = null
      }
      unsubscribe()
      unsubscribeSettings()
      unsubscribeEditor()
    }
  }, [clearTimer, performSave])

  // Force save function for use by other components
  const forceSave = useCallback(async () => {
    clearTimer()
    await performSave()
  }, [clearTimer, performSave])

  return { forceSave }
}
