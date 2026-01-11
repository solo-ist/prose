import { useEffect, useState, useCallback } from 'react'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { Editor } from '../editor/Editor'
import { ChatPanel } from '../chat/ChatPanel'
import { FileListPanel } from '../files/FileListPanel'
import { SettingsDialog } from '../settings/SettingsDialog'
import { RecoveryDialog } from './RecoveryDialog'
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
import { useFileList } from '../../hooks/useFileList'
import { useSettings } from '../../hooks/useSettings'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../../stores/chatStore'
import { useFileListStore } from '../../stores/fileListStore'
import {
  loadDraft,
  clearDraft,
  loadConversations,
  deleteConversations
} from '../../lib/persistence'
import type { DraftState } from '../../lib/persistence'

export function App() {
  const { isPanelOpen: isChatOpen, togglePanel: toggleChatPanel, setPanelOpen: setChatPanelOpen } = useChat()
  const { isPanelOpen: isFileListOpen, togglePanel: toggleFileListPanel, setPanelOpen: setFileListPanelOpen } = useFileList()

  // Minimum window width before we auto-close the other panel
  const MIN_WIDTH_FOR_BOTH_PANELS = 3000
  const { openFile, openFileFromPath, saveFile, saveFileAs, newFile } = useEditor()
  const { setDialogOpen, isShortcutsDialogOpen, setShortcutsDialogOpen, isAboutDialogOpen, setAboutDialogOpen, settings, isLoaded: settingsLoaded } = useSettings()
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<DraftState | null>(null)

  const hydrateFromDraft = useEditorStore((state) => state.hydrateFromDraft)
  const documentPath = useEditorStore((state) => state.document.path)
  const isDirty = useEditorStore((state) => state.document.isDirty)
  const editor = useEditorInstanceStore((state) => state.editor)

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
    [hydrateFromDraft]
  )

  // Discard draft and cleanup if it was an unsaved document
  const discardDraft = useCallback(async (draft: DraftState) => {
    await clearDraft()
    // If the draft was for an unsaved document, clean up its chat history
    if (!draft.document.path) {
      await deleteConversations(draft.document.documentId)
    }
  }, [])

  // Handle recovery dialog actions
  const handleRecover = useCallback(async () => {
    if (pendingDraft) {
      await recoverDraft(pendingDraft)
      setPendingDraft(null)
    }
    setRecoveryDialogOpen(false)
    useChatStore.getState().setInitializing(false)
  }, [pendingDraft, recoverDraft])

  const handleDiscard = useCallback(async () => {
    if (pendingDraft) {
      await discardDraft(pendingDraft)
      setPendingDraft(null)
    }
    setRecoveryDialogOpen(false)
    useChatStore.getState().setInitializing(false)
  }, [pendingDraft, discardDraft])

  // Check for draft recovery after settings are loaded
  useEffect(() => {
    if (!settingsLoaded) return

    const checkForDraft = async () => {
      try {
        const draft = await loadDraft()
        if (!draft) {
          // No draft to recover - initialization complete
          useChatStore.getState().setInitializing(false)
          return
        }

        // Only recover if there's actual content
        if (!draft.document.content && !draft.document.isDirty) {
          await clearDraft()
          useChatStore.getState().setInitializing(false)
          return
        }

        const recoveryMode = settings?.recovery?.mode ?? 'silent'

        if (recoveryMode === 'silent') {
          await recoverDraft(draft)
          useChatStore.getState().setInitializing(false)
        } else {
          // For 'ask' mode, keep initializing until user decides
          setPendingDraft(draft)
          setRecoveryDialogOpen(true)
        }
      } catch (error) {
        console.error('Failed to check for draft:', error)
        useChatStore.getState().setInitializing(false)
      }
    }

    checkForDraft()
    // Only run once when settings are loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded])

  // Handle menu actions from main process
  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onMenuAction((action) => {
      switch (action) {
        case 'new':
          newFile()
          break
        case 'open':
          openFile()
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
      }
    })

    return unsubscribe
  }, [openFile, saveFile, saveFileAs, newFile, setDialogOpen, toggleChatPanel, toggleFileListPanel, setShortcutsDialogOpen, setAboutDialogOpen, isFileListOpen, isChatOpen, setChatPanelOpen, setFileListPanelOpen, editor])

  // Handle file open from OS (double-click .md file)
  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onFileOpenExternal((path) => {
      openFileFromPath(path)
    })
    return unsubscribe
  }, [openFileFromPath])

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
        <KeyboardShortcutsDialog
          open={isShortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
        />
        <AboutDialog
          open={isAboutDialogOpen}
          onOpenChange={setAboutDialogOpen}
        />
      </div>
    </TooltipProvider>
  )
}
