import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'
import { useNotificationStore } from '../stores/notificationStore'
import { parseMarkdown, serializeMarkdown, extractFirstH1, prepareTextContent } from '../lib/markdown'
import { extractMarkdownFromHtml } from '../lib/htmlExport'
import { handleMissingPath, isMissingPathFileError } from '../lib/stalePath'
import {
  generateId,
  generateIdFromPath,
  clearDraft,
  saveConversations,
  saveAnnotations,
  migrateReviewState,
} from '../lib/persistence'
import { useAnnotationStore } from '../extensions/ai-annotations'
import { getAISuggestions } from '../extensions/ai-suggestions'
import { useSuggestionStore } from '../extensions/ai-suggestions/store'
import { useCommentStore } from '../extensions/comments/store'
import { useReviewEventStore } from '../extensions/review-events'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'

// Sanitize filename by removing invalid characters
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 100)
}

// Build save content — skip frontmatter for .txt files
function buildSaveContent(
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

/**
 * Keep the active renderer stores aligned when Save As changes document ID.
 * The editor still owns live TipTap marks, so the pending suggestion buffer is
 * only populated when there is no live editor to restore from.
 */
async function migrateActiveReviewState(
  oldDocumentId: string,
  newDocumentId: string,
): Promise<void> {
  const suggestionStore = useSuggestionStore.getState()
  if (suggestionStore.pendingSave) await suggestionStore.pendingSave
  const reviewEventStore = useReviewEventStore.getState()
  if (reviewEventStore.pendingSave) await reviewEventStore.pendingSave

  const liveEditor = useEditorInstanceStore.getState().editor
  const migratedReviewState = await migrateReviewState(oldDocumentId, newDocumentId, {
    liveSuggestions: liveEditor
      ? getAISuggestions(liveEditor as unknown as Parameters<typeof getAISuggestions>[0])
      : [],
    history: suggestionStore.history,
    events: reviewEventStore.events,
    comments: useCommentStore.getState().pendingComments,
  })

  useSuggestionStore.setState({
    documentId: newDocumentId,
    pendingSuggestions: liveEditor ? [] : migratedReviewState.suggestions,
    history: migratedReviewState.history,
  })
  useReviewEventStore.setState({
    documentId: newDocumentId,
    events: migratedReviewState.events,
    pendingSave: null,
  })
  useCommentStore.setState({
    documentId: newDocumentId,
    pendingComments: migratedReviewState.comments,
    needsRestore: false,
  })
}

export function useEditor() {
  const {
    document,
    cursorPosition,
    setDocument,
    setContent,
    setPath,
    setDirty,
    setFrontmatter,
    setCursorPosition,
    setActiveChatId,
    setEditing,
    resetDocument
  } = useEditorStore()

  const {
    loadForDocument,
    saveCurrentConversation,
    addConversation,
    activeConversationId
  } = useChatStore()

  // Keep the current document ID in sync for auto-saving
  useEffect(() => {
    setCurrentDocumentId(document.documentId)
  }, [document.documentId])

  // Sync active chat ID to editor store for draft persistence
  useEffect(() => {
    setActiveChatId(activeConversationId)
  }, [activeConversationId, setActiveChatId])

  const openFileFromPath = useCallback(async (filePath: string, isRemarkableOCR = false): Promise<boolean> => {
    if (!window.api) return false

    // Save current conversations before switching
    await saveCurrentConversation(document.documentId)

    try {
      let raw = await window.api.readFile(filePath)
      const isHtml = filePath.endsWith('.html') || filePath.endsWith('.htm')
      if (isHtml) {
        const extracted = extractMarkdownFromHtml(raw)
        if (extracted) {
          raw = extracted
        } else {
          console.warn('[useEditor] HTML file has no embedded Prose markdown:', filePath)
          return false
        }
      }
      const isTxt = filePath.endsWith('.txt')
      const parsed = parseMarkdown(isTxt ? prepareTextContent(raw) : raw)
      const newDocumentId = await generateIdFromPath(filePath)

      // Clear document-scoped review records before the editor changes
      // identity. Activity must never render the previous document while its
      // async review loads are in flight.
      useSuggestionStore.getState().setDocumentId(newDocumentId)
      useCommentStore.getState().setDocumentId(newDocumentId)

      setDocument({
        documentId: newDocumentId,
        path: filePath,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        isDirty: false
      })

      // Clear reMarkable read-only state if this is a regular file open
      // (reMarkable OCR files set this separately via setRemarkableReadOnly)
      if (!isRemarkableOCR) {
        useEditorStore.getState().setRemarkableReadOnly(false, null)
      }

      // Load conversations for the document
      await loadForDocument(newDocumentId)

      // Load annotations for the document
      await useAnnotationStore.getState().loadAnnotations(newDocumentId)
      await useSuggestionStore.getState().loadSuggestions(newDocumentId)
      await useCommentStore.getState().loadComments(newDocumentId)

      // Clear draft since we opened a file
      await clearDraft()

      // Mark as editing so empty state doesn't show
      setEditing(true)

      // Add to recent files
      useSettingsStore.getState().addRecentFile(filePath)

      // Highlight file in sidebar
      useFileListStore.getState().revealAndSelectPath(filePath)

      // Return true if document has content but no chat history (for auto-prompt)
      const conversations = useChatStore.getState().conversations
      return parsed.content.trim().length > 0 && conversations.length === 0
    } catch (error) {
      if (isMissingPathFileError(error)) {
        handleMissingPath(filePath, 'open')
      }
      console.error('Failed to open file:', error)
      return false
    }
  }, [setDocument, document.documentId, saveCurrentConversation, loadForDocument, setEditing])

  const openFile = useCallback(async (): Promise<boolean> => {
    if (!window.api) return false

    // Save current conversations before switching
    await saveCurrentConversation(document.documentId)

    const result = await window.api.openFile()
    if (result) {
      let content = result.content
      const isHtml = result.path.endsWith('.html') || result.path.endsWith('.htm')
      if (isHtml) {
        const extracted = extractMarkdownFromHtml(content)
        if (extracted) {
          content = extracted
        } else {
          console.warn('[useEditor] HTML file has no embedded Prose markdown:', result.path)
          return false
        }
      }
      const isTxt = result.path.endsWith('.txt')
      const parsed = parseMarkdown(isTxt ? prepareTextContent(content) : content)
      // Use path-based ID for saved files so chat history persists
      const newDocumentId = await generateIdFromPath(result.path)

      // Clear document-scoped review records before the editor changes
      // identity. Activity must never render the previous document while its
      // async review loads are in flight.
      useSuggestionStore.getState().setDocumentId(newDocumentId)
      useCommentStore.getState().setDocumentId(newDocumentId)

      setDocument({
        documentId: newDocumentId,
        path: result.path,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        isDirty: false
      })

      // Clear reMarkable read-only state when opening via file dialog
      useEditorStore.getState().setRemarkableReadOnly(false, null)

      // Load conversations for the document
      await loadForDocument(newDocumentId)

      // Load annotations for the document
      await useAnnotationStore.getState().loadAnnotations(newDocumentId)
      await useSuggestionStore.getState().loadSuggestions(newDocumentId)
      await useCommentStore.getState().loadComments(newDocumentId)

      // Clear draft since we opened a file
      await clearDraft()

      // Mark as editing so empty state doesn't show
      setEditing(true)

      // Add to recent files
      useSettingsStore.getState().addRecentFile(result.path)

      // Highlight file in sidebar
      useFileListStore.getState().revealAndSelectPath(result.path)

      // Return true if document has content but no chat history (for auto-prompt)
      const conversations = useChatStore.getState().conversations
      return parsed.content.trim().length > 0 && conversations.length === 0
    }
    return false
  }, [setDocument, document.documentId, saveCurrentConversation, loadForDocument, setEditing])

  const saveContentAs = useCallback(async (content: string, defaultFilename?: string | null) => {
    if (!window.api) return
    try {
      const path = await window.api.saveFileAs(content, defaultFilename ?? undefined)
      if (path) {
        // Migrate chat history to path-based ID
        const oldDocumentId = document.documentId
        const newDocumentId = await generateIdFromPath(path)
        await migrateActiveReviewState(oldDocumentId, newDocumentId)
        const conversations = useChatStore.getState().conversations

        // Save conversations under new path-based ID
        if (conversations.length > 0) {
          const migratedConversations = conversations.map((c) => ({
            ...c,
            documentId: newDocumentId
          }))
          await saveConversations(newDocumentId, migratedConversations)
          useChatStore.setState({ conversations: migratedConversations })
        }

        // Migrate annotations to path-based ID
        const annotations = useAnnotationStore.getState().annotations
        if (annotations.length > 0) {
          const migratedAnnotations = annotations.map((a) => ({
            ...a,
            documentId: newDocumentId
          }))
          await saveAnnotations(newDocumentId, migratedAnnotations)
          useAnnotationStore.setState({ annotations: migratedAnnotations, documentId: newDocumentId })
        } else {
          useAnnotationStore.getState().setDocumentId(newDocumentId)
        }

        setDocument({ documentId: newDocumentId, path })
        setDirty(false)
        setCurrentDocumentId(newDocumentId)
      }
    } catch (error) {
      console.error('Failed to save file as:', error)
      useNotificationStore.getState().notify({
        id: 'save-as-failed',
        message: 'Could not save this document. Choose another location and try again.',
        durationMs: 0
      })
    }
  }, [setDocument, setDirty, document.documentId])

  const saveFile = useCallback(async () => {
    if (!window.api) return
    const content = buildSaveContent(document.content, document.frontmatter, document.path)

    if (document.path) {
      try {
        await window.api.saveFile(document.path, content)
        setDirty(false)
      } catch (error) {
        if (isMissingPathFileError(error)) {
          handleMissingPath(document.path, 'save')
          await saveContentAs(content, getPathFilename(document.path))
          return
        }

        console.error('Failed to save file:', error)
        useNotificationStore.getState().notify({
          id: `save-failed:${document.path}`,
          message: `Could not save "${getPathFilename(document.path)}". Use Save As to keep your edits.`,
          durationMs: 0
        })
      }
    } else {
      // Pre-fill the Save As dialog with the H1 heading (sanitized) if available
      const h1 = extractFirstH1(document.content)
      const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
      await saveContentAs(content, defaultFilename)
    }
  }, [document, saveContentAs, setDirty])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const content = buildSaveContent(document.content, document.frontmatter, document.path)
    // Pre-fill the Save As dialog with the H1 heading (sanitized) if the document is untitled
    const h1 = !document.path ? extractFirstH1(document.content) : null
    const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
    await saveContentAs(content, defaultFilename)
  }, [document, saveContentAs])

  const newFile = useCallback(async () => {
    // Save current conversations before switching
    await saveCurrentConversation(document.documentId)

    // Reset creates a new documentId
    resetDocument()
    const newDocumentId = useEditorStore.getState().document.documentId
    useSuggestionStore.getState().setDocumentId(newDocumentId)
    useCommentStore.getState().setDocumentId(newDocumentId)

    // Clear conversations and context for the new document
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      messages: [],
      context: null
    })

    // Clear annotations for the new document
    useAnnotationStore.getState().clearAnnotations()

    // Mark as editing so empty state hides and editor shows
    setEditing(true)
  }, [resetDocument, document.documentId, saveCurrentConversation, setEditing])

  const quickSaveWithTitle = useCallback(async (title: string): Promise<boolean> => {
    if (!window.api) return false

    const sanitizedTitle = sanitizeFilename(title)
    if (!sanitizedTitle) return false

    const content = buildSaveContent(document.content, document.frontmatter, document.path)
    const settings = useSettingsStore.getState().settings
    const currentExt = document.path?.endsWith('.txt') ? '.txt' : '.md'
    const hasKnownExt = /\.(md|markdown|txt)$/.test(sanitizedTitle)
    const filename = hasKnownExt ? sanitizedTitle : `${sanitizedTitle}${currentExt}`

    let targetFolder: string
    let newPath: string
    let isRename = false
    const oldPath = document.path

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

      // Migrate chat history to path-based ID
      const oldDocumentId = document.documentId
      const newDocumentId = await generateIdFromPath(finalPath)
      await migrateActiveReviewState(oldDocumentId, newDocumentId)
      const conversations = useChatStore.getState().conversations

      if (conversations.length > 0) {
        const migratedConversations = conversations.map((c) => ({
          ...c,
          documentId: newDocumentId
        }))
        await saveConversations(newDocumentId, migratedConversations)
        useChatStore.setState({ conversations: migratedConversations })
      }

      // Migrate annotations to path-based ID
      const annotations = useAnnotationStore.getState().annotations
      if (annotations.length > 0) {
        const migratedAnnotations = annotations.map((a) => ({
          ...a,
          documentId: newDocumentId
        }))
        await saveAnnotations(newDocumentId, migratedAnnotations)
        useAnnotationStore.setState({ annotations: migratedAnnotations, documentId: newDocumentId })
      } else {
        useAnnotationStore.getState().setDocumentId(newDocumentId)
      }

      setDocument({ documentId: newDocumentId, path: finalPath })
      setDirty(false)
      setCurrentDocumentId(newDocumentId)

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
  }, [document, saveContentAs, setDocument, setDirty])

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
