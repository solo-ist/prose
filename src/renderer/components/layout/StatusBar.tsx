import { useMemo } from 'react'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useLinkHoverStore } from '../../stores/linkHoverStore'
import { useReviewStore } from '../../stores/reviewStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
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
import { getModelsForProvider, type LLMProvider } from '../../../shared/llm/models'

export function StatusBar() {
  const { document, cursorPosition } = useEditor()
  const { settings, autosaveActive, setLLMConfig, saveSettings } = useSettings()
  const { toolMode, setToolMode } = useChat()
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const isAutosaving = useEditorStore((state) => state.isAutosaving)
  const sourceMode = useEditorStore((state) => state.sourceMode)
  const toggleSourceMode = useEditorStore((state) => state.toggleSourceMode)
  const hoveredUrl = useLinkHoverStore((state) => state.hoveredUrl)
  const editor = useEditorInstanceStore((state) => state.editor)

  // Track pending suggestion count
  const suggestionCount = useMemo(() => {
    if (!editor) return 0
    return getAISuggestions(editor).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor?.state.doc])

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
        <button
          onClick={toggleSourceMode}
          className="hover:text-foreground transition-colors cursor-pointer"
        >
          {sourceMode ? 'source' : 'wysiwyg'}
        </button>
        <span className="text-muted-foreground/40 mx-1">|</span>

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

        {/* Suggestion count */}
        {suggestionCount > 0 && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => useReviewStore.getState().setReviewMode('quick')}
                  className="text-violet-600 dark:text-violet-400 hover:text-violet-500 transition-colors cursor-pointer"
                >
                  {suggestionCount} suggestion{suggestionCount !== 1 ? 's' : ''}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Review pending suggestions</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-muted-foreground/40 mx-1">|</span>
          </>
        )}

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
      </div>
    </div>
  )
}
