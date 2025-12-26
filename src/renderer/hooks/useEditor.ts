import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { parseMarkdown, serializeMarkdown } from '../lib/markdown'
import { generateId, clearDraft } from '../lib/persistence'

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

  const openFile = useCallback(async () => {
    if (!window.api) return

    // Save current conversations before switching
    await saveCurrentConversation(document.documentId)

    const result = await window.api.openFile()
    if (result) {
      const parsed = parseMarkdown(result.content)
      const newDocumentId = generateId()

      setDocument({
        documentId: newDocumentId,
        path: result.path,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        isDirty: false
      })

      // Load conversations for the new document
      await loadForDocument(newDocumentId)

      // Clear draft since we opened a file
      await clearDraft()
    }
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
        setPath(path)
        setDirty(false)
      }
    }
  }, [document, setDirty, setPath])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const content = serializeMarkdown(document.content, document.frontmatter)
    const path = await window.api.saveFileAs(content)
    if (path) {
      setPath(path)
      setDirty(false)
    }
  }, [document, setPath, setDirty])

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
    saveFile,
    saveFileAs,
    newFile
  }
}
