/**
 * AI Edits History Panel
 *
 * Displays a permanent log of all AI-applied edits for the current document,
 * grouped by date. Built on top of the annotation provenance data — history
 * entries are created when annotations are added and persist permanently in
 * IndexedDB, outlasting the 7-day annotation fade window.
 *
 * Surface: rendered inside the chat sidebar when the user clicks the History
 * icon in the ChatPanel action bar.
 */

import { useCallback } from 'react'
import { Clock, Wand2, ChevronDown, ChevronRight, X, RotateCcw, Trash2, Eye, EyeOff } from 'lucide-react'
import { useEditHistoryStore, groupEntriesByDate, formatModelName } from '../../stores/editHistoryStore'
import { useAnnotationStore } from '../../extensions/ai-annotations/store'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { formatAge } from '../../types/annotations'
import type { EditHistoryEntry } from '../../types/editHistory'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'

interface AIEditsHistoryPanelProps {
  onClose: () => void
}

export function AIEditsHistoryPanel({ onClose }: AIEditsHistoryPanelProps) {
  const { entries, isLoading, showDismissed, dismissEntry, restoreEntry, setShowDismissed, clearHistory } =
    useEditHistoryStore()
  const annotations = useAnnotationStore((s) => s.annotations)
  const editor = useEditorInstanceStore((s) => s.editor)

  const visibleEntries = showDismissed ? entries : entries.filter((e) => !e.dismissed)
  const groups = groupEntriesByDate(visibleEntries)
  const dismissedCount = entries.filter((e) => e.dismissed).length

  const handleJumpToAnnotation = useCallback(
    (entry: EditHistoryEntry) => {
      if (!editor) return
      const live = annotations.find((a) => a.id === entry.annotationId)
      if (!live) return

      editor.commands.setTextSelection({ from: live.from, to: live.to })
      editor.commands.focus()

      // Scroll the selection into view
      const { selection } = editor.state
      const domAtPos = editor.view.domAtPos(selection.from)
      const el = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [editor, annotations]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-xs text-muted-foreground">
        Loading history...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span>AI Edits History</span>
          {entries.length > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
              {entries.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {dismissedCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-6 w-6', showDismissed && 'bg-accent')}
                  onClick={() => setShowDismissed(!showDismissed)}
                  aria-label={showDismissed ? 'Hide dismissed entries' : 'Show dismissed entries'}
                >
                  {showDismissed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {showDismissed ? 'Hide dismissed' : `Show ${dismissedCount} dismissed`}
              </TooltipContent>
            </Tooltip>
          )}

          {entries.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm('Clear all AI edit history for this document? This cannot be undone.')) {
                      clearHistory()
                    }
                  }}
                  aria-label="Clear all history"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear all history</TooltipContent>
            </Tooltip>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
            aria-label="Close history"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState />
        ) : groups.length === 0 && !showDismissed ? (
          <AllDismissedState onShowDismissed={() => setShowDismissed(true)} />
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <DateGroup
                key={group.label}
                label={group.label}
                entries={group.entries}
                liveAnnotationIds={new Set(annotations.map((a) => a.id))}
                onJump={handleJumpToAnnotation}
                onDismiss={dismissEntry}
                onRestore={restoreEntry}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer: annotation visibility toggle */}
      <AnnotationVisibilityFooter />
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2">
      <Wand2 className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">No AI edits yet</p>
      <p className="text-[10px] text-muted-foreground/60 max-w-[180px] leading-relaxed">
        AI-applied edits will appear here as a permanent history log.
      </p>
    </div>
  )
}

function AllDismissedState({ onShowDismissed }: { onShowDismissed: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2">
      <EyeOff className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">All entries dismissed</p>
      <button
        onClick={onShowDismissed}
        className="text-[10px] text-primary underline hover:text-primary/80 transition-colors"
      >
        Show dismissed entries
      </button>
    </div>
  )
}

interface DateGroupProps {
  label: string
  entries: EditHistoryEntry[]
  liveAnnotationIds: Set<string>
  onJump: (entry: EditHistoryEntry) => void
  onDismiss: (id: string) => void
  onRestore: (id: string) => void
}

function DateGroup({ label, entries, liveAnnotationIds, onJump, onDismiss, onRestore }: DateGroupProps) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 sticky top-0 bg-background z-10 border-b border-border/40">
        {label}
      </div>
      <div className="divide-y divide-border/30">
        {entries.map((entry) => (
          <HistoryEntryRow
            key={entry.id}
            entry={entry}
            isLive={liveAnnotationIds.has(entry.annotationId)}
            onJump={onJump}
            onDismiss={onDismiss}
            onRestore={onRestore}
          />
        ))}
      </div>
    </div>
  )
}

interface HistoryEntryRowProps {
  entry: EditHistoryEntry
  isLive: boolean
  onJump: (entry: EditHistoryEntry) => void
  onDismiss: (id: string) => void
  onRestore: (id: string) => void
}

function HistoryEntryRow({ entry, isLive, onJump, onDismiss, onRestore }: HistoryEntryRowProps) {
  const snippet = entry.content.slice(0, 80).replace(/\n/g, ' ')
  const isLong = entry.content.length > 80

  return (
    <div
      className={cn(
        'group px-3 py-2.5 hover:bg-muted/40 transition-colors',
        entry.dismissed && 'opacity-50'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Left: type badge + snippet */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <TypeBadge type={entry.type} />
            <span className="text-[10px] text-muted-foreground/70 shrink-0">
              {formatModelName(entry.provenance.model)}
            </span>
            <span className="text-[10px] text-muted-foreground/50 shrink-0 ml-auto">
              {formatAge(entry.appliedAt)}
            </span>
          </div>

          {/* Content snippet */}
          <p className="text-xs text-foreground/80 leading-snug break-words line-clamp-2 font-mono">
            {snippet}
            {isLong && <span className="text-muted-foreground/50">…</span>}
          </p>

          {/* Explanation */}
          {entry.explanation && (
            <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug line-clamp-2 italic">
              {entry.explanation}
            </p>
          )}
        </div>

        {/* Right: action buttons (shown on hover) */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {isLive && !entry.dismissed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onJump(entry)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Jump to annotation in document"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Jump to in document</TooltipContent>
            </Tooltip>
          )}

          {entry.dismissed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onRestore(entry.id)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Restore entry"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Restore</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDismiss(entry.id)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Dismiss entry"
                >
                  <X className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Dismiss</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Live annotation indicator */}
      {isLive && (
        <div className="mt-1 flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Live in document</span>
        </div>
      )}
    </div>
  )
}

function TypeBadge({ type }: { type: EditHistoryEntry['type'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider',
        type === 'insertion'
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
    >
      {type === 'insertion' ? '+' : '~'} {type}
    </span>
  )
}

/**
 * Footer: toggle annotation visibility (the time-fading decorations in the editor).
 * Placed at the bottom of the history panel for quick access.
 */
function AnnotationVisibilityFooter() {
  const isVisible = useAnnotationStore((s) => s.isVisible)
  const toggleVisibility = useAnnotationStore((s) => s.toggleVisibility)

  return (
    <div className="border-t border-border px-3 py-2 flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">
        Annotations in editor
      </span>
      <button
        onClick={toggleVisibility}
        className={cn(
          'flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors',
          isVisible
            ? 'bg-primary/10 text-primary hover:bg-primary/20'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        )}
        aria-pressed={isVisible}
      >
        {isVisible ? (
          <>
            <ChevronDown className="h-2.5 w-2.5" />
            Visible
          </>
        ) : (
          <>
            <ChevronRight className="h-2.5 w-2.5" />
            Hidden
          </>
        )}
      </button>
    </div>
  )
}
