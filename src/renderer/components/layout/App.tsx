import { useEffect } from 'react'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { Editor } from '../editor/Editor'
import { ChatPanel } from '../chat/ChatPanel'
import { SettingsDialog } from '../settings/SettingsDialog'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '../ui/resizable'
import { TooltipProvider } from '../ui/tooltip'
import { useChat } from '../../hooks/useChat'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'

export function App() {
  const { isPanelOpen, togglePanel } = useChat()
  const { openFile, saveFile, saveFileAs, newFile } = useEditor()
  const { setDialogOpen } = useSettings()

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
          togglePanel()
          break
      }
    })

    return unsubscribe
  }, [openFile, saveFile, saveFileAs, newFile, setDialogOpen, togglePanel])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Toolbar />

        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={70} minSize={40}>
              <Editor />
            </ResizablePanel>

            {isPanelOpen && (
              <>
                <ResizableHandle />
                <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
                  <ChatPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>

        <StatusBar />
        <SettingsDialog />
      </div>
    </TooltipProvider>
  )
}
