import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { useEditorStore } from '../../stores/editorStore'
import { useLinkHoverStore } from '../../stores/linkHoverStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '../ui/dropdown-menu'
import type { ToolMode } from '../../stores/chatStore'
import { cn } from '../../lib/utils'
import { getModelsForProvider, type LLMProvider } from '../../../shared/llm/models'

export function StatusBar() {
  const { document, cursorPosition } = useEditor()
  const { settings, autosaveActive, setLLMConfig, saveSettings } = useSettings()
  const { toolMode, setToolMode, includeDocument, setIncludeDocument } = useChat()
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const isAutosaving = useEditorStore((state) => state.isAutosaving)
  const hoveredUrl = useLinkHoverStore((state) => state.hoveredUrl)

  const wordCount = document.content
    .split(/\s+/)
    .filter((word) => word.length > 0).length

  const charCount = document.content.length

  // Mode configuration
  const modeConfig: Record<ToolMode, { label: string; description: string }> = {
    suggestions: { label: 'suggest edits', description: 'AI suggests changes for review' },
    full: { label: 'accept edits', description: 'AI applies changes directly' },
    plan: { label: 'plan', description: 'Review changes before applying' }
  }

  const currentMode = modeConfig[toolMode]

  // Get available models for current provider
  const availableModels = getModelsForProvider(settings.llm.provider as LLMProvider)
  const currentModel = availableModels.find(m => m.id === settings.llm.model)
  const modelDisplayName = currentModel?.name || settings.llm.model.split('/').pop() || settings.llm.model

  const handleModelChange = async (modelId: string) => {
    setLLMConfig({ model: modelId })
    await saveSettings()
  }

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-muted/30 px-4 text-xs text-muted-foreground font-mono">
      <div className="flex items-center gap-4 min-w-0">
        {hoveredUrl ? (
          <span className="text-muted-foreground truncate max-w-[400px]" title={hoveredUrl}>
            {hoveredUrl}
          </span>
        ) : (
          <>
            <span>
              Ln {cursorPosition.line}, Col {cursorPosition.column}
            </span>
            <span>{wordCount} words</span>
            <span>{charCount} characters</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        {isAutosaving ? (
          <>
            <span className="text-yellow-500">saving...</span>
            <span className="text-muted-foreground/40 mx-1">|</span>
          </>
        ) : document.isDirty && !isRemarkableReadOnly && !(settings.autosave?.mode === 'auto' && autosaveActive && document.path) ? (
          <>
            <span className="text-yellow-500">unsaved</span>
            <span className="text-muted-foreground/40 mx-1">|</span>
          </>
        ) : null}

        {/* Model selector */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="hover:text-foreground transition-colors cursor-pointer max-w-[120px] truncate">
                  {modelDisplayName}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{settings.llm.provider} / {settings.llm.model}</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {settings.llm.provider}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {availableModels.map((model) => (
              <DropdownMenuItem
                key={model.id}
                onClick={() => handleModelChange(model.id)}
                className="cursor-pointer font-mono text-xs"
              >
                <div className="flex flex-col items-start">
                  <span>{model.name}</span>
                  {model.description && (
                    <span className="text-[10px] text-muted-foreground">{model.description}</span>
                  )}
                </div>
                {model.id === settings.llm.model && (
                  <span className="ml-auto pl-2 text-primary">✓</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
