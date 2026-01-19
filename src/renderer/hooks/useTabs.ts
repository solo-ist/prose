import { useCallback, useEffect } from 'react'
import { useTabStore, createTab, generateUntitledTitle, type Tab } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { useAnnotationStore } from '../extensions/ai-annotations'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'
import { parseMarkdown, serializeMarkdown } from '../lib/markdown'
import {
  generateId,
  generateIdFromPath,
  saveDraft,
  loadDraft,
  clearDraft,
  saveConversations,
  loadConversations,
  deleteConversations,
  saveAnnotations,
  loadAnnotations,
  deleteAnnotations
} from '../lib/persistence'
import type { DraftState } from '../lib/persistence'

export function useTabs() {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const addTab = useTabStore((state) => state.addTab)
  const removeTab = useTabStore((state) => state.removeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const updateTab = useTabStore((state) => state.updateTab)
  const getActiveTab = useTabStore((state) => state.getActiveTab)
  const getTabByPath = useTabStore((state) => state.getTabByPath)
  const getTabById = useTabStore((state) => state.getTabById)

  const document = useEditorStore((state) => state.document)
  const setDocument = useEditorStore((state) => state.setDocument)
  const setEditing = useEditorStore((state) => state.setEditing)
  const cursorPosition = useEditorStore((state) => state.cursorPosition)
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition)
  const setActiveChatId = useEditorStore((state) => state.setActiveChatId)
  const setDirty = useEditorStore((state) => state.setDirty)

  const loadChatForDocument = useChatStore((state) => state.loadForDocument)
  const saveCurrentConversation = useChatStore((state) => state.saveCurrentConversation)
  const activeConversationId = useChatStore((state) => state.activeConversationId)

  /**
   * Save the current tab's state (content, cursor, chat) to tabStore cache
   */
  const saveCurrentTabState = useCallback(async () => {
    const activeTab = getActiveTab()
    if (!activeTab) return

    // Save conversations for current document
    await saveCurrentConversation(document.documentId)

    // Update tab with current state
    updateTab(activeTab.id, {
      content: document.content,
      cursorPosition,
      isDirty: document.isDirty
    })
  }, [getActiveTab, saveCurrentConversation, document, cursorPosition, updateTab])

  /**
   * Switch to a different tab
   */
  const switchToTab = useCallback(async (tabId: string) => {
    const targetTab = getTabById(tabId)
    if (!targetTab || tabId === activeTabId) return

    // Save current tab state first
    await saveCurrentTabState()

    // Activate the new tab
    setActiveTab(tabId)

    // Load target tab's document into editorStore
    const newDocumentId = targetTab.documentId
    setDocument({
      documentId: newDocumentId,
      path: targetTab.path,
      content: targetTab.content ?? '',
      frontmatter: {},
      isDirty: targetTab.isDirty
    })

    if (targetTab.cursorPosition) {
      setCursorPosition(targetTab.cursorPosition.line, targetTab.cursorPosition.column)
    }

    // Load conversations for the target document
    await loadChatForDocument(newDocumentId)
    setCurrentDocumentId(newDocumentId)

    // Load annotations for the target document
    await useAnnotationStore.getState().loadAnnotations(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    setEditing(true)

    // Update file list selection if file has path
    if (targetTab.path) {
      useFileListStore.getState().revealAndSelectPath(targetTab.path)
    }
  }, [activeTabId, getTabById, saveCurrentTabState, setActiveTab, setDocument, setCursorPosition, loadChatForDocument, setEditing])

  /**
   * Create a new untitled tab
   */
  const createNewTab = useCallback(async () => {
    // Save current tab state first
    await saveCurrentTabState()

    const newDocumentId = generateId()
    const title = generateUntitledTitle()

    const tabId = addTab({
      documentId: newDocumentId,
      path: null,
      title,
      isDirty: false,
      content: '',
      cursorPosition: { line: 1, column: 1 }
    })

    // Set up new document in editorStore
    setDocument({
      documentId: newDocumentId,
      path: null,
      content: '',
      frontmatter: {},
      isDirty: false
    })

    setCursorPosition(1, 1)
    setCurrentDocumentId(newDocumentId)

    // Clear chat state for new document
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      messages: [],
      context: null
    })

    // Clear annotations
    useAnnotationStore.getState().clearAnnotations()

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    setEditing(true)

    return tabId
  }, [saveCurrentTabState, addTab, setDocument, setCursorPosition, setEditing])

  /**
   * Open a file in a new tab (or switch to existing if already open)
   */
  const openFileInTab = useCallback(async (filePath: string): Promise<boolean> => {
    // Check if file is already open
    const existingTab = getTabByPath(filePath)
    if (existingTab) {
      await switchToTab(existingTab.id)
      return true
    }

    // Save current tab state first
    await saveCurrentTabState()

    // Read file content
    if (!window.api) return false
    const content = await window.api.readFile(filePath)
    const parsed = parseMarkdown(content)

    // Generate document ID from path for persistent chat history
    const newDocumentId = await generateIdFromPath(filePath)

    // Extract title from path
    const fullFileName = filePath.split('/').pop() || 'Untitled'
    const hasExtension = fullFileName.includes('.')
    const title = hasExtension
      ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
      : fullFileName

    // Create new tab
    const tabId = addTab({
      documentId: newDocumentId,
      path: filePath,
      title,
      isDirty: false,
      content: parsed.content,
      cursorPosition: { line: 1, column: 1 }
    })

    // Set up document in editorStore
    setDocument({
      documentId: newDocumentId,
      path: filePath,
      content: parsed.content,
      frontmatter: parsed.frontmatter,
      isDirty: false
    })

    setCursorPosition(1, 1)
    setCurrentDocumentId(newDocumentId)

    // Load conversations for the document
    await loadChatForDocument(newDocumentId)

    // Load annotations for the document
    await useAnnotationStore.getState().loadAnnotations(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    setEditing(true)

    // Add to recent files
    useSettingsStore.getState().addRecentFile(filePath)

    // Highlight file in sidebar
    useFileListStore.getState().revealAndSelectPath(filePath)

    // Return true if document has content but no chat history (for auto-prompt)
    const conversations = useChatStore.getState().conversations
    return parsed.content.trim().length > 0 && conversations.length === 0

  }, [getTabByPath, switchToTab, saveCurrentTabState, addTab, setDocument, setCursorPosition, loadChatForDocument, setEditing])

  /**
   * Close a tab with confirmation if dirty
   * Returns false if close was cancelled
   */
  const closeTab = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = getTabById(tabId)
    if (!tab) return true

    // If dirty, ask for confirmation (handled by caller)
    if (tab.isDirty) {
      return false // Signal that tab needs save confirmation
    }

    // If closing the active tab, we need special handling
    const wasActive = tabId === activeTabId

    // Remove the tab
    removeTab(tabId)

    // If this was an unsaved document, clean up its persisted data
    if (!tab.path) {
      await deleteConversations(tab.documentId)
      await deleteAnnotations(tab.documentId)
    }

    // If we closed the last tab, create a new one
    const currentTabs = useTabStore.getState().tabs
    if (currentTabs.length === 0) {
      await createNewTab()
    } else if (wasActive) {
      // Switch to the newly active tab (set by removeTab)
      const newActiveTabId = useTabStore.getState().activeTabId
      if (newActiveTabId) {
        await switchToTab(newActiveTabId)
      }
    }

    return true
  }, [getTabById, activeTabId, removeTab, createNewTab, switchToTab])

  /**
   * Force close a tab (after save or discard confirmation)
   */
  const forceCloseTab = useCallback(async (tabId: string) => {
    const tab = getTabById(tabId)
    if (!tab) return

    const wasActive = tabId === activeTabId

    // Remove the tab
    removeTab(tabId)

    // If this was an unsaved document, clean up its persisted data
    if (!tab.path) {
      await deleteConversations(tab.documentId)
      await deleteAnnotations(tab.documentId)
    }

    // If we closed the last tab, create a new one
    const currentTabs = useTabStore.getState().tabs
    if (currentTabs.length === 0) {
      await createNewTab()
    } else if (wasActive) {
      // Switch to the newly active tab
      const newActiveTabId = useTabStore.getState().activeTabId
      if (newActiveTabId) {
        await switchToTab(newActiveTabId)
      }
    }
  }, [getTabById, activeTabId, removeTab, createNewTab, switchToTab])

  /**
   * Close all tabs except one
   */
  const closeOtherTabs = useCallback(async (keepTabId: string) => {
    const tabsToClose = tabs.filter(t => t.id !== keepTabId && !t.isDirty)

    // Close all non-dirty tabs
    for (const tab of tabsToClose) {
      if (!tab.path) {
        await deleteConversations(tab.documentId)
        await deleteAnnotations(tab.documentId)
      }
    }

    useTabStore.getState().closeOtherTabs(keepTabId)

    // Make sure we're on the kept tab
    if (activeTabId !== keepTabId) {
      await switchToTab(keepTabId)
    }
  }, [tabs, activeTabId, switchToTab])

  /**
   * Close all tabs
   */
  const closeAllTabs = useCallback(async () => {
    // Close all non-dirty tabs
    for (const tab of tabs) {
      if (!tab.isDirty && !tab.path) {
        await deleteConversations(tab.documentId)
        await deleteAnnotations(tab.documentId)
      }
    }

    useTabStore.getState().closeAllTabs()

    // Create a new blank tab
    await createNewTab()
  }, [tabs, createNewTab])

  /**
   * Update the active tab when editor content changes
   */
  const syncActiveTabWithEditor = useCallback(() => {
    const activeTab = getActiveTab()
    if (!activeTab) return

    // Only update if values actually changed
    if (
      activeTab.isDirty !== document.isDirty ||
      activeTab.path !== document.path ||
      activeTab.content !== document.content
    ) {
      const title = document.path
        ? (() => {
            const fullFileName = document.path.split('/').pop() || 'Untitled'
            const hasExtension = fullFileName.includes('.')
            return hasExtension
              ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
              : fullFileName
          })()
        : activeTab.title

      updateTab(activeTab.id, {
        isDirty: document.isDirty,
        path: document.path,
        title,
        content: document.content
      })
    }
  }, [getActiveTab, document, updateTab])

  // Sync tab state when editor document changes
  useEffect(() => {
    syncActiveTabWithEditor()
  }, [document.isDirty, document.path, document.content, syncActiveTabWithEditor])

  /**
   * Rename a tab's file
   * Returns the new path on success, or null on failure
   */
  const renameTab = useCallback(async (tabId: string, newTitle: string): Promise<string | null> => {
    const tab = getTabById(tabId)
    if (!tab || !tab.path) return null

    // Sanitize filename - block invalid/dangerous characters (Windows-safe, blocks path traversal)
    const sanitized = newTitle.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    if (!sanitized) return null

    // Build new path
    const dir = tab.path.substring(0, tab.path.lastIndexOf('/'))
    const oldExt = tab.path.match(/\.(md|markdown|txt)$/)?.[0] || '.md'
    const newName = `${sanitized}${oldExt}`
    const newPath = `${dir}/${newName}`

    // If same path, no-op
    if (newPath === tab.path) return tab.path

    try {
      if (!window.api) return null

      // Check if target already exists
      const exists = await window.api.fileExists(newPath)
      if (exists) {
        console.warn(`Cannot rename: file "${newName}" already exists`)
        return null
      }

      // Rename the file
      await window.api.renameFile(tab.path, newPath)

      // Update tab
      updateTab(tabId, {
        path: newPath,
        title: sanitized
      })

      // Update editor store if this is the active document
      if (document.path === tab.path) {
        useEditorStore.getState().setDocument({
          ...document,
          path: newPath
        })
      }

      // Refresh file list
      await useFileListStore.getState().loadFiles()
      useFileListStore.getState().selectFile(newPath)

      return newPath
    } catch (error) {
      console.error('Error renaming tab file:', error)
      return null
    }
  }, [getTabById, updateTab, document])

  return {
    tabs,
    activeTabId,
    createNewTab,
    openFileInTab,
    switchToTab,
    closeTab,
    forceCloseTab,
    closeOtherTabs,
    closeAllTabs,
    saveCurrentTabState,
    renameTab,
    getActiveTab: useTabStore.getState().getActiveTab
  }
}
