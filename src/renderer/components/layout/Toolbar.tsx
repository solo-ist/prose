import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useEditor } from '../../hooks/useEditor'
import { useEditorStore } from '../../stores/editorStore'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../ui/tooltip'
import {
  FileText,
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
  const { settings, isLoaded, setTheme, setDialogOpen } = useSettings()
  const { isPanelOpen: isChatOpen, togglePanel: toggleChatPanel } = useChat()
  const { isPanelOpen: isFileListOpen, togglePanel: toggleFileListPanel } = useFileList()

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [hasCopied, setHasCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Extract filename and extension
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const remarkableNotebookId = useEditorStore((state) => state.remarkableNotebookId)
  const notebookMetadata = useFileListStore((state) => state.notebookMetadata)

  const fullFileName = document.path?.split('/').pop() || ''
  const hasExtension = fullFileName.includes('.')

  // For reMarkable read-only mode, use the notebook name from metadata
  let fileName: string
  if (isRemarkableReadOnly && remarkableNotebookId && notebookMetadata?.notebooks?.[remarkableNotebookId]) {
    fileName = notebookMetadata.notebooks[remarkableNotebookId].name
  } else {
    fileName = hasExtension
      ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
      : fullFileName || 'Untitled'
  }

  const fileExtension = hasExtension
    ? fullFileName.substring(fullFileName.lastIndexOf('.'))
    : '.md'

  const handleIconClick = () => {
    if (document.path && window.api) {
      window.api.showInFolder(document.path)
    }
  }

  const toggleTheme = () => {
    // If theme is 'system', check what it actually resolved to
    const effectiveTheme = settings.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : settings.theme
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

  const handleTitleDoubleClick = () => {
    setEditedTitle(fileName)
    setIsEditingTitle(true)
  }

  useEffect(() => {
    if (isEditingTitle && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingTitle])

  const handleTitleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (editedTitle.trim()) {
        const success = await quickSaveWithTitle(editedTitle.trim())
        if (success) {
          setIsEditingTitle(false)
        }
      } else {
        setIsEditingTitle(false)
      }
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }

  const handleTitleBlur = () => {
    setIsEditingTitle(false)
  }

  // Add left padding on macOS to clear traffic lights
  const leftPadding = isMacOS() ? 'pl-20' : 'pl-4'

  return (
    <div className={`flex h-12 items-center justify-between border-b border-border bg-background pr-4 ${leftPadding} app-region-drag`}>
      {/* Left: File explorer toggle and file info */}
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

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleIconClick}
              disabled={!document.path}
              className={`p-0.5 rounded ${document.path ? 'cursor-pointer hover:bg-accent' : 'cursor-default'}`}
              aria-label={document.path ? 'Reveal in Finder' : 'File not saved'}
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          {document.path && <TooltipContent>Reveal in Finder</TooltipContent>}
        </Tooltip>
        <div className="flex items-center">
          {isEditingTitle ? (
            <>
              <Input
                ref={inputRef}
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleBlur}
                className="h-7 w-40 text-sm font-medium"
              />
              <span className="text-sm text-muted-foreground">{fileExtension}</span>
            </>
          ) : (
            <span
              className="text-sm font-medium cursor-pointer hover:text-primary transition-colors"
              onDoubleClick={handleTitleDoubleClick}
              title="Double-click to rename and save"
            >
              {fileName}
              <span className="text-muted-foreground">{fileExtension}</span>
              {document.isDirty && <span className="text-muted-foreground"> *</span>}
            </span>
          )}
        </div>
      </div>

      {/* Center: Spacer for draggable area */}
      <div className="flex-1" />

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
              {settings.theme === 'dark' ? (
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
            <DropdownMenuItem onClick={newFile}>
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
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDialogOpen(true)}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => getApi().closeWindow()}>
              Close
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
