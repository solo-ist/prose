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
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '../ui/resizable'
import { TooltipProvider } from '../ui/tooltip'
import { useChat } from '../../hooks/useChat'
import { useEditor } from '../../hooks/useEditor'
import { useTabs } from '../../hooks/useTabs'
import { useFileList } from '../../hooks/useFileList'
import { useSettings } from '../../hooks/useSettings'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../../stores/chatStore'
import { useTabStore, createTab, restoreSession, clearSavedSession, hasUnsavedTabs } from '../../stores/tabStore'
import { useFileListStore } from '../../stores/fileListStore'
import {
  loadDraft,
  clearDraft,
  loadConversations,
  deleteConversations
} from '../../lib/persistence'
import type { DraftState, SessionState } from '../../lib/persistence'
import { executeTool } from '../../lib/tools'

export function App() {
  const { isPanelOpen: isChatOpen, togglePanel: toggleChatPanel, setPanelOpen: setChatPanelOpen, describeDocument } = useChat()
  const { isPanelOpen: isFileListOpen, togglePanel: toggleFileListPanel, setPanelOpen: setFileListPanelOpen } = useFileList()

  // Minimum window width before we auto-close the other panel
  const MIN_WIDTH_FOR_BOTH_PANELS = 3000
  const { openFile, openFileFromPath, saveFile, saveFileAs, newFile } = useEditor()
  const { createNewTab, openFileInTab, closeTab } = useTabs()
  const { setDialogOpen, isShortcutsDialogOpen, setShortcutsDialogOpen, isAboutDialogOpen, setAboutDialogOpen, settings, isLoaded: settingsLoaded } = useSettings()
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<DraftState | null>(null)
  const [pendingSession, setPendingSession] = useState<SessionState | null>(null)
  const tabsInitialized = useRef(false)

  const hydrateFromDraft = useEditorStore((state) => state.hydrateFromDraft)
  const documentPath = useEditorStore((state) => state.document.path)
  const isDirty = useEditorStore((state) => state.document.isDirty)
  const editor = useEditorInstanceStore((state) => state.editor)
  const tabs = useTabStore((state) => state.tabs)
  const addTab = useTabStore((state) => state.addTab)

  // Update window title based on document state
  useEffect(() => {
    const fileName = documentPath ? documentPath.split('/').pop() : 'Untitled'
    const dirtyIndicator = isDirty ? ' *' : ''
    document.title = `${fileName}${dirtyIndicator} — Prose`
  }, [documentPath, isDirty])

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
              frontmatter: {},
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
          // If opening chat and window is narrow and file list is open, close file list
          if (!isChatOpen && isFileListOpen && window.innerWidth < MIN_WIDTH_FOR_BOTH_PANELS) {
            setFileListPanelOpen(false)
          }
          toggleChatPanel()
          break
        case 'toggleFileList':
          // If opening file list and window is narrow and chat is open, close chat
          if (!isFileListOpen && isChatOpen && window.innerWidth < MIN_WIDTH_FOR_BOTH_PANELS) {
            setChatPanelOpen(false)
          }
          toggleFileListPanel()
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
      }
    })

    return unsubscribe
  }, [openFileInTab, saveFile, saveFileAs, createNewTab, closeTab, setDialogOpen, toggleChatPanel, toggleFileListPanel, setShortcutsDialogOpen, setAboutDialogOpen, isFileListOpen, isChatOpen, setChatPanelOpen, setFileListPanelOpen, editor])

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
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Toolbar />

        <div className="flex-1 overflow-hidden">
          {isFileListOpen || isChatOpen ? (
            <ResizablePanelGroup
              direction="horizontal"
              key={`panels-${isFileListOpen ? 'f' : ''}-${isChatOpen ? 'c' : ''}`}
            >
              {isFileListOpen && (
                <>
                  <ResizablePanel id="file-list" defaultSize={20} minSize={15} maxSize={35} className="min-w-[16.25rem]">
                    <FileListPanel />
                  </ResizablePanel>
                  <ResizableHandle />
                </>
              )}
              <ResizablePanel
                id="editor"
                defaultSize={isFileListOpen && isChatOpen ? 40 : isFileListOpen ? 80 : 50}
                minSize={30}
              >
                <Editor />
              </ResizablePanel>
              {isChatOpen && (
                <>
                  <ResizableHandle />
                  <ResizablePanel id="chat" defaultSize={isFileListOpen ? 40 : 50} minSize={20} maxSize={60}>
                    <ChatPanel />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          ) : (
            <Editor />
          )}
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
        <DefaultHandlerPrompt />
      </div>
    </TooltipProvider>
  )
}
