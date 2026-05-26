import { useMemo, useEffect, useRef, useState, useCallback } from 'react'
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

// Detect Mac for keyboard-hint copy. Works in both Electron and web mode,
// unlike browserApi's isMacOS() which gates on isElectron().
const isMacKeyboard =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

export function StatusBar() {
  const { document, cursorPosition } = useEditor()
  const { settings, isLoaded: settingsLoaded, autosaveActive, setLLMConfig, saveSettings } = useSettings()
  const { toolMode, setToolMode } = useChat()
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)

  // Track whether the upcoming toolMode change was initiated by a user click on
  // the mode chip (no cue needed) vs. a programmatic change (pulse to signal it).
  const userInitiatedRef = useRef(false)
  // Suppress pulse on the initial settings-boot hydration (first load applies the
  // persisted value silently; only subsequent in-session programmatic changes pulse).
  const suppressNextPulseRef = useRef(true)
  const [modeChipPulse, setModeChipPulse] = useState(false)
  const prevToolModeRef = useRef(toolMode)

  // Once settings finish loading for the first time, clear the boot-suppression
  // flag so subsequent programmatic changes can pulse.
  const settingsLoadedRef = useRef(false)
  useEffect(() => {
    if (settingsLoaded && !settingsLoadedRef.current) {
      settingsLoadedRef.current = true
      // Allow one toolMode change (the boot hydration) to pass silently, then
      // lift the suppression on the next tick so real programmatic changes pulse.
      setTimeout(() => { suppressNextPulseRef.current = false }, 0)
    }
  }, [settingsLoaded])

  useEffect(() => {
    if (toolMode === prevToolModeRef.current) return
    prevToolModeRef.current = toolMode
    if (userInitiatedRef.current) {
      // User clicked the chip — clear the flag, no visual cue needed
      userInitiatedRef.current = false
      return
    }
    if (suppressNextPulseRef.current) {
      // Boot-time hydration — suppress silently
      return
    }
    // Programmatic change — briefly pulse the mode chip
    setModeChipPulse(true)
    const timer = setTimeout(() => setModeChipPulse(false), 1500)
    return () => clearTimeout(timer)
  }, [toolMode])
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

  // Live word/char count from editor state, not debounced store (#563)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)

  const updateCounts = useCallback(() => {
    if (editor) {
      const doc = editor.state.doc
      const text = doc.textBetween(0, doc.content.size, '\n')
      setCharCount(text.length)
      setWordCount(text.split(/\s+/).filter((w) => w.length > 0).length)
    } else {
      const text = document.content
      setCharCount(text.length)
      setWordCount(text.split(/\s+/).filter((w) => w.length > 0).length)
    }
  }, [editor, document.content])

  useEffect(() => {
    updateCounts()
    if (!editor) return
    editor.on('update', updateCounts)
    return () => { editor.off('update', updateCounts) }
  }, [editor, updateCounts])

  // Mode configuration.
  // ToolMode union renamed to chat / editor / create in #467 Chunk 3.
  // Editor is the actual default — chatStore initializes new users into it.
  const modeConfig: Record<ToolMode, { label: string; description: string }> = {
    chat: { label: 'Chat', description: 'Read-only — sounding board, fact-check, no edits' },
    editor: { label: 'Editor', description: 'Proposes copy edits and editorial notes (default)' },
    create: { label: 'Create', description: 'Drafts and applies edits directly (opt-in)' }
  }

  const currentMode = modeConfig[toolMode]

  // Get available models for current provider
  const availableModels = getModelsForProvider(settings.llm.provider as LLMProvider)
  const currentModel = availableModels.find(m => m.id === settings.llm.model)
  // Compact display for the status bar — drop the "Claude " prefix (e.g. "Sonnet 4.6").
  const modelDisplayName = (currentModel?.name || settings.llm.model.split('/').pop() || settings.llm.model).replace(/^Claude\s+/, '')

  const handleModelChange = async (modelId: string) => {
    setLLMConfig({ model: modelId })
    await saveSettings()
  }

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-muted/30 px-4 text-xs text-muted-foreground font-mono">
      <div className="flex items-center gap-4 min-w-0">
        {hoveredUrl ? (
          <>
            <span className="text-muted-foreground truncate max-w-[400px]" title={hoveredUrl}>
              {hoveredUrl}
            </span>
            <span className="text-muted-foreground/60 shrink-0">
              {isMacKeyboard ? '[CMD + click to open]' : '[Ctrl + click to open]'}
            </span>
          </>
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
          className="hover:text-foreground focus-visible:text-foreground focus-visible:outline-none transition-colors cursor-pointer"
        >
          {sourceMode ? 'Source' : 'WYSIWYG'}
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
                  className="text-violet-600 dark:text-violet-400 hover:text-violet-500 focus-visible:text-violet-500 focus-visible:outline-none transition-colors cursor-pointer"
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
                <button className="hover:text-foreground focus-visible:text-foreground focus-visible:outline-none transition-colors cursor-pointer max-w-[120px] truncate">
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
                <button className={`hover:text-foreground focus-visible:text-foreground focus-visible:outline-none transition-colors cursor-pointer${modeChipPulse ? ' animate-pulse text-primary' : ''}`}>
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
                  onClick={() => {
                    userInitiatedRef.current = true
                    setToolMode(mode)
                  }}
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
