import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useNotificationStore } from '../stores/notificationStore'
import { serializeMarkdown, extractFirstH1 } from '../lib/markdown'
import { handleMissingPath, isMissingPathFileError } from '../lib/stalePath'
import { isDiskNewerThanBaseline, useSaveConflictStore } from '../lib/diskSync'
import { clearDraft } from '../lib/persistence'
import { openFile as openFileInTab, newTab, markActiveTabSaved } from '../tabs/actions'
import { flushActiveProjections } from '../document/session'

// Sanitize filename by removing invalid characters
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 100)
}

/** The bytes a save writes: frontmatter + body, or the raw text for `.txt`. */
export function buildSaveContent(
  content: string,
  frontmatter: Record<string, unknown>,
  path?: string | null
): string {
  if (path?.endsWith('.txt')) {
    return content
  }
  return serializeMarkdown(content, frontmatter)
}

function getPathFilename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'document.md'
}

/** The editor store's document after the session's pending projection has landed. */
function currentDocument() {
  flushActiveProjections()
  return useEditorStore.getState().document
}

export function useEditor() {
  const {
    document,
    cursorPosition,
    setContent,
    setFrontmatter,
    setCursorPosition,
    setActiveChatId
  } = useEditorStore()

  const { activeConversationId } = useChatStore()

  // Keep the current document ID in sync for auto-saving
  useEffect(() => {
    setCurrentDocumentId(document.documentId)
  }, [document.documentId])

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

  const saveContentAs = useCallback(async (content: string, defaultFilename?: string | null) => {
    if (!window.api) return
    try {
      const path = await window.api.saveFileAs(content, defaultFilename ?? undefined)
      if (path) {
        // The active tab adopts the path: identity, records and baseline follow.
        await markActiveTabSaved(path)
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
    const current = currentDocument()
    const content = buildSaveContent(current.content, current.frontmatter, current.path)

    if (current.path) {
      // External-edit guard (#843): the file changed on disk after we loaded
      // or last saved it — hold the save and let the user decide via the
      // conflict dialog instead of silently overwriting the disk edits.
      if (await isDiskNewerThanBaseline(current.path)) {
        useSaveConflictStore.getState().setConflict({ path: current.path, content })
        return
      }
      try {
        await window.api.saveFile(current.path, content)
        await markActiveTabSaved(current.path)
      } catch (error) {
        if (isMissingPathFileError(error)) {
          handleMissingPath(current.path, 'save')
          await saveContentAs(content, getPathFilename(current.path))
          return
        }

        console.error('Failed to save file:', error)
        useNotificationStore.getState().notify({
          id: `save-failed:${current.path}`,
          message: `Could not save "${getPathFilename(current.path)}". Use Save As to keep your edits.`,
          durationMs: 0
        })
      }
    } else {
      // Pre-fill the Save As dialog with the H1 heading (sanitized) if available
      const h1 = extractFirstH1(current.content)
      const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
      await saveContentAs(content, defaultFilename)
    }
  }, [saveContentAs])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const current = currentDocument()
    const content = buildSaveContent(current.content, current.frontmatter, current.path)
    // Pre-fill the Save As dialog with the H1 heading (sanitized) if the document is untitled
    const h1 = !current.path ? extractFirstH1(current.content) : null
    const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
    await saveContentAs(content, defaultFilename)
  }, [saveContentAs])

  // A new untitled tab (the empty state's "New Document").
  const newFile = useCallback(async () => {
    await newTab()
  }, [])

  const quickSaveWithTitle = useCallback(async (title: string): Promise<boolean> => {
    if (!window.api) return false

    const sanitizedTitle = sanitizeFilename(title)
    if (!sanitizedTitle) return false

    const current = currentDocument()
    const content = buildSaveContent(current.content, current.frontmatter, current.path)
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
      await markActiveTabSaved(finalPath)

      // Clear draft since we saved
      await clearDraft()

      return true
    } catch (error) {
      if (oldPath && isMissingPathFileError(error)) {
        handleMissingPath(oldPath, 'save')
        await saveContentAs(content, getPathFilename(oldPath))
        return !useEditorStore.getState().document.isDirty
      }
      console.error('Failed to quick save:', error)
      return false
    }
  }, [saveContentAs])

  return {
    document,
    cursorPosition,
    setContent,
    setFrontmatter,
    setCursorPosition,
    openFile,
    openFileFromPath,
    saveFile,
    saveFileAs,
    newFile,
    quickSaveWithTitle
  }
}
