import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useEditor } from '../../hooks/useEditor'
import { useTabs } from '../../hooks/useTabs'
import { useEditorStore } from '../../stores/editorStore'
import { useTabStore } from '../../stores/tabStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { useFileList } from '../../hooks/useFileList'
import { isMacOS, getApi } from '../../lib/browserApi'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../ui/tooltip'
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
import { TabBar } from './TabBar'
import {
  Moon,
  Sun,
  Settings,
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  PanelRight,
  MoreHorizontal,
  Copy,
  Check
} from 'lucide-react'

export function Toolbar() {
  const { document, openFile, saveFile, saveFileAs, newFile, quickSaveWithTitle } = useEditor()
  const {
    tabs,
    activeTabId,
    createNewTab,
    switchToTab,
    closeTab,
    forceCloseTab,
    closeOtherTabs,
    closeAllTabs,
    renameTab
  } = useTabs()
  const { settings, isLoaded, effectiveTheme, setTheme, setDialogOpen, setAutosaveConfig } = useSettings()
  const { isPanelOpen: isChatOpen, togglePanel: toggleChatPanel } = useChat()
  const { isPanelOpen: isFileListOpen, togglePanel: toggleFileListPanel } = useFileList()
  const isEditing = useEditorStore((state) => state.isEditing)

  const [hasCopied, setHasCopied] = useState(false)

  // Tab close confirmation state
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const pendingCloseTab = pendingCloseTabId
    ? useTabStore.getState().getTabById(pendingCloseTabId)
    : null

  const toggleTheme = () => {
    setTheme(effectiveTheme === 'dark' ? 'light' : 'dark')
  }

  const handleCopy = async () => {
    if (!document.content) return
    try {
      await navigator.clipboard.writeText(document.content)
      setHasCopied(true)
      setTimeout(() => setHasCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleTabClick = (tabId: string) => {
    if (tabId !== activeTabId) {
      switchToTab(tabId)
    }
  }

  const handleTabClose = async (tabId: string) => {
    const tab = useTabStore.getState().getTabById(tabId)
    if (!tab) return

    if (tab.isDirty) {
      // Show confirmation dialog
      setPendingCloseTabId(tabId)
    } else {
      await closeTab(tabId)
    }
  }

  const handleSaveAndClose = async () => {
    if (!pendingCloseTabId) return

    // Save the file first
    await saveFile()

    // Then close the tab
    await forceCloseTab(pendingCloseTabId)
    setPendingCloseTabId(null)
  }

  const handleDiscardAndClose = async () => {
    if (!pendingCloseTabId) return

    await forceCloseTab(pendingCloseTabId)
    setPendingCloseTabId(null)
  }

  const handleCancelClose = () => {
    setPendingCloseTabId(null)
  }

  const handleCloseOthers = async (tabId: string) => {
    // Check for dirty tabs
    const dirtyTabs = tabs.filter(t => t.id !== tabId && t.isDirty)
    if (dirtyTabs.length > 0) {
      // For now, just close non-dirty tabs
      // TODO: Could show a multi-save dialog
    }
    await closeOtherTabs(tabId)
  }

  const handleCloseAll = async () => {
    // Check for dirty tabs
    const dirtyTabs = tabs.filter(t => t.isDirty)
    if (dirtyTabs.length > 0) {
      // For now, just close non-dirty tabs
      // TODO: Could show a multi-save dialog
    }
    await closeAllTabs()
  }

  const handleClose = async () => {
    // Close the active tab if there is one
    if (activeTabId) {
      await handleTabClose(activeTabId)
    } else if (tabs.length === 0) {
      // No tabs, close the window
      getApi().closeWindow()
    }
  }

  const handleNewFile = async () => {
    await createNewTab()
  }

  // Add left padding on macOS to clear traffic lights
  const leftPadding = isMacOS() ? 'pl-20' : 'pl-4'

  return (
    <>
      <div className={`flex h-12 items-center justify-between border-b border-border bg-background pr-4 ${leftPadding} app-region-drag`}>
        {/* Left: File explorer toggle */}
        <div className="flex items-center gap-2 app-region-no-drag">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleFileListPanel} aria-label={isFileListOpen ? 'Hide files' : 'Show files'}>
                {isFileListOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeft className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isFileListOpen ? 'Hide files' : 'Show files'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Center: Tab bar */}
        <div className="flex-1 flex items-center justify-start ml-2 app-region-no-drag min-w-0">
          <TabBar
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabCloseOthers={handleCloseOthers}
            onTabCloseAll={handleCloseAll}
            onTabRename={renameTab}
            onNewFileSave={quickSaveWithTitle}
          />
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 app-region-no-drag">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                disabled={!document.content}
                aria-label="Copy document"
              >
                {hasCopied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{hasCopied ? 'Copied!' : 'Copy document'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleTheme} disabled={!isLoaded} aria-label="Toggle theme">
                {effectiveTheme === 'dark' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle theme</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleChatPanel} aria-label={isChatOpen ? 'Hide chat' : 'Show chat'}>
                {isChatOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRight className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isChatOpen ? 'Hide chat' : 'Show chat'}
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More options">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleNewFile}>
                New Document
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openFile()}>
                Open...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={saveFile}>
                Save
              </DropdownMenuItem>
              <DropdownMenuItem onClick={saveFileAs}>
                Save as...
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={settings.autosave?.enabled ?? false}
                onCheckedChange={(checked) => setAutosaveConfig({ enabled: checked })}
              >
                Autosave
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialogOpen(true)}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleClose}>
                Close
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Save confirmation dialog */}
      <AlertDialog open={pendingCloseTabId !== null} onOpenChange={(open) => !open && handleCancelClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCloseTab?.title || 'This document'} has unsaved changes. Do you want to save before closing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDiscardAndClose}>
              Discard
            </AlertDialogAction>
            <AlertDialogAction onClick={handleSaveAndClose}>
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
