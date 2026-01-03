import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
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
  PanelRightClose,
  PanelRight,
  MoreHorizontal
} from 'lucide-react'

export function Toolbar() {
  const { document, openFile, saveFile, newFile, quickSaveWithTitle } = useEditor()
  const { settings, isLoaded, setTheme, setDialogOpen } = useSettings()
  const { isPanelOpen, togglePanel, sendMessage } = useChat()

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Extract filename and extension
  const fullFileName = document.path?.split('/').pop() || ''
  const hasExtension = fullFileName.includes('.')
  const fileName = hasExtension
    ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
    : fullFileName || 'Untitled'
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
      {/* Left: File info */}
      <div className="flex items-center gap-2 app-region-no-drag">
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
            <Button variant="ghost" size="icon" onClick={togglePanel} aria-label={isPanelOpen ? 'Hide chat' : 'Show chat'}>
              {isPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRight className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isPanelOpen ? 'Hide chat' : 'Show chat'}
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
            <DropdownMenuItem onClick={() => openFile().then((shouldAutoPrompt) => {
              if (shouldAutoPrompt) sendMessage('What is this?', { hidden: true })
            })}>
              Open...
            </DropdownMenuItem>
            <DropdownMenuItem onClick={saveFile}>
              Save
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
