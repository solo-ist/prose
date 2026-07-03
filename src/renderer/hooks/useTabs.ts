import { useCallback, useEffect } from 'react'
import { useTabStore, createTab, generateUntitledTitle, type Tab, type ClosedTabSnapshot } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { useAnnotationStore } from '../extensions/ai-annotations'
import { useSuggestionStore } from '../extensions/ai-suggestions/store'
import { getAISuggestions } from '../extensions/ai-suggestions'
import { useCommentStore } from '../extensions/comments/store'
import { mergeCommentsForPersistence } from '../extensions/comments'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'
import { parseMarkdown, serializeMarkdown, prepareTextContent } from '../lib/markdown'
import { pipelineLog } from '../lib/aiPipelineLog'
import { handleMissingPath, isMissingPathFileError } from '../lib/stalePath'
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
  saveSuggestions,
  loadSuggestions,
  deleteSuggestions,
  saveComments,
  loadComments,
  deleteComments,
  SESSION_ID
} from '../lib/persistence'
import type { DraftState } from '../lib/persistence'

// Track chat panel state before preview mode so we can restore on promote
let chatPanelStateBeforePreview: boolean | null = null


function restoreAfterPreviewBrowsing(): void {
  useEditorStore.getState().setPreviewTab(false)
  if (chatPanelStateBeforePreview !== null) {
    useChatStore.getState().setPanelOpen(chatPanelStateBeforePreview)
    chatPanelStateBeforePreview = null
  }
}

/**
 * Promote the current preview tab to permanent and restore UI state.
 * Can be called from outside the hook (e.g., Editor mousedown handler).
 */
export function promoteCurrentPreview(): void {
  const previewTab = useTabStore.getState().getPreviewTab()
  if (previewTab) {
    useTabStore.getState().promotePreviewTab(previewTab.id)
  }
  restoreAfterPreviewBrowsing()
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
  const pushClosedTab = useTabStore((state) => state.pushClosedTab)
  const popClosedTab = useTabStore((state) => state.popClosedTab)
  const reopenLastClosedTabStore = useTabStore((state) => state.reopenLastClosedTab)

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

    // Save annotations for current document. Await any in-flight write from
    // addAnnotation first (#674) — a just-created annotation's fire-and-forget
    // save racing the tab switch was a "history entries vanished" path.
    const pendingSave = useAnnotationStore.getState().pendingSave
    if (pendingSave) await pendingSave
    await useAnnotationStore.getState().saveAnnotations()

    // Save AI suggestions and comment marks for current document
    const editor = useEditorInstanceStore.getState().editor
    if (editor) {
      const docId = activeTab.documentId

      const suggestions = getAISuggestions(editor)
      console.log(`[useTabs:${SESSION_ID}] Saving suggestions:`, { documentId: docId, count: suggestions.length })
      // Never overwrite the stored set with an empty one: an empty editor here is
      // almost always a transient strip (a tab switch landing inside a document
      // load or source-mode toggle), not a real "user cleared all" — persisting
      // it would wipe the suggestions. Mirrors the Editor debounced save and the
      // rename path's `length > 0 ? save : skip`. Genuine empties clear on tab
      // close (deleteSuggestions).
      if (docId && suggestions.length > 0) {
        await useSuggestionStore.getState().saveSuggestions(docId, suggestions)
      }

      // Merge live mark positions with the store's rich data (replies + resolved)
      // so a tab-switch save doesn't clobber threads with marks-only data (#699).
      const comments = mergeCommentsForPersistence(editor, useCommentStore.getState().pendingComments)
      console.log(`[useTabs:${SESSION_ID}] Saving comments:`, { documentId: docId, count: comments.length })
      if (docId) {
        await useCommentStore.getState().saveComments(docId, comments)
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

    pipelineLog('tab:switch', {
      toTabId: tabId,
      toDocId: targetTab.documentId,
      fromDocId: useAnnotationStore.getState().documentId,
      annotationCountBefore: useAnnotationStore.getState().annotations.length,
    })

    // Pause annotation position updates during document loading
    // This prevents the plugin from deleting annotations when doc content changes
    useAnnotationStore.getState().setLoadingDocument(true)

    // Pre-set the annotation store's documentId BEFORE setDocument (#674):
    // Editor.tsx's recovery effect fires its own (unguarded) loadAnnotations
    // whenever annotationStoreDocumentId !== document.documentId — pre-
    // setting makes the effect see a match immediately, killing the
    // double-load race with the awaited loadAnnotations below.
    useAnnotationStore.getState().setDocumentId(targetTab.documentId)

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

    // Load comment marks for the target document
    console.log(`[useTabs:${SESSION_ID}] loading comments for:`, newDocumentId)
    await useCommentStore.getState().loadComments(newDocumentId)
    console.log(`[useTabs:${SESSION_ID}] comments loaded:`, useCommentStore.getState().pendingComments.length)

    // Sync the global preview-read-only flag to the tab we're switching to.
    // Without this, isPreviewTab stays stuck on the previously-active tab's
    // value — leaving a permanent tab wrongly read-only (you can't type) after
    // browsing a single-click preview. (QA — editor stuck read-only)
    useEditorStore.getState().setPreviewTab(targetTab.isPreview ?? false)

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
   * Create a new untitled tab.
   *
   * Pass `init.content` (and optionally `init.frontmatter`, `init.isDirty`) to
   * pre-populate the new tab. The content is baked into both the tabStore and
   * editorStore *before* the editor mounts, so the new <Editor> reads the
   * content from its initial state — no setContent-after-mount race.
   *
   * Used by callers that want to drop content into a fresh tab in one step
   * (e.g., the prose:// URL handler, the Google Docs import fallback). For an
   * empty tab, call createNewTab() with no arguments.
   */
  const createNewTab = useCallback(async (init?: {
    content?: string
    frontmatter?: Record<string, unknown>
    isDirty?: boolean
  }) => {
    const initialContent = init?.content ?? ''
    const initialFrontmatter = init?.frontmatter ?? {}
    const initialIsDirty = init?.isDirty ?? false

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
      isDirty: initialIsDirty,
      content: initialContent,
      frontmatter: initialFrontmatter,
      cursorPosition: { line: 1, column: 1 }
    })

    // Pre-set the annotation store's documentId before setDocument so the
    // Editor.tsx recovery effect doesn't fire a competing load (#674).
    useAnnotationStore.getState().setDocumentId(newDocumentId)

    // Set up new document in editorStore
    setDocument({
      documentId: newDocumentId,
      path: null,
      content: initialContent,
      frontmatter: initialFrontmatter,
      isDirty: initialIsDirty
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

    // Clear comment marks
    useCommentStore.getState().setDocumentId(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // A brand-new tab is always a permanent, editable doc. Reset the global
    // preview flag so a new tab opened while a preview was active isn't stuck
    // read-only. (QA — editor stuck read-only)
    useEditorStore.getState().setPreviewTab(false)

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
      if (existingTab.isPreview || useEditorStore.getState().isPreviewTab) {
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
    if (!window.api) {
      useAnnotationStore.getState().setLoadingDocument(false)
      return false
    }
    let rawContent: string
    try {
      rawContent = await window.api.readFile(filePath)
    } catch (error) {
      useAnnotationStore.getState().setLoadingDocument(false)
      if (isMissingPathFileError(error)) {
        handleMissingPath(filePath, 'open')
      }
      console.error('[useTabs] Failed to open file:', error)
      return false
    }
    const isTxt = filePath.endsWith('.txt')
    const parsed = parseMarkdown(isTxt ? prepareTextContent(rawContent) : rawContent)

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

    // Pre-set the annotation store's documentId before setDocument so the
    // Editor.tsx recovery effect doesn't fire a competing load (#674).
    useAnnotationStore.getState().setDocumentId(newDocumentId)

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

    // Load comment marks for the document
    await useCommentStore.getState().loadComments(newDocumentId)

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
    useEditorStore.getState().setPreviewTab(true)

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
      restoreAfterPreviewBrowsing()
      return false
    }
    let rawContent: string
    try {
      rawContent = await window.api.readFile(filePath)
    } catch (error) {
      restoreAfterPreviewBrowsing()
      useAnnotationStore.getState().setLoadingDocument(false)
      if (isMissingPathFileError(error)) {
        handleMissingPath(filePath, 'open')
      }
      console.error('[useTabs] Failed to preview file:', error)
      return false
    }
    const isTxt = filePath.endsWith('.txt')
    const parsed = parseMarkdown(isTxt ? prepareTextContent(rawContent) : rawContent)
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

      // Pre-set the annotation store's documentId before setDocument so the
      // Editor.tsx recovery effect doesn't fire a competing load (#674).
      useAnnotationStore.getState().setDocumentId(newDocumentId)

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
      await useCommentStore.getState().loadComments(newDocumentId)
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

    // Pre-set the annotation store's documentId before setDocument so the
    // Editor.tsx recovery effect doesn't fire a competing load (#674).
    useAnnotationStore.getState().setDocumentId(newDocumentId)

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
    await useCommentStore.getState().loadComments(newDocumentId)
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

    // Snapshot non-preview tabs onto the closed-tab stack before removing
    if (!tab.isPreview) {
      const snapshot: ClosedTabSnapshot = {
        path: tab.path,
        title: tab.title,
        baseTitle: tab.baseTitle,
        isDirty: tab.isDirty,
        content: tab.content,
        frontmatter: tab.frontmatter,
        cursorPosition: tab.cursorPosition
      }
      pushClosedTab(snapshot)
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
      await deleteComments(tab.documentId)
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
  }, [getTabById, activeTabId, removeTab, createNewTab, switchToTab, pushClosedTab])

  /**
   * Force close a tab (after save or discard confirmation)
   */
  const forceCloseTab = useCallback(async (tabId: string) => {
    const tab = getTabById(tabId)
    if (!tab) return

    const wasActive = tabId === activeTabId

    // Snapshot non-preview tabs onto the closed-tab stack before removing
    if (!tab.isPreview) {
      const snapshot: ClosedTabSnapshot = {
        path: tab.path,
        title: tab.title,
        baseTitle: tab.baseTitle,
        isDirty: tab.isDirty,
        content: tab.content,
        frontmatter: tab.frontmatter,
        cursorPosition: tab.cursorPosition
      }
      pushClosedTab(snapshot)
    }

    // Remove the tab
    removeTab(tabId)

    // If this was an unsaved document, clean up its persisted data
    if (!tab.path) {
      await deleteConversations(tab.documentId)
      await deleteAnnotations(tab.documentId)
      await deleteSuggestions(tab.documentId)
      await deleteComments(tab.documentId)
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
  }, [getTabById, activeTabId, removeTab, createNewTab, switchToTab, pushClosedTab])

  /**
   * Close all tabs except one
   */
  const closeOtherTabs = useCallback(async (keepTabId: string) => {
    // All tabs being removed by the store action (dirty included — store removes ALL others)
    const allTabsToRemove = tabs.filter(t => t.id !== keepTabId)
    // Subset used only for IndexedDB cleanup of untitled docs
    const tabsToCleanUp = allTabsToRemove.filter(t => !t.isDirty)

    // Snapshot every non-preview tab that will be removed (oldest→newest so
    // the last push — newest tab — lands on top of the stack after prepending)
    for (const tab of allTabsToRemove) {
      if (!tab.isPreview) {
        pushClosedTab({
          path: tab.path,
          title: tab.title,
          baseTitle: tab.baseTitle,
          isDirty: tab.isDirty,
          content: tab.content,
          frontmatter: tab.frontmatter,
          cursorPosition: tab.cursorPosition
        })
      }
    }

    // Clean up IndexedDB data only for non-dirty untitled tabs
    for (const tab of tabsToCleanUp) {
      if (!tab.path) {
        await deleteConversations(tab.documentId)
        await deleteAnnotations(tab.documentId)
        await deleteSuggestions(tab.documentId)
        await deleteComments(tab.documentId)
      }
    }

    useTabStore.getState().closeOtherTabs(keepTabId)

    // Make sure we're on the kept tab
    if (activeTabId !== keepTabId) {
      await switchToTab(keepTabId)
    }
  }, [tabs, activeTabId, switchToTab, pushClosedTab])

  /**
   * Close all tabs
   */
  const closeAllTabs = useCallback(async () => {
    // Snapshot every non-preview tab (dirty included — store removes ALL tabs).
    // Push oldest→newest: pushClosedTab prepends, so the last push (newest tab)
    // lands on top of the stack. When >10 tabs are closed, slice(0, CLOSED_TABS_MAX)
    // drops the tail (oldest), keeping the most-recently-open 10 reopenable.
    for (const tab of tabs) {
      if (!tab.isPreview) {
        pushClosedTab({
          path: tab.path,
          title: tab.title,
          baseTitle: tab.baseTitle,
          isDirty: tab.isDirty,
          content: tab.content,
          frontmatter: tab.frontmatter,
          cursorPosition: tab.cursorPosition
        })
      }
    }

    // Clean up IndexedDB data only for non-dirty untitled tabs
    for (const tab of tabs) {
      if (!tab.isDirty && !tab.path) {
        await deleteConversations(tab.documentId)
        await deleteAnnotations(tab.documentId)
        await deleteSuggestions(tab.documentId)
        await deleteComments(tab.documentId)
      }
    }

    useTabStore.getState().closeAllTabs()

    // Create a new blank tab
    await createNewTab()
  }, [tabs, createNewTab, pushClosedTab])

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

      // Migrate path-derived persistence (#674): documentId is
      // SHA-256(path) for saved files, so a rename changes the identity the
      // NEXT fresh open computes. Copy annotations/conversations/suggestions/
      // comments to the new key so they don't orphan. The old keys are left
      // in place (harmless; a future cleanup sweep can collect them).
      const oldDocumentId = await generateIdFromPath(tab.path)
      const newDocumentId = await generateIdFromPath(newPath)
      pipelineLog('tab:rename', {
        oldPath: tab.path,
        newPath,
        oldDocId: oldDocumentId,
        newDocId: newDocumentId,
      })
      if (oldDocumentId !== newDocumentId) {
        const [annotations, conversations, suggestions, comments] = await Promise.all([
          loadAnnotations(oldDocumentId),
          loadConversations(oldDocumentId),
          loadSuggestions(oldDocumentId),
          loadComments(oldDocumentId),
        ])
        await Promise.all([
          annotations.length > 0
            ? saveAnnotations(newDocumentId, annotations.map((a) => ({ ...a, documentId: newDocumentId })))
            : Promise.resolve(),
          conversations.length > 0 ? saveConversations(newDocumentId, conversations) : Promise.resolve(),
          suggestions.length > 0 ? saveSuggestions(newDocumentId, suggestions) : Promise.resolve(),
          comments.length > 0 ? saveComments(newDocumentId, comments) : Promise.resolve(),
        ])
        pipelineLog('tab:rename:migrated', {
          newDocId: newDocumentId,
          annotations: annotations.length,
          conversations: conversations.length,
          suggestions: suggestions.length,
          comments: comments.length,
        })
      }

      // Update tab (including its documentId — the old path-derived id no
      // longer matches what a fresh open of newPath would compute)
      updateTab(tabId, {
        path: newPath,
        title: sanitized,
        documentId: newDocumentId
      })

      // Update editor store + annotation store if this is the active document
      if (document.path === tab.path) {
        useAnnotationStore.getState().setDocumentId(newDocumentId)
        useEditorStore.getState().setDocument({
          ...document,
          path: newPath,
          documentId: newDocumentId
        })
        setCurrentDocumentId(newDocumentId)
        // Re-point in-memory annotations at the new identity so the next
        // saveAnnotations writes to the migrated key
        useAnnotationStore.setState((s) => ({
          annotations: s.annotations.map((a) => ({ ...a, documentId: newDocumentId })),
        }))
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

  /**
   * Reopen the most recently closed tab, restoring its content (including unsaved edits).
   * No-op if the closed-tab stack is empty.
   *
   * Race safety: the snapshot is popped atomically first; the async documentId
   * derivation happens after the pop, so rapid double-presses each consume a
   * distinct snapshot rather than both racing on the same top entry.
   *
   * Duplicate guard: if the snapshot's path is already open in a live tab, we
   * pop the snapshot, switch to the existing tab, and do not create a duplicate.
   */
  const reopenLastClosedTab = useCallback(async () => {
    // Atomically pop the top snapshot — no await before this point.
    const snapshot = popClosedTab()
    if (!snapshot) return

    // If a tab for this path is already open, just switch to it.
    if (snapshot.path) {
      const existing = getTabByPath(snapshot.path)
      if (existing) {
        await switchToTab(existing.id)
        return
      }
    }

    // Derive documentId after the pop (no TOCTOU risk — snapshot already claimed).
    let documentId: string
    if (snapshot.path) {
      documentId = await generateIdFromPath(snapshot.path)
    } else {
      documentId = generateId()
    }

    // Save current tab state before switching
    await saveCurrentTabState()

    // Pause annotation position updates during document loading
    useAnnotationStore.getState().setLoadingDocument(true)

    // Create the new tab in the store (store sets activeTabId internally)
    reopenLastClosedTabStore(snapshot, documentId)

    // Pre-set the annotation store's documentId before setDocument so the
    // Editor.tsx recovery effect doesn't fire a competing load (#674).
    useAnnotationStore.getState().setDocumentId(documentId)

    // Load the restored content into editorStore
    setDocument({
      documentId,
      path: snapshot.path,
      content: snapshot.content ?? '',
      frontmatter: snapshot.frontmatter ?? {},
      isDirty: snapshot.isDirty
    })

    if (snapshot.cursorPosition) {
      setCursorPosition(snapshot.cursorPosition.line, snapshot.cursorPosition.column)
    }

    setCurrentDocumentId(documentId)

    // Load persisted chat/annotations/suggestions for this document
    await loadChatForDocument(documentId)
    await useAnnotationStore.getState().loadAnnotations(documentId)
    await useSuggestionStore.getState().loadSuggestions(documentId)
    await useCommentStore.getState().loadComments(documentId)

    setEditing(true)

    if (snapshot.path) {
      useFileListStore.getState().revealAndSelectPath(snapshot.path)
    }

    // Mirrors the same delay used in switchToTab/openFileInTab: gives the editor
    // time to fully mount the restored content before re-enabling annotation
    // position mapping (prevents the plugin from dropping marks on the new doc).
    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)
  }, [popClosedTab, getTabByPath, switchToTab, saveCurrentTabState, reopenLastClosedTabStore, setDocument, setCursorPosition, loadChatForDocument, setEditing])

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
    reopenLastClosedTab,
    getActiveTab: useTabStore.getState().getActiveTab
  }
}
