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
    const { document, setDirty, setAutosaving } = useEditorStore.getState()

    // Don't save if:
    // - Already saving
    // - No file path (new unsaved document)
    // - Document is not dirty
    if (isSavingRef.current || !document.path || !document.isDirty) {
      return
    }

    isSavingRef.current = true
    setAutosaving(true)

    try {
      const content = serializeMarkdown(document.content, document.frontmatter)
      // Run save and minimum display time in parallel so "saving..." is visible
      await Promise.all([
        window.api?.saveFile(document.path, content),
        new Promise((r) => setTimeout(r, 500))
      ])
      setDirty(false)
    } catch (error) {
      console.error('[Autosave] Failed to save:', error)
    } finally {
      isSavingRef.current = false
      setAutosaving(false)
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

          // Schedule save if document has a path
          // Note: isDirty may not be set yet (Editor.tsx debounces store updates)
          // so we check it in performSave instead, which runs after the 1.5s delay
          if (document.path) {
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

        // Only manage timer in custom mode — auto mode manages its own timer via handleUpdate
        if (mode === 'custom') {
          clearTimer()
          if (autosaveActive && path && isDirty) {
            const intervalMs = (settings.autosave?.intervalSeconds ?? 30) * 1000
            timerRef.current = setTimeout(performSave, intervalMs)
          }
        }
      },
      { equalityFn: (a, b) => a.isDirty === b.isDirty && a.path === b.path }
    )

    // Subscribe to settings changes to handle mode switching
    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => ({ autosave: state.settings.autosave, autosaveActive: state.autosaveActive }),
      ({ autosave, autosaveActive }) => {
        const mode = autosave?.mode ?? 'off'

        // Clear any pending save and existing editor listener
        clearTimer()
        if (editorUnsubscribeRef.current) {
          editorUnsubscribeRef.current()
          editorUnsubscribeRef.current = null
        }

        // Re-attach editor listener if switching to auto mode
        if (mode === 'auto' && autosaveActive) {
          const { editor } = useEditorInstanceStore.getState()
          if (editor) {
            const handleUpdate = () => {
              const { document } = useEditorStore.getState()
              clearTimer()
              if (document.path) {
                timerRef.current = setTimeout(performSave, 1500)
              }
            }

            editor.on('update', handleUpdate)
            editorUnsubscribeRef.current = () => {
              editor.off('update', handleUpdate)
            }
          }
        }
      },
      { equalityFn: (a, b) => a.autosave === b.autosave && a.autosaveActive === b.autosaveActive }
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
            if (document.path) {
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
