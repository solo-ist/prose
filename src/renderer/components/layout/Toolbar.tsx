import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { isMacOS } from '../../lib/browserApi'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
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
  MoreHorizontal,
  Clock,
  Trash2
} from 'lucide-react'

export function Toolbar() {
  const { document, openFile, openRecentFile, saveFile, newFile } = useEditor()
  const { settings, setTheme, setDialogOpen, clearRecentFiles } = useSettings()
  const { isPanelOpen, togglePanel } = useChat()

  const recentFiles = settings.recentFiles || []

  const fileName = document.path
    ? document.path.split('/').pop()
    : 'Untitled'

  const toggleTheme = () => {
    setTheme(settings.theme === 'dark' ? 'light' : 'dark')
  }

  // Add left padding on macOS to clear traffic lights
  const leftPadding = isMacOS() ? 'pl-20' : 'pl-4'

  return (
    <div className={`flex h-12 items-center justify-between border-b border-border bg-background pr-4 ${leftPadding} app-region-drag`}>
      {/* Left: File info */}
      <div className="flex items-center gap-2 app-region-no-drag">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {fileName}
          {document.isDirty && <span className="text-muted-foreground"> *</span>}
        </span>
      </div>

      {/* Center: Spacer for draggable area */}
      <div className="flex-1" />

      {/* Right: Actions */}
      <div className="flex items-center gap-1 app-region-no-drag">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
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
            <DropdownMenuItem onClick={openFile}>
              Open...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Clock className="mr-2 h-4 w-4" />
                Open Recent
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {recentFiles.length === 0 ? (
                  <DropdownMenuItem disabled>
                    No recent files
                  </DropdownMenuItem>
                ) : (
                  <>
                    {recentFiles.map((file) => (
                      <DropdownMenuItem
                        key={file.path}
                        onClick={() => openRecentFile(file.path)}
                      >
                        <span className="truncate max-w-[200px]" title={file.path}>
                          {file.name}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={clearRecentFiles}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear Recent
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={saveFile}>
              Save
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDialogOpen(true)}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
