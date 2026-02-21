import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'
import { parseMarkdown, serializeMarkdown, extractFirstH1 } from '../lib/markdown'
import {
  generateId,
  generateIdFromPath,
  clearDraft,
  saveConversations,
  saveAnnotations
} from '../lib/persistence'
import { useAnnotationStore } from '../extensions/ai-annotations'

// Sanitize filename by removing invalid characters
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim()
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
      const content = await window.api.readFile(filePath)
      const parsed = parseMarkdown(content)
      const newDocumentId = await generateIdFromPath(filePath)

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
      const parsed = parseMarkdown(result.content)
      // Use path-based ID for saved files so chat history persists
      const newDocumentId = await generateIdFromPath(result.path)

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

  const saveFile = useCallback(async () => {
    if (!window.api) return
    const content = serializeMarkdown(document.content, document.frontmatter)

    if (document.path) {
      await window.api.saveFile(document.path, content)
      setDirty(false)
    } else {
      // Pre-fill the Save As dialog with the H1 heading (sanitized) if available
      const h1 = extractFirstH1(document.content)
      const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
      const path = await window.api.saveFileAs(content, defaultFilename)
      if (path) {
        // Migrate chat history to path-based ID
        const newDocumentId = await generateIdFromPath(path)
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
    }
  }, [document, setDirty, setDocument])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const content = serializeMarkdown(document.content, document.frontmatter)
    // Pre-fill the Save As dialog with the H1 heading (sanitized) if the document is untitled
    const h1 = !document.path ? extractFirstH1(document.content) : null
    const defaultFilename = h1 ? sanitizeFilename(h1) + '.md' : undefined
    const path = await window.api.saveFileAs(content, defaultFilename)
    if (path) {
      // Migrate chat history to path-based ID
      const newDocumentId = await generateIdFromPath(path)
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
  }, [document, setDocument, setDirty])

  const newFile = useCallback(async () => {
    // Save current conversations before switching
    await saveCurrentConversation(document.documentId)

    // Reset creates a new documentId
    resetDocument()

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

    const content = serializeMarkdown(document.content, document.frontmatter)
    const settings = useSettingsStore.getState().settings
    const filename = sanitizedTitle.endsWith('.md') ? sanitizedTitle : `${sanitizedTitle}.md`

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
        await window.api.deleteFile(oldPath)
      } else {
        // New file or same name: just save
        await window.api.saveFile(finalPath, content)
      }

      // Migrate chat history to path-based ID
      const newDocumentId = await generateIdFromPath(finalPath)
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
      console.error('Failed to quick save:', error)
      return false
    }
  }, [document, setDocument, setDirty])

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
