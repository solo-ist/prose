import { useEffect, useState, useCallback } from 'react'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { Editor } from '../editor/Editor'
import { ChatPanel } from '../chat/ChatPanel'
import { SettingsDialog } from '../settings/SettingsDialog'
import { RecoveryDialog } from './RecoveryDialog'
import { KeyboardShortcutsDialog } from '../settings/KeyboardShortcutsDialog'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '../ui/resizable'
import { TooltipProvider } from '../ui/tooltip'
import { useChat } from '../../hooks/useChat'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useEditorStore } from '../../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../../stores/chatStore'
import {
  loadDraft,
  clearDraft,
  loadConversations,
  deleteConversations
} from '../../lib/persistence'
import type { DraftState } from '../../lib/persistence'

export function App() {
  const { isPanelOpen, togglePanel, sendMessage } = useChat()
  const { openFile, openFileFromPath, saveFile, saveFileAs, newFile } = useEditor()
  const { setDialogOpen, isShortcutsDialogOpen, setShortcutsDialogOpen, settings, isLoaded: settingsLoaded } = useSettings()
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<DraftState | null>(null)

  const hydrateFromDraft = useEditorStore((state) => state.hydrateFromDraft)

  // Recover draft and associated conversations
  const recoverDraft = useCallback(
    async (draft: DraftState) => {
      hydrateFromDraft(draft)
      setCurrentDocumentId(draft.document.documentId)

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
          openFile().then((shouldAutoPrompt) => {
            if (shouldAutoPrompt) sendMessage('What is this?')
          })
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
          togglePanel()
          break
        case 'find':
          // Dispatch custom event for Editor to handle
          window.dispatchEvent(new CustomEvent('menu:find'))
          break
        case 'shortcuts':
          setShortcutsDialogOpen(true)
          break
      }
    })

    return unsubscribe
  }, [openFile, saveFile, saveFileAs, newFile, setDialogOpen, togglePanel, sendMessage])

  // Handle file open from OS (double-click .md file)
  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onFileOpenExternal((path) => {
      openFileFromPath(path).then((shouldAutoPrompt) => {
        if (shouldAutoPrompt) sendMessage('What is this?')
      })
    })
    return unsubscribe
  }, [openFileFromPath, sendMessage])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Toolbar />

        <div className="flex-1 overflow-hidden">
          {isPanelOpen ? (
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={70} minSize={40}>
                <Editor />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
                <ChatPanel />
              </ResizablePanel>
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
      </div>
    </TooltipProvider>
  )
}
