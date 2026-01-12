import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import type { ToolMode } from '../../stores/chatStore'
import { cn } from '../../lib/utils'

export function StatusBar() {
  const { document, cursorPosition } = useEditor()
  const { settings } = useSettings()
  const { toolMode, setToolMode, includeDocument, setIncludeDocument } = useChat()

  const wordCount = document.content
    .split(/\s+/)
    .filter((word) => word.length > 0).length

  const charCount = document.content.length

  // Mode configuration
  const modeConfig: Record<ToolMode, { label: string; description: string }> = {
    suggestions: { label: 'suggestions', description: 'Read-only + suggestions' },
    full: { label: 'full', description: 'Direct edits enabled' },
    plan: { label: 'plan', description: 'Review changes before applying' }
  }

  const currentMode = modeConfig[toolMode]

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-muted/30 px-4 text-xs text-muted-foreground font-mono">
      <div className="flex items-center gap-4">
        <span>
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </span>
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
      </div>

      <div className="flex items-center gap-1">
        {document.isDirty && (
          <>
            <span className="text-yellow-500">unsaved</span>
            <span className="text-muted-foreground/40 mx-1">|</span>
          </>
        )}

        {/* Provider */}
        <span>{settings.llm.provider}</span>

        <span className="text-muted-foreground/40 mx-1">|</span>

        {/* Mode selector */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="hover:text-foreground transition-colors cursor-pointer">
                  {currentMode.label}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{currentMode.description}</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {(Object.entries(modeConfig) as [ToolMode, typeof currentMode][]).map(
              ([mode, config]) => (
                <DropdownMenuItem
                  key={mode}
                  onClick={() => setToolMode(mode)}
                  className="cursor-pointer font-mono text-xs"
                >
                  <span className="flex-1">{config.label}</span>
                  {mode === toolMode && (
                    <span className="ml-2 text-primary">✓</span>
                  )}
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-muted-foreground/40 mx-1">|</span>

        {/* Full context toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIncludeDocument(!includeDocument)}
              className={cn(
                "hover:text-foreground transition-colors cursor-pointer",
                includeDocument && "text-foreground"
              )}
            >
              {includeDocument ? "ctx" : "no ctx"}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{includeDocument ? "Full document as context" : "No document context"}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
