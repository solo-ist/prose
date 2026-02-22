import { useCallback, useEffect } from 'react'
import { useTabStore, createTab, generateUntitledTitle, type Tab } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { useAnnotationStore } from '../extensions/ai-annotations'
import { useSuggestionStore } from '../extensions/ai-suggestions/store'
import { getAISuggestions } from '../extensions/ai-suggestions'
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
  deleteAnnotations,
  deleteSuggestions,
  SESSION_ID
} from '../lib/persistence'
import type { DraftState } from '../lib/persistence'

// Track chat panel state before preview mode so we can restore on promote
let chatPanelStateBeforePreview: boolean | null = null

/**
 * Promote the current preview tab to permanent and restore UI state.
 * Can be called from outside the hook (e.g., Editor mousedown handler).
 */
export function promoteCurrentPreview(): void {
  const previewTab = useTabStore.getState().getPreviewTab()
  if (previewTab) {
    useTabStore.getState().promotePreviewTab(previewTab.id)
  }
  useEditorStore.getState().setPreviewReadOnly(false)
  if (chatPanelStateBeforePreview !== null) {
    useChatStore.getState().setPanelOpen(chatPanelStateBeforePreview)
    chatPanelStateBeforePreview = null
  }
}

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

    console.log('[useTabs] saveCurrentTabState:', {
      tabId: activeTab.id,
      tabDocumentId: activeTab.documentId,
      editorDocumentId: document.documentId,
      annotationStoreDocId: useAnnotationStore.getState().documentId,
      annotationCount: useAnnotationStore.getState().annotations.length
    })

    // Save conversations for current document
    await saveCurrentConversation(document.documentId)

    // Save annotations for current document
    await useAnnotationStore.getState().saveAnnotations()

    // Save AI suggestions for current document
    const editor = useEditorInstanceStore.getState().editor
    if (editor) {
      const suggestions = getAISuggestions(editor)
      const docId = activeTab.documentId
      console.log(`[useTabs:${SESSION_ID}] Saving suggestions:`, { documentId: docId, count: suggestions.length })
      if (docId) {
        await useSuggestionStore.getState().saveSuggestions(docId, suggestions)
      }
    }

    // Update tab with current state
    updateTab(activeTab.id, {
      content: document.content,
      frontmatter: document.frontmatter,
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

    console.log('[useTabs] switchToTab:', {
      fromTabId: activeTabId,
      toTabId: tabId,
      targetDocumentId: targetTab.documentId,
      targetPath: targetTab.path
    })

    // Save current tab state first
    await saveCurrentTabState()

    // Pause annotation position updates during document loading
    // This prevents the plugin from deleting annotations when doc content changes
    useAnnotationStore.getState().setLoadingDocument(true)

    // Activate the new tab
    setActiveTab(tabId)

    // Load target tab's document into editorStore
    const newDocumentId = targetTab.documentId
    setDocument({
      documentId: newDocumentId,
      path: targetTab.path,
      content: targetTab.content ?? '',
      frontmatter: targetTab.frontmatter ?? {},
      isDirty: targetTab.isDirty
    })

    if (targetTab.cursorPosition) {
      setCursorPosition(targetTab.cursorPosition.line, targetTab.cursorPosition.column)
    }

    // Load conversations for the target document
    await loadChatForDocument(newDocumentId)
    setCurrentDocumentId(newDocumentId)

    // Load annotations for the target document
    console.log('[useTabs] loading annotations for:', newDocumentId)
    await useAnnotationStore.getState().loadAnnotations(newDocumentId)
    console.log('[useTabs] annotations loaded:', useAnnotationStore.getState().annotations.length)

    // Load suggestions for the target document
    console.log(`[useTabs:${SESSION_ID}] loading suggestions for:`, newDocumentId)
    await useSuggestionStore.getState().loadSuggestions(newDocumentId)
    console.log(`[useTabs:${SESSION_ID}] suggestions loaded:`, useSuggestionStore.getState().pendingSuggestions.length)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    setEditing(true)

    // Update file list selection if file has path
    if (targetTab.path) {
      useFileListStore.getState().revealAndSelectPath(targetTab.path)
    }

    // Resume annotation position updates after a small delay to let editor settle
    // This allows the new document content to fully load before enabling position mapping
    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)
  }, [activeTabId, getTabById, saveCurrentTabState, setActiveTab, setDocument, setCursorPosition, loadChatForDocument, setEditing])

  /**
   * Create a new untitled tab
   */
  const createNewTab = useCallback(async () => {
    // Save current tab state first
    await saveCurrentTabState()

    // Pause annotation position updates during document loading
    useAnnotationStore.getState().setLoadingDocument(true)

    const newDocumentId = generateId()
    const title = generateUntitledTitle()

    const tabId = addTab({
      documentId: newDocumentId,
      path: null,
      title,
      baseTitle: title,
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

    // Clear suggestions
    useSuggestionStore.getState().setDocumentId(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    setEditing(true)

    // Resume annotation position updates
    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)

    return tabId
  }, [saveCurrentTabState, addTab, setDocument, setCursorPosition, setEditing])

  /**
   * Helper function to check if a tab is empty and untitled
   * Returns true if the tab has no path and no meaningful content
   */
  const isEmptyUntitled = useCallback((tab: Tab | null): boolean => {
    if (!tab) return false

    // Must be untitled (no path)
    if (tab.path !== null) return false

    // Check if content is empty or whitespace-only
    const content = tab.content ?? ''
    const trimmed = content.trim()

    // Empty or whitespace-only content
    if (trimmed === '') return true

    // TipTap may store empty content as empty HTML tags like <p></p>
    // Strip HTML tags and check again
    const withoutTags = trimmed.replace(/<[^>]*>/g, '').trim()
    return withoutTags === ''
  }, [])

  /**
   * Open a file in a new tab (or switch to existing if already open)
   * If the current tab is empty and untitled, replace it instead
   */
  const openFileInTab = useCallback(async (filePath: string): Promise<boolean> => {
    // Check if file is already open
    const existingTab = getTabByPath(filePath)
    if (existingTab) {
      // Promote preview tab to permanent, or clear preview browsing mode
      if (existingTab.isPreview || useEditorStore.getState().isPreviewReadOnly) {
        promoteCurrentPreview()
      }
      await switchToTab(existingTab.id)
      return true
    }

    // Check if current tab is empty and untitled
    const currentTab = getActiveTab()
    const shouldReplaceCurrentTab = isEmptyUntitled(currentTab)

    // Save current tab state first (unless we're replacing it)
    if (!shouldReplaceCurrentTab) {
      await saveCurrentTabState()
    }

    // Pause annotation position updates during document loading
    useAnnotationStore.getState().setLoadingDocument(true)

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

    let tabId: string

    if (shouldReplaceCurrentTab && currentTab) {
      // Replace the current empty untitled tab
      updateTab(currentTab.id, {
        documentId: newDocumentId,
        path: filePath,
        title,
        isDirty: false,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        cursorPosition: { line: 1, column: 1 }
      })
      tabId = currentTab.id
    } else {
      // Create new tab
      tabId = addTab({
        documentId: newDocumentId,
        path: filePath,
        title,
        isDirty: false,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        cursorPosition: { line: 1, column: 1 }
      })
    }

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

    // Load suggestions for the document
    await useSuggestionStore.getState().loadSuggestions(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    setEditing(true)

    // Add to recent files
    useSettingsStore.getState().addRecentFile(filePath)

    // Highlight file in sidebar
    useFileListStore.getState().revealAndSelectPath(filePath)

    // Resume annotation position updates after a small delay
    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)

    // Return true if document has content but no chat history (for auto-prompt)
    const conversations = useChatStore.getState().conversations
    return parsed.content.trim().length > 0 && conversations.length === 0

  }, [getTabByPath, switchToTab, saveCurrentTabState, addTab, setDocument, setCursorPosition, loadChatForDocument, setEditing])

  /**
   * Open a file in a preview tab (transient, replaced on next preview)
   * - If file already open in a permanent tab, switch to it
   * - If file is already the current preview tab, no-op
   * - If a different preview tab exists, replace it
   * - Otherwise create a new preview tab
   */
  const openFileInPreviewTab = useCallback(async (filePath: string): Promise<boolean> => {
    // Set editor to non-editable so ProseMirror can't steal focus
    useEditorStore.getState().setPreviewReadOnly(true)

    // Close chat panel during preview (save state so we can restore on promote)
    if (chatPanelStateBeforePreview === null) {
      chatPanelStateBeforePreview = useChatStore.getState().isPanelOpen
    }
    useChatStore.getState().setPanelOpen(false)

    // Check if file is already open in a permanent tab
    const existingTab = getTabByPath(filePath)
    if (existingTab && !existingTab.isPreview) {
      // Keep preview read-only — user is just browsing via single-click/arrow keys
      await switchToTab(existingTab.id)
      return true
    }

    // Check if file is already the current preview tab
    const previewTab = useTabStore.getState().getPreviewTab()
    if (previewTab && previewTab.path === filePath) {
      // Already previewing this file — just ensure it's active
      if (previewTab.id !== activeTabId) {
        await switchToTab(previewTab.id)
      }
      return true
    }

    // Read file content
    if (!window.api) {
      useEditorStore.getState().setPreviewReadOnly(false)
      return false
    }
    const content = await window.api.readFile(filePath)
    const parsed = parseMarkdown(content)
    const newDocumentId = await generateIdFromPath(filePath)

    const fullFileName = filePath.split('/').pop() || 'Untitled'
    const hasExtension = fullFileName.includes('.')
    const title = hasExtension
      ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
      : fullFileName

    if (previewTab) {
      // Replace existing preview tab's content
      await saveCurrentTabState()

      // Pause annotation position updates
      useAnnotationStore.getState().setLoadingDocument(true)

      updateTab(previewTab.id, {
        documentId: newDocumentId,
        path: filePath,
        title,
        isDirty: false,
        isPreview: true,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        cursorPosition: { line: 1, column: 1 }
      })

      setActiveTab(previewTab.id)

      // Load document into editor
      setDocument({
        documentId: newDocumentId,
        path: filePath,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        isDirty: false
      })

      setCursorPosition(1, 1)
      setCurrentDocumentId(newDocumentId)

      await loadChatForDocument(newDocumentId)
      await useAnnotationStore.getState().loadAnnotations(newDocumentId)
      await useSuggestionStore.getState().loadSuggestions(newDocumentId)
      useEditorStore.getState().setRemarkableReadOnly(false, null)
      setEditing(true)

      useSettingsStore.getState().addRecentFile(filePath)
      useFileListStore.getState().revealAndSelectPath(filePath)

      setTimeout(() => {
        useAnnotationStore.getState().setLoadingDocument(false)
      }, 100)

      const conversations = useChatStore.getState().conversations
      return parsed.content.trim().length > 0 && conversations.length === 0
    }

    // No preview tab exists — check if current tab is empty untitled
    const currentTab = getActiveTab()
    const shouldReplace = isEmptyUntitled(currentTab)

    if (!shouldReplace) {
      await saveCurrentTabState()
    }

    useAnnotationStore.getState().setLoadingDocument(true)

    if (shouldReplace && currentTab) {
      updateTab(currentTab.id, {
        documentId: newDocumentId,
        path: filePath,
        title,
        isDirty: false,
        isPreview: true,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        cursorPosition: { line: 1, column: 1 }
      })
    } else {
      addTab({
        documentId: newDocumentId,
        path: filePath,
        title,
        isDirty: false,
        isPreview: true,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        cursorPosition: { line: 1, column: 1 }
      })
    }

    setDocument({
      documentId: newDocumentId,
      path: filePath,
      content: parsed.content,
      frontmatter: parsed.frontmatter,
      isDirty: false
    })

    setCursorPosition(1, 1)
    setCurrentDocumentId(newDocumentId)

    await loadChatForDocument(newDocumentId)
    await useAnnotationStore.getState().loadAnnotations(newDocumentId)
    await useSuggestionStore.getState().loadSuggestions(newDocumentId)
    useEditorStore.getState().setRemarkableReadOnly(false, null)
    setEditing(true)

    useSettingsStore.getState().addRecentFile(filePath)
    useFileListStore.getState().revealAndSelectPath(filePath)

    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)

    const conversations = useChatStore.getState().conversations
    return parsed.content.trim().length > 0 && conversations.length === 0
  }, [getTabByPath, switchToTab, activeTabId, saveCurrentTabState, getActiveTab, isEmptyUntitled, addTab, updateTab, setActiveTab, setDocument, setCursorPosition, loadChatForDocument, setEditing])

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
      await deleteSuggestions(tab.documentId)
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
      await deleteSuggestions(tab.documentId)
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
        await deleteSuggestions(tab.documentId)
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
        await deleteSuggestions(tab.documentId)
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

    // Auto-promote preview tab when content becomes dirty (user edited)
    if (activeTab.isPreview && document.isDirty) {
      promoteCurrentPreview()
    }

    // Only update if values actually changed
    if (
      activeTab.isDirty !== document.isDirty ||
      activeTab.path !== document.path ||
      activeTab.content !== document.content
    ) {
      let title: string
      if (document.path) {
        // Named file: derive title from filename (no extension)
        const fullFileName = document.path.split('/').pop() || 'Untitled'
        const hasExtension = fullFileName.includes('.')
        title = hasExtension
          ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
          : fullFileName
      } else {
        // Untitled document: keep existing title (user renames via double-click, which suggests H1)
        title = activeTab.title
      }

      updateTab(activeTab.id, {
        isDirty: document.isDirty,
        path: document.path,
        title,
        content: document.content,
        frontmatter: document.frontmatter
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
    openFileInPreviewTab,
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
