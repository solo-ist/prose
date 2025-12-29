import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { parseMarkdown, serializeMarkdown } from '../lib/markdown'
import {
  generateId,
  generateIdFromPath,
  clearDraft,
  saveConversations
} from '../lib/persistence'

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

  const openFileFromPath = useCallback(async (filePath: string): Promise<boolean> => {
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

      // Load conversations for the document
      await loadForDocument(newDocumentId)

      // Clear draft since we opened a file
      await clearDraft()

      // Return true if document has content but no chat history (for auto-prompt)
      const conversations = useChatStore.getState().conversations
      return parsed.content.trim().length > 0 && conversations.length === 0
    } catch (error) {
      console.error('Failed to open file:', error)
      return false
    }
  }, [setDocument, document.documentId, saveCurrentConversation, loadForDocument])

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

      // Load conversations for the document
      await loadForDocument(newDocumentId)

      // Clear draft since we opened a file
      await clearDraft()

      // Return true if document has content but no chat history (for auto-prompt)
      const conversations = useChatStore.getState().conversations
      return parsed.content.trim().length > 0 && conversations.length === 0
    }
    return false
  }, [setDocument, document.documentId, saveCurrentConversation, loadForDocument])

  const saveFile = useCallback(async () => {
    if (!window.api) return
    const content = serializeMarkdown(document.content, document.frontmatter)

    if (document.path) {
      await window.api.saveFile(document.path, content)
      setDirty(false)
    } else {
      const path = await window.api.saveFileAs(content)
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

        setDocument({ documentId: newDocumentId, path })
        setDirty(false)
        setCurrentDocumentId(newDocumentId)
      }
    }
  }, [document, setDirty, setDocument])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const content = serializeMarkdown(document.content, document.frontmatter)
    const path = await window.api.saveFileAs(content)
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

    // Clear conversations for the new document
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      messages: []
    })
  }, [resetDocument, document.documentId, saveCurrentConversation])

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
    newFile
  }
}
