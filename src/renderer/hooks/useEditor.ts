import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useNotificationStore } from '../stores/notificationStore'
import { extractFirstH1 } from '../lib/markdown'
import { handleMissingPath, isMissingPathFileError } from '../lib/stalePath'
import { isDiskNewerThanBaseline, useSaveConflictStore } from '../lib/diskSync'
import { clearDraft } from '../lib/persistence'
import { useTabStore } from '../stores/tabStore'
import { openFile as openFileInTab, newTab, markActiveTabSaved } from '../tabs/actions'
import { saveSnapshot, type SaveSnapshot } from '../document/session'

// Sanitize filename by removing invalid characters
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 100)
}

function getPathFilename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'document.md'
}

/**
 * The active tab and what a save of it writes (#1151): the session lands its
 * projection and serialises the body with the tab's frontmatter (the text
 * verbatim in source mode). Null with no tab open.
 */
function activeSave(): { tabId: string; path: string | null; snapshot: SaveSnapshot } | null {
  const tab = useTabStore.getState().getActiveTab()
  if (!tab) return null
  return { tabId: tab.id, path: tab.path, snapshot: saveSnapshot(tab.id) }
}

export function useEditor() {
  const { document, cursorPosition, setActiveChatId } = useEditorStore()

  const { activeConversationId } = useChatStore()

  // Sync active chat ID to editor store for draft persistence
  useEffect(() => {
    setActiveChatId(activeConversationId)
  }, [activeConversationId, setActiveChatId])

  // Open a file by path. Opens a tab (or switches to the file's tab); the
  // explorer's new-file dialog and the OS open event land here.
  const openFileFromPath = useCallback(async (filePath: string): Promise<boolean> => {
    if (!window.api) return false
    try {
      return (await openFileInTab(filePath)).shouldDescribe
    } catch (error) {
      console.error('Failed to open file:', error)
      return false
    }
  }, [])

  // File → Open dialog. The dialog returns the bytes, so the open skips the read.
  const openFile = useCallback(async (): Promise<boolean> => {
    if (!window.api) return false
    const result = await window.api.openFile()
    if (!result) return false
    try {
      return (await openFileInTab(result.path, { content: result.content })).shouldDescribe
    } catch (error) {
      console.error('Failed to open file:', error)
      return false
    }
  }, [])

  const saveContentAs = useCallback(async (content: string, defaultFilename?: string | null, written?: SaveSnapshot) => {
    if (!window.api) return
    try {
      const path = await window.api.saveFileAs(content, defaultFilename ?? undefined)
      if (path) {
        // The active tab adopts the path: identity, records and baseline follow.
        await markActiveTabSaved(path, written)
        await clearDraft()
      }
    } catch (error) {
      console.error('Failed to save file as:', error)
      useNotificationStore.getState().notify({
        id: 'save-as-failed',
        message: 'Could not save this document. Choose another location and try again.',
        durationMs: 0
      })
    }
  }, [])

  const saveFile = useCallback(async () => {
    if (!window.api) return
    const current = activeSave()
    if (!current) return
    const { tabId, path, snapshot } = current
    const content = snapshot.text

    if (path) {
      // External-edit guard (#843): the file changed on disk after we loaded
      // or last saved it — hold the save and let the user decide via the
      // conflict dialog instead of silently overwriting the disk edits.
      if (await isDiskNewerThanBaseline(path)) {
        useSaveConflictStore.getState().setConflict({ path, content, tabId, snapshot })
        return
      }
      try {
        await window.api.saveFile(path, content)
        await markActiveTabSaved(path, snapshot)
      } catch (error) {
        if (isMissingPathFileError(error)) {
          handleMissingPath(path, 'save')
          await saveContentAs(content, getPathFilename(path), snapshot)
          return
        }

        console.error('Failed to save file:', error)
        useNotificationStore.getState().notify({
          id: `save-failed:${path}`,
          message: `Could not save "${getPathFilename(path)}". Use Save As to keep your edits.`,
          durationMs: 0
        })
      }
    } else {
      // Pre-fill the Save As dialog with the H1 heading (sanitized) if available
      const h1 = extractFirstH1(snapshot.body)
      const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
      await saveContentAs(content, defaultFilename, snapshot)
    }
  }, [saveContentAs])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const current = activeSave()
    if (!current) return
    // Pre-fill the Save As dialog with the H1 heading (sanitized) if the document is untitled
    const h1 = !current.path ? extractFirstH1(current.snapshot.body) : null
    const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
    await saveContentAs(current.snapshot.text, defaultFilename, current.snapshot)
  }, [saveContentAs])

  // A new untitled tab (the empty state's "New Document").
  const newFile = useCallback(async () => {
    await newTab()
  }, [])

  const quickSaveWithTitle = useCallback(async (title: string): Promise<boolean> => {
    if (!window.api) return false

    const sanitizedTitle = sanitizeFilename(title)
    if (!sanitizedTitle) return false

    const current = activeSave()
    if (!current) return false
    const content = current.snapshot.text
    const settings = useSettingsStore.getState().settings
    const currentExt = current.path?.endsWith('.txt') ? '.txt' : '.md'
    const hasKnownExt = /\.(md|markdown|txt)$/.test(sanitizedTitle)
    const filename = hasKnownExt ? sanitizedTitle : `${sanitizedTitle}${currentExt}`

    let targetFolder: string
    let newPath: string
    let isRename = false
    const oldPath = current.path

    if (oldPath) {
      // Existing file: check if we're renaming or just saving
      const lastSlash = oldPath.lastIndexOf('/')
      targetFolder = oldPath.substring(0, lastSlash)
      newPath = `${targetFolder}/${filename}`

      // Check if the name is actually changing
      isRename = oldPath !== newPath
    } else {
      // New file: use default save directory or Documents
      targetFolder = settings.defaultSaveDirectory || await window.api.getDocumentsPath()
      newPath = `${targetFolder}/${filename}`
    }

    // For new files or renames to a different name, check for duplicates
    // Skip duplicate check if we're just saving to the same path
    let finalPath = newPath
    if (!oldPath || isRename) {
      let counter = 1
      while (await window.api.fileExists(finalPath)) {
        // If renaming to a path that already exists (and it's not the current file)
        if (isRename && finalPath === oldPath) {
          // We're "renaming" to the same name, just save in place
          break
        }
        const baseName = sanitizedTitle.replace(/\.md$/, '')
        finalPath = `${targetFolder}/${baseName} (${counter}).md`
        counter++
        if (counter > 100) {
          console.error('Too many duplicate files')
          return false
        }
      }
    }

    try {
      if (isRename && oldPath) {
        // Rename the file: save new content to new path, then delete old file
        await window.api.saveFile(finalPath, content)
        try {
          await window.api.deleteFile(oldPath)
        } catch (error) {
          if (!isMissingPathFileError(error)) throw error
          handleMissingPath(oldPath, 'save')
        }
      } else {
        // New file or same name: just save
        await window.api.saveFile(finalPath, content)
      }

      // The active tab adopts the path: identity, records and baseline follow.
      await markActiveTabSaved(finalPath, current.snapshot)

      // Clear draft since we saved
      await clearDraft()

      return true
    } catch (error) {
      if (oldPath && isMissingPathFileError(error)) {
        handleMissingPath(oldPath, 'save')
        await saveContentAs(content, getPathFilename(oldPath), current.snapshot)
        return !useEditorStore.getState().document.isDirty
      }
      console.error('Failed to quick save:', error)
      return false
    }
  }, [saveContentAs])

  return {
    document,
    cursorPosition,
    openFile,
    openFileFromPath,
    saveFile,
    saveFileAs,
    newFile,
    quickSaveWithTitle
  }
}
