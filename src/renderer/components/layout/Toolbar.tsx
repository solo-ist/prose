import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useEditor } from '../../hooks/useEditor'
import { useTabs } from '../../hooks/useTabs'
import { useEditorStore } from '../../stores/editorStore'
import { useTabStore } from '../../stores/tabStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useSettings } from '../../hooks/useSettings'
import { usePanelLayoutContext } from '../../hooks/usePanelLayout'
import { isMacOS, getApi } from '../../lib/browserApi'
import { useTabTier } from '../../hooks/useTabTier'
import { useGoogleDocsEnabled } from '../../lib/featureFlags'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  Check,
  Timer,
  CircleUserRound,
  Bug,
  LifeBuoy,
  MessageSquarePlus,
  MessagesSquare,
  FilePlus,
  FolderOpen,
  Save,
  FileDown,
  X,
  Eye,
  EyeOff,
  Code,
  FileText,
  Sparkles
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
  const { settings, isLoaded, effectiveTheme, autosaveActive, setTheme, setDialogOpen, toggleAutosaveActive } = useSettings()
  const { isChatOpen, isFileListOpen, toggleChat, toggleFileList } = usePanelLayoutContext()
  const isEditing = useEditorStore((state) => state.isEditing)
  const annotationsVisible = useEditorStore((state) => state.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((state) => state.toggleAnnotationsVisible)
  const sourceMode = useEditorStore((state) => state.sourceMode)
  const toggleSourceMode = useEditorStore((state) => state.toggleSourceMode)
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const isPreviewTab = useEditorStore((state) => state.isPreviewTab)
  const isGoogleSyncing = useFileListStore((state) => state.isGoogleSyncing)
  const googleDocsEnabled = useGoogleDocsEnabled()

  const [hasCopied, setHasCopied] = useState(false)
  const [googlePicture, setGooglePicture] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const tabBarContainerRef = useRef<HTMLDivElement>(null)
  const { tier, containerWidth } = useTabTier(tabBarContainerRef, { tabCount: tabs.length })

  // Track fullscreen state for traffic light padding
  useEffect(() => {
    const api = getApi()
    if (!api.onFullscreenChange) return
    const cleanup = api.onFullscreenChange((fs) => setIsFullscreen(fs))
    return cleanup
  }, [])

  // Check Google connection status on mount and when settings change
  useEffect(() => {
    if (!googleDocsEnabled) return
    // First check settings for cached picture
    if (settings.google?.picture) {
      setGooglePicture(settings.google.picture)
    }

    async function checkGoogleConnection() {
      if (!window.api?.googleGetConnectionStatus) return
      try {
        const status = await window.api.googleGetConnectionStatus()
        if (status.connected && status.picture) {
          setGooglePicture(status.picture)
        } else if (!status.connected) {
          setGooglePicture(null)
        }
      } catch {
        // Keep cached picture from settings if check fails
      }
    }
    checkGoogleConnection()
  }, [settings.google, googleDocsEnabled])

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

  const handleTabClose = useCallback(async (tabId: string) => {
    const tab = useTabStore.getState().getTabById(tabId)
    if (!tab) return

    if (tab.isDirty) {
      // Show confirmation dialog
      setPendingCloseTabId(tabId)
    } else {
      await closeTab(tabId)
    }
  }, [closeTab])

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

  const handleClose = useCallback(async () => {
    // Close the active tab if there is one
    if (activeTabId) {
      await handleTabClose(activeTabId)
    } else if (tabs.length === 0) {
      // No tabs, close the window
      getApi().closeWindow()
    }
  }, [activeTabId, tabs.length, handleTabClose])

  // Handle Cmd+W / menu "Close Tab" action — delegates to handleClose so the
  // dirty-state confirmation dialog is shown when needed
  useEffect(() => {
    const onMenuCloseTab = () => handleClose()
    window.addEventListener('menu:closeTab', onMenuCloseTab)
    return () => window.removeEventListener('menu:closeTab', onMenuCloseTab)
  }, [handleClose])

  const handleNewFile = async () => {
    await createNewTab()
  }

  // Add left padding on macOS to clear traffic lights (less when fullscreen)
  const leftPadding = isMacOS() ? (isFullscreen ? 'pl-4' : 'pl-[88px]') : 'pl-4'

  return (
    <>
      <div className={`flex h-12 items-center justify-between border-b border-border bg-background pr-4 ${leftPadding} app-region-drag`}>
        {/* Left: File explorer toggle */}
        <div className="flex items-center gap-2 app-region-no-drag">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleFileList} aria-label={isFileListOpen ? 'Hide files' : 'Show files'}>
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
        <div ref={tabBarContainerRef} className="flex-1 flex items-center justify-start ml-2 app-region-drag min-w-0 overflow-hidden">
          <TabBar
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabCloseOthers={handleCloseOthers}
            onTabCloseAll={handleCloseAll}
            onTabRename={renameTab}
            onNewFileSave={quickSaveWithTitle}
            onNewTab={handleNewFile}
            tier={tier}
            containerWidth={containerWidth}
          />
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 ml-2 app-region-no-drag">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                disabled={!document.content}
                aria-label="Copy Markdown"
              >
                {hasCopied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{hasCopied ? 'Copied!' : `Copy Markdown (${isMacOS() ? '⌘⇧C' : 'Ctrl+Shift+C'})`}</TooltipContent>
          </Tooltip>

          {settings.autosave?.enabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleAutosaveActive}
                  aria-label={autosaveActive ? 'Pause autosave' : 'Resume autosave'}
                  className={autosaveActive ? '' : 'text-muted-foreground'}
                >
                  <Timer className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{autosaveActive ? 'Autosave on' : 'Autosave paused'}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSourceMode}
                disabled={isRemarkableReadOnly || isPreviewTab}
                aria-label={sourceMode ? 'WYSIWYG mode' : 'Source mode'}
              >
                {sourceMode ? (
                  <FileText className="h-4 w-4" />
                ) : (
                  <Code className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {sourceMode ? 'WYSIWYG mode' : 'Source mode'} ({isMacOS() ? '⌘⇧E' : 'Ctrl+Shift+E'})
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleAnnotationsVisible}
                aria-label={annotationsVisible ? 'Hide AI annotations' : 'Show AI annotations'}
                className={annotationsVisible ? '' : 'text-muted-foreground'}
              >
                {annotationsVisible ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {annotationsVisible ? 'Hide' : 'Show'} AI annotations
            </TooltipContent>
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

          {googleDocsEnabled && <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (googlePicture) {
                    const authParam = settings.google?.email ? `?authuser=${encodeURIComponent(settings.google.email)}` : ''
                    window.open(`https://docs.google.com${authParam}`, '_blank')
                  } else {
                    setDialogOpen(true, 'account')
                  }
                }}
                aria-label={googlePicture ? 'Open Google Docs' : 'Connect Google account'}
                className="relative"
              >
                {googlePicture ? (
                  <>
                    <img
                      src={googlePicture}
                      alt="Google account"
                      className="h-5 w-5 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                    {isGoogleSyncing && (
                      <svg
                        className="absolute inset-0 pointer-events-none"
                        style={{ width: '100%', height: '100%' }}
                        viewBox="0 0 40 40"
                        fill="none"
                      >
                        <defs>
                          <linearGradient id="sync-ring-a" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#8b5cf6" />
                            <stop offset="50%" stopColor="#d946ef" />
                            <stop offset="100%" stopColor="#8b5cf6" />
                          </linearGradient>
                          <linearGradient id="sync-ring-b" x1="100%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.7" />
                            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.7" />
                          </linearGradient>
                        </defs>
                        <circle
                          className="animate-spin"
                          cx="20" cy="20" r="18"
                          stroke="url(#sync-ring-a)"
                          strokeWidth="2"
                          strokeDasharray="28 85"
                          strokeLinecap="round"
                          style={{ animationDuration: '2s', transformOrigin: '50% 50%' }}
                        />
                        <circle
                          className="animate-spin"
                          cx="20" cy="20" r="14"
                          stroke="url(#sync-ring-b)"
                          strokeWidth="1.5"
                          strokeDasharray="18 70"
                          strokeLinecap="round"
                          style={{ animationDuration: '1.5s', animationDirection: 'reverse', transformOrigin: '50% 50%' }}
                        />
                      </svg>
                    )}
                  </>
                ) : isGoogleSyncing ? (
                  <svg
                    viewBox="0 0 40 40"
                    fill="none"
                    style={{ width: '1.25rem', height: '1.25rem' }}
                  >
                    <defs>
                      <linearGradient id="sync-ring-solo" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="50%" stopColor="#d946ef" />
                        <stop offset="100%" stopColor="#8b5cf6" />
                      </linearGradient>
                    </defs>
                    <circle
                      className="animate-spin"
                      cx="20" cy="20" r="18"
                      stroke="url(#sync-ring-solo)"
                      strokeWidth="2"
                      strokeDasharray="28 85"
                      strokeLinecap="round"
                      style={{ animationDuration: '2s', transformOrigin: '50% 50%' }}
                    />
                    <circle
                      className="animate-spin"
                      cx="20" cy="20" r="12"
                      stroke="url(#sync-ring-solo)"
                      strokeWidth="1.5"
                      strokeDasharray="15 60"
                      strokeLinecap="round"
                      style={{ animationDuration: '1.5s', animationDirection: 'reverse', transformOrigin: '50% 50%' }}
                    />
                  </svg>
                ) : (
                  <CircleUserRound className="h-5 w-5 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {googlePicture ? 'Open Google Docs' : 'Connect Google account'}
            </TooltipContent>
          </Tooltip>}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleChat} aria-label={isChatOpen ? 'Hide chat' : 'Show chat'}>
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
                <FilePlus className="mr-2 h-4 w-4" />
                New Document
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openFile()}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Open...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={saveFile}>
                <Save className="mr-2 h-4 w-4" />
                Save
              </DropdownMenuItem>
              <DropdownMenuItem onClick={saveFileAs}>
                <FileDown className="mr-2 h-4 w-4" />
                Save as...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDialogOpen(true)}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              {!window.api?.isMasBuild && (
                <DropdownMenuItem onClick={() => {
                  window.api?.downloadSkill?.().catch((err) => console.error('[Skill] Download failed:', err))
                }}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Download Claude Skill
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {window.api?.isMasBuild ? (
                <DropdownMenuItem onClick={() => window.open('https://solo.ist/prose/support', '_blank', 'noopener,noreferrer')}>
                  <LifeBuoy className="mr-2 h-4 w-4" />
                  Request Support
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => window.open('https://github.com/solo-ist/prose/issues/new?template=bug-report.yml', '_blank', 'noopener,noreferrer')}>
                  <Bug className="mr-2 h-4 w-4" />
                  Report a Bug
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => window.open('https://github.com/solo-ist/prose/issues/new?template=feature-request.yml', '_blank', 'noopener,noreferrer')}>
                <MessageSquarePlus className="mr-2 h-4 w-4" />
                Request a Feature
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open('https://github.com/solo-ist/prose/discussions/categories/ideas', '_blank', 'noopener,noreferrer')}>
                <MessagesSquare className="mr-2 h-4 w-4" />
                Discuss Ideas
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleClose}>
                <X className="mr-2 h-4 w-4" />
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
