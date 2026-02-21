import { useEffect, useState, useCallback, useRef } from 'react'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { Editor } from '../editor/Editor'
import { ChatPanel } from '../chat/ChatPanel'
import { FileListPanel } from '../files/FileListPanel'
import { SettingsDialog } from '../settings/SettingsDialog'
import { RecoveryDialog } from './RecoveryDialog'
import { RecoveryModal } from '../RecoveryModal'
import { DefaultHandlerPrompt } from './DefaultHandlerPrompt'
import { KeyboardShortcutsDialog } from '../settings/KeyboardShortcutsDialog'
import { AboutDialog } from '../settings/AboutDialog'
import { ModelPickerDialog } from '../ModelPickerDialog'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '../ui/resizable'
import { TooltipProvider } from '../ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Checkbox } from '../ui/checkbox'
import { useChat } from '../../hooks/useChat'
import { useEditor } from '../../hooks/useEditor'
import { useTabs } from '../../hooks/useTabs'
import { useSettings } from '../../hooks/useSettings'
import { usePanelLayout, PanelLayoutProvider } from '../../hooks/usePanelLayout'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../../stores/chatStore'
import { useTabStore, createTab, restoreSession, clearSavedSession, hasUnsavedTabs } from '../../stores/tabStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useAutosave } from '../../hooks/useAutosave'
import {
  loadDraft,
  clearDraft,
  loadConversations,
  deleteConversations
} from '../../lib/persistence'
import type { DraftState, SessionState } from '../../lib/persistence'
import { executeTool } from '../../lib/tools'
import { useReviewMode, useWasChatOpenBeforeReview, usePreviousChatWidth, useReviewStore, type ReviewMode } from '../../stores/reviewStore'
import { CHAT_DEFAULT_PCT, CHAT_MIN_PX } from '../../hooks/usePanelLayout'

export function App() {
  const { describeDocument } = useChat()

  // Panel refs for imperative collapse/expand
  const fileListPanelRef = useRef<ImperativePanelHandle>(null)
  const chatPanelRef = useRef<ImperativePanelHandle>(null)

  const panelLayout = usePanelLayout({ fileListPanelRef, chatPanelRef })
  const { isChatOpen, isFileListOpen, toggleChat, toggleFileList, setChatOpen, panelSizes } = panelLayout

  const { openFile, openFileFromPath, saveFile, saveFileAs, newFile } = useEditor()
  const { createNewTab, openFileInTab, closeTab } = useTabs()
  const { setDialogOpen, isShortcutsDialogOpen, setShortcutsDialogOpen, isAboutDialogOpen, setAboutDialogOpen, isModelPickerOpen, setModelPickerOpen, settings, autosaveActive, isLoaded: settingsLoaded } = useSettings()
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<DraftState | null>(null)
  const [pendingSession, setPendingSession] = useState<SessionState | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importDocId, setImportDocId] = useState('')
  const [importAsAI, setImportAsAI] = useState(false)
  const tabsInitialized = useRef(false)

  const hydrateFromDraft = useEditorStore((state) => state.hydrateFromDraft)
  const documentPath = useEditorStore((state) => state.document.path)
  const isDirty = useEditorStore((state) => state.document.isDirty)
  const editor = useEditorInstanceStore((state) => state.editor)
  const tabs = useTabStore((state) => state.tabs)
  const addTab = useTabStore((state) => state.addTab)

  // Initialize autosave functionality
  useAutosave()

  // Review mode: auto-open sidebar, resize for mode, restore on exit
  const reviewMode = useReviewMode()
  const wasChatOpenBeforeReview = useWasChatOpenBeforeReview()
  const previousChatWidth = usePreviousChatWidth()
  const setPreviousChatWidth = useReviewStore((s) => s.setPreviousChatWidth)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const prevReviewMode = useRef<ReviewMode | null>(null)
  const prevTabId = useRef(activeTabId)

  // Quick review target: ~280px as a percentage of window width
  const quickReviewPct = (CHAT_MIN_PX / window.innerWidth) * 100

  useEffect(() => {
    const tabChanged = activeTabId !== prevTabId.current
    const prev = prevReviewMode.current
    prevReviewMode.current = reviewMode
    prevTabId.current = activeTabId

    // Tab switch: sync the ref, don't take panel actions
    if (tabChanged) return

    // Same tab, entering or switching review mode
    if (reviewMode && reviewMode !== prev) {
      // Snapshot current width before first resize (entering from null)
      if (!prev) {
        const currentWidth = chatPanelRef.current?.getSize()
        if (currentWidth !== undefined) {
          setPreviousChatWidth(currentWidth)
        }
      }
      setChatOpen(true)
      if (reviewMode === 'side-by-side') {
        chatPanelRef.current?.resize(60)
      } else {
        // Quick mode: compact sidebar at ~280px
        chatPanelRef.current?.resize(quickReviewPct)
      }
    } else if (!reviewMode && prev) {
      // Exiting review: restore previous state
      if (!wasChatOpenBeforeReview) {
        setChatOpen(false)
      } else if (previousChatWidth !== null) {
        chatPanelRef.current?.resize(previousChatWidth)
      } else {
        chatPanelRef.current?.resize(CHAT_DEFAULT_PCT)
      }
    }
  }, [reviewMode, activeTabId, wasChatOpenBeforeReview, previousChatWidth, setChatOpen, chatPanelRef, setPreviousChatWidth, quickReviewPct])

  // Update window title based on document state
  const isAutoSaving = settings.autosave?.mode === 'auto' && autosaveActive && !!documentPath
  useEffect(() => {
    const fileName = documentPath ? documentPath.split('/').pop() : 'Untitled'
    const dirtyIndicator = isDirty && !isAutoSaving ? ' *' : ''
    document.title = `${fileName}${dirtyIndicator} — Prose`
  }, [documentPath, isDirty, isAutoSaving])

  // Recover draft and associated conversations
  const recoverDraft = useCallback(
    async (draft: DraftState) => {
      hydrateFromDraft(draft)
      setCurrentDocumentId(draft.document.documentId)

      // Create a tab for the recovered document
      const title = draft.document.path
        ? (() => {
            const fullFileName = draft.document.path.split('/').pop() || 'Untitled'
            const hasExtension = fullFileName.includes('.')
            return hasExtension
              ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
              : fullFileName
          })()
        : 'Untitled'

      addTab({
        documentId: draft.document.documentId,
        path: draft.document.path,
        title,
        isDirty: draft.document.isDirty,
        content: draft.document.content,
        cursorPosition: draft.cursorPosition
      })
      tabsInitialized.current = true

      // Restore file list state if present
      if (draft.fileList) {
        useFileListStore.setState({
          viewMode: draft.fileList.viewMode,
          rootPath: draft.fileList.rootPath,
          expandedFolders: new Set(draft.fileList.expandedFolders),
          selectedPath: draft.fileList.selectedPath
        })
        // Reload files if we have a rootPath
        if (draft.fileList.rootPath) {
          useFileListStore.getState().loadFiles()
        }
      }

      // Load conversations for the recovered document
      const conversations = await loadConversations(draft.document.documentId)
      useChatStore.setState({
        conversations,
        activeConversationId: draft.activeChatId ?? conversations[0]?.id ?? null,
        messages:
          conversations.find((c) => c.id === draft.activeChatId)?.messages ??
          conversations[0]?.messages ??
          []
      })
    },
    [hydrateFromDraft, addTab]
  )

  // Discard draft and cleanup if it was an unsaved document
  const discardDraft = useCallback(async (draft: DraftState) => {
    await clearDraft()
    // If the draft was for an unsaved document, clean up its chat history
    if (!draft.document.path) {
      await deleteConversations(draft.document.documentId)
    }
  }, [])

  // Recover session (multiple tabs)
  const recoverSessionState = useCallback(
    async (session: SessionState) => {
      // Restore each tab
      for (let i = 0; i < session.tabs.length; i++) {
        const tabDraft = session.tabs[i]
        const isActiveTab = tabDraft.tabId === session.activeTabId

        addTab({
          id: tabDraft.tabId,
          documentId: tabDraft.documentId,
          path: tabDraft.path,
          title: tabDraft.title,
          isDirty: tabDraft.isDirty,
          content: tabDraft.content,
          frontmatter: tabDraft.frontmatter,
          cursorPosition: tabDraft.cursorPosition
        })

        // If this is the active tab, hydrate the editor
        if (isActiveTab) {
          const documentContent = tabDraft.content
          useEditorStore.setState({
            document: {
              documentId: tabDraft.documentId,
              path: tabDraft.path,
              content: documentContent,
              frontmatter: tabDraft.frontmatter ?? {},
              isDirty: tabDraft.isDirty
            }
          })
          setCurrentDocumentId(tabDraft.documentId)

          // Load conversations for the active tab
          const conversations = await loadConversations(tabDraft.documentId)
          useChatStore.setState({
            conversations,
            activeConversationId: tabDraft.activeChatId ?? conversations[0]?.id ?? null,
            messages:
              conversations.find((c) => c.id === tabDraft.activeChatId)?.messages ??
              conversations[0]?.messages ??
              []
          })
        }
      }

      // Set active tab
      if (session.activeTabId) {
        useTabStore.getState().setActiveTab(session.activeTabId)
      }

      // Restore file list state if present
      if (session.fileList) {
        useFileListStore.setState({
          viewMode: session.fileList.viewMode,
          rootPath: session.fileList.rootPath,
          expandedFolders: new Set(session.fileList.expandedFolders),
          selectedPath: session.fileList.selectedPath
        })
        if (session.fileList.rootPath) {
          useFileListStore.getState().loadFiles()
        }
      }

      tabsInitialized.current = true
    },
    [addTab]
  )

  // Discard session
  const discardSession = useCallback(async (session: SessionState) => {
    await clearSavedSession()
    // Clean up chat history for unsaved tabs
    for (const tab of session.tabs) {
      if (!tab.path) {
        await deleteConversations(tab.documentId)
      }
    }
  }, [])

  // Handle recovery dialog actions
  const handleRecover = useCallback(async () => {
    if (pendingSession) {
      await recoverSessionState(pendingSession)
      setPendingSession(null)
    } else if (pendingDraft) {
      await recoverDraft(pendingDraft)
      setPendingDraft(null)
    }
    setRecoveryDialogOpen(false)
    useChatStore.getState().setInitializing(false)
    // Signal renderer ready to main process
    if (window.api?.signalRendererReady) {
      window.api.signalRendererReady()
    }
  }, [pendingSession, pendingDraft, recoverSessionState, recoverDraft])

  const handleDiscard = useCallback(async () => {
    if (pendingSession) {
      await discardSession(pendingSession)
      setPendingSession(null)
    } else if (pendingDraft) {
      await discardDraft(pendingDraft)
      setPendingDraft(null)
    }
    // Create blank tab after discarding
    if (!tabsInitialized.current) {
      await createNewTab()
      tabsInitialized.current = true
    }
    setRecoveryDialogOpen(false)
    useChatStore.getState().setInitializing(false)
    // Signal renderer ready to main process
    if (window.api?.signalRendererReady) {
      window.api.signalRendererReady()
    }
  }, [pendingSession, pendingDraft, discardSession, discardDraft, createNewTab])

  // Google Docs sync handlers
  const handleGoogleSync = useCallback(async () => {
    if (!window.api?.googleSync || !window.api?.googleGetConnectionStatus) {
      console.warn('Google API not available')
      return
    }

    // Check if connected
    const status = await window.api.googleGetConnectionStatus()
    if (!status.connected) {
      alert('Please connect your Google account first.\n\nGo to Settings > Account to connect.')
      return
    }

    const editorState = useEditorStore.getState()
    let frontmatter = editorState.document.frontmatter

    // Strip frontmatter from content before syncing
    const { parseMarkdown, serializeMarkdown } = await import('../../lib/markdown')
    const parsed = parseMarkdown(editorState.document.content)
    const content = parsed.content
    const path = editorState.document.path
    const title = path
      ? path.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Untitled'
      : 'Untitled'

    // Safety net: if frontmatter lost google_doc_id (e.g. after tab switch), re-read from disk
    if (!frontmatter.google_doc_id && path && window.api?.readFile) {
      try {
        const raw = await window.api.readFile(path)
        const diskParsed = parseMarkdown(raw)
        if (diskParsed.frontmatter.google_doc_id) {
          frontmatter = diskParsed.frontmatter
          editorState.setFrontmatter(frontmatter)
        }
      } catch {
        // File read failed, proceed with in-memory frontmatter
      }
    }

    useFileListStore.getState().setGoogleSyncing(true)
    try {
      const result = await window.api.googleSync(content, frontmatter, title)

      if (!result.success) {
        alert(`Sync failed: ${result.error || 'Unknown error'}`)
        return
      }

      if (result.direction === 'pull' && result.content !== undefined) {
        // Pull: update editor content
        const editor = useEditorInstanceStore.getState().editor
        if (editor) {
          editor.commands.setContent(result.content)
        }
        const updatedFrontmatter = {
          ...frontmatter,
          google_doc_id: result.docId || frontmatter.google_doc_id,
          google_synced_at: result.modifiedTime || new Date().toISOString()
        }
        editorState.setFrontmatter(updatedFrontmatter)
        editorState.setDirty(true)

        // Update sync metadata
        if (result.docId && path && window.api.googleUpdateSyncMetadataEntry) {
          await window.api.googleUpdateSyncMetadataEntry({
            title,
            googleDocId: result.docId,
            localPath: path,
            webViewLink: result.webViewLink || `https://docs.google.com/document/d/${result.docId}/edit`,
            syncedAt: new Date().toISOString(),
            remoteModifiedTime: result.modifiedTime || new Date().toISOString()
          })
          useFileListStore.getState().loadGoogleDocsMetadata()
        }

        console.log('[Google Sync] Pulled changes from Google Docs')
      } else {
        // Push or Create: update frontmatter with docId + synced_at
        const updatedFrontmatter = {
          ...frontmatter,
          google_doc_id: result.docId || frontmatter.google_doc_id,
          google_synced_at: result.modifiedTime || new Date().toISOString()
        }
        editorState.setFrontmatter(updatedFrontmatter)

        // Save file to persist frontmatter to disk
        if (editorState.document.path) {
          const serialized = serializeMarkdown(editorState.document.content, updatedFrontmatter)
          await window.api!.saveFile(editorState.document.path, serialized)
        }

        // Update sync metadata
        const docId = result.docId || String(frontmatter.google_doc_id)
        if (docId && window.api.googleUpdateSyncMetadataEntry) {
          await window.api.googleUpdateSyncMetadataEntry({
            title,
            googleDocId: docId,
            localPath: editorState.document.path || '',
            webViewLink: result.webViewLink || `https://docs.google.com/document/d/${docId}/edit`,
            syncedAt: new Date().toISOString(),
            remoteModifiedTime: result.modifiedTime || new Date().toISOString()
          })
          useFileListStore.getState().loadGoogleDocsMetadata()
        }

        if (result.direction === 'create' && result.webViewLink) {
          if (confirm('Created new Google Doc.\n\nOpen in browser?')) {
            window.open(result.webViewLink, '_blank')
          }
        }

        console.log(`[Google Sync] ${result.direction === 'create' ? 'Created' : 'Pushed'} to Google Docs`)
      }
    } catch (error) {
      alert(`Error syncing with Google Docs: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      useFileListStore.getState().setGoogleSyncing(false)
    }
  }, [])

  const handleGoogleImport = useCallback(async () => {
    if (!window.api?.googleImport || !window.api?.googleGetConnectionStatus) {
      console.warn('Google API not available')
      return
    }

    // Check if connected
    const status = await window.api.googleGetConnectionStatus()
    if (!status.connected) {
      alert('Please connect your Google account first.\n\nGo to Settings > Account to connect.')
      return
    }

    // Open the import dialog (prompt() doesn't work in Electron)
    setImportDocId('')
    setImportDialogOpen(true)
  }, [])

  const handleGoogleImportConfirm = useCallback(async () => {
    const rawDocId = importDocId.trim()
    const markAsAI = importAsAI
    setImportDialogOpen(false)
    setImportDocId('')
    setImportAsAI(false)

    if (!rawDocId || !window.api?.googleImport) return

    try {
      const result = await window.api.googleImport(rawDocId)

      if (result.success && result.content !== undefined) {
        const extractedDocId = result.docId || rawDocId
        const docTitle = result.title || 'Untitled'

        // Auto-save to ~/Documents/Google Docs/
        const { serializeMarkdown } = await import('../../lib/markdown')
        const frontmatter = {
          google_doc_id: extractedDocId,
          google_synced_at: new Date().toISOString()
        }
        const serialized = serializeMarkdown(result.content, frontmatter)

        let savedPath: string | undefined
        if (window.api.googleEnsureFolder) {
          try {
            const folderPath = await window.api.googleEnsureFolder()
            const sanitizedTitle = docTitle.replace(/[/\\:*?"<>|]/g, '-').trim() || 'Untitled'
            savedPath = `${folderPath}/${sanitizedTitle}.md`
            await window.api.saveFile(savedPath, serialized)

            // Record in sync metadata
            if (window.api.googleUpdateSyncMetadataEntry) {
              await window.api.googleUpdateSyncMetadataEntry({
                title: docTitle,
                googleDocId: extractedDocId,
                localPath: savedPath,
                webViewLink: `https://docs.google.com/document/d/${extractedDocId}/edit`,
                syncedAt: new Date().toISOString(),
                remoteModifiedTime: new Date().toISOString()
              })
              useFileListStore.getState().loadGoogleDocsMetadata()
            }
          } catch (err) {
            console.error('Failed to auto-save imported doc:', err)
          }
        }

        if (savedPath) {
          // Open the saved file in a tab
          await openFileInTab(savedPath)
        } else {
          // Fallback: create new untitled tab
          await createNewTab()
          const editor = useEditorInstanceStore.getState().editor
          if (editor) {
            editor.commands.setContent(result.content)
          }
          const editorState = useEditorStore.getState()
          editorState.setFrontmatter(frontmatter)
        }

        // Mark as AI-generated if checkbox was checked
        if (markAsAI) {
          // Wait for editor to settle with the content
          setTimeout(() => {
            const editor = useEditorInstanceStore.getState().editor
            const editorState = useEditorStore.getState()
            if (editor && result.content) {
              const { useAnnotationStore } = require('../../extensions/ai-annotations/store')
              useAnnotationStore.getState().addAnnotation({
                documentId: editorState.document.documentId,
                type: 'insertion' as const,
                from: 0,
                to: editor.state.doc.content.size,
                content: result.content,
                provenance: { model: 'external', conversationId: '', messageId: '' }
              })
            }
          }, 100)
        }
      } else {
        alert(`Failed to import from Google Docs: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      alert(`Error importing from Google Docs: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [importDocId, importAsAI, createNewTab, openFileInTab])

  // Check for session/draft recovery after settings are loaded
  useEffect(() => {
    if (!settingsLoaded) return

    const checkForRecovery = async () => {
      try {
        // First, try to restore session (multi-tab)
        const session = await restoreSession()

        if (session && session.tabs.length > 0) {
          // Check if any tabs need recovery (have unsaved content)
          const needsRecovery = hasUnsavedTabs(session)
          const recoveryMode = settings?.recovery?.mode ?? 'silent'

          if (needsRecovery && recoveryMode === 'prompt') {
            // Show recovery dialog for session
            setPendingSession(session)
            setRecoveryDialogOpen(true)
            return
          }

          // Silent recovery - restore the session
          await recoverSessionState(session)
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
          return
        }

        // Fall back to legacy single-draft recovery for backward compatibility
        const draft = await loadDraft()
        if (!draft) {
          // No draft to recover - create blank tab and complete initialization
          if (!tabsInitialized.current) {
            await createNewTab()
            tabsInitialized.current = true
          }
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
          return
        }

        // Only recover if there's actual content
        if (!draft.document.content && !draft.document.isDirty) {
          await clearDraft()
          if (!tabsInitialized.current) {
            await createNewTab()
            tabsInitialized.current = true
          }
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
          return
        }

        const recoveryMode = settings?.recovery?.mode ?? 'silent'

        if (recoveryMode === 'silent') {
          await recoverDraft(draft)
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
        } else {
          // For 'ask' mode, keep initializing until user decides
          setPendingDraft(draft)
          setRecoveryDialogOpen(true)
        }
      } catch (error) {
        console.error('Failed to check for recovery:', error)
        // Create blank tab on error
        if (!tabsInitialized.current) {
          await createNewTab()
          tabsInitialized.current = true
        }
        useChatStore.getState().setInitializing(false)
        if (window.api?.signalRendererReady) {
          window.api.signalRendererReady()
        }
      }
    }

    checkForRecovery()
    // Only run once when settings are loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded])

  // Handle menu actions from main process
  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onMenuAction((action) => {
      switch (action) {
        case 'new':
          createNewTab()
          break
        case 'open':
          // Open file dialog and open in tab
          if (window.api) {
            window.api.openFile().then(async (result) => {
              if (result) {
                await openFileInTab(result.path)
              }
            })
          }
          break
        case 'save':
          saveFile()
          break
        case 'saveAs':
          saveFileAs()
          break
        case 'settings':
          setDialogOpen(true)
          break
        case 'toggleChat':
          toggleChat()
          break
        case 'toggleFileList':
          toggleFileList()
          break
        case 'find':
          // Dispatch custom event for Editor to handle
          window.dispatchEvent(new CustomEvent('menu:find'))
          break
        case 'shortcuts':
          setShortcutsDialogOpen(true)
          break
        case 'about':
          setAboutDialogOpen(true)
          break
        case 'undo':
          editor?.commands.undo()
          break
        case 'redo':
          editor?.commands.redo()
          break
        case 'closeTab':
          // Close the active tab
          const activeTab = useTabStore.getState().getActiveTab()
          if (activeTab) {
            closeTab(activeTab.id)
          }
          break
        case 'googleSync':
          handleGoogleSync()
          break
        case 'googleImport':
          handleGoogleImport()
          break
      }
    })

    return unsubscribe
  }, [openFileInTab, saveFile, saveFileAs, createNewTab, closeTab, setDialogOpen, toggleChat, toggleFileList, setShortcutsDialogOpen, setAboutDialogOpen, editor, handleGoogleSync, handleGoogleImport])

  // Handle file open from OS (double-click .md file)
  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onFileOpenExternal(async (path) => {
      // Use tab system to open external files
      const shouldDescribe = await openFileInTab(path)
      tabsInitialized.current = true
      if (shouldDescribe) {
        describeDocument()
      }
    })
    return unsubscribe
  }, [openFileInTab, describeDocument])

  // Handle MCP tool invocations (only active in MCP server mode)
  useEffect(() => {
    if (!window.api?.onMcpToolInvoke) return
    const unsubscribe = window.api.onMcpToolInvoke(async (requestId, toolName, args) => {
      try {
        const result = await executeTool(toolName, args, 'full')
        window.api.sendMcpToolResult(requestId, result)
      } catch (error) {
        window.api.sendMcpToolResult(requestId, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          code: 'EXECUTION_ERROR'
        })
      }
    })
    return unsubscribe
  }, [])

  return (
    <PanelLayoutProvider value={panelLayout}>
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Toolbar />

        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="prose-panels"
          >
            <ResizablePanel
              ref={fileListPanelRef}
              id="file-list"
              order={1}
              defaultSize={0}
              minSize={isFileListOpen ? panelSizes.fileListMin : 0}
              maxSize={panelSizes.fileListMax}
              className="h-full overflow-hidden"
            >
              {isFileListOpen && <FileListPanel />}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="editor" order={2} minSize={panelSizes.editorMin}>
              <Editor />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              ref={chatPanelRef}
              id="chat"
              order={3}
              defaultSize={0}
              minSize={isChatOpen ? panelSizes.chatMin : 0}
              maxSize={reviewMode === 'side-by-side' ? 70 : panelSizes.chatMax}
              className="h-full overflow-hidden"
            >
              {isChatOpen && <ChatPanel />}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <StatusBar />
        <SettingsDialog />
        <RecoveryDialog
          open={recoveryDialogOpen}
          onRecover={handleRecover}
          onDiscard={handleDiscard}
        />
        <RecoveryModal />
        <KeyboardShortcutsDialog
          open={isShortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
        />
        <AboutDialog
          open={isAboutDialogOpen}
          onOpenChange={setAboutDialogOpen}
        />
        <ModelPickerDialog
          open={isModelPickerOpen}
          onOpenChange={setModelPickerOpen}
        />
        <DefaultHandlerPrompt />

        {/* Google Docs Import Dialog */}
        <AlertDialog open={importDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setImportDialogOpen(false)
            setImportDocId('')
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import from Google Docs</AlertDialogTitle>
              <AlertDialogDescription>
                Enter the Google Doc ID or paste the full document URL.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2 space-y-3">
              <div>
                <Label htmlFor="google-doc-id" className="sr-only">Document ID</Label>
                <Input
                  id="google-doc-id"
                  value={importDocId}
                  onChange={(e) => setImportDocId(e.target.value)}
                  placeholder="e.g. 1BxiM0C2..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && importDocId.trim()) {
                      handleGoogleImportConfirm()
                    }
                  }}
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="import-as-ai"
                  checked={importAsAI}
                  onCheckedChange={(checked) => setImportAsAI(checked === true)}
                />
                <Label htmlFor="import-as-ai" className="text-sm font-normal cursor-pointer">
                  Mark as AI-generated
                </Label>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleGoogleImportConfirm} disabled={!importDocId.trim()}>
                Import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
    </PanelLayoutProvider>
  )
}
