/**
 * AI Edits History Panel
 *
 * A live view of the AI authorship annotations on the current document, grouped
 * by date. This is a direct projection of the annotation store (single source of
 * truth) — there is no separate ledger. Removing a row removes the underlying
 * annotation (un-marks the AI authorship; the text itself is left untouched), and
 * un-marking in the document removes the row. Fully idempotent in both directions.
 *
 * Surface: rendered inside the chat sidebar when the user selects the Activity
 * tab in the ChatPanel header. The superseded filter lives in that tab header;
 * this panel receives the resulting `hideSuperseded` flag as a prop.
 */

import { useCallback, useMemo } from 'react'
import { Wand2, Crosshair, X, Eye, EyeOff, Filter } from 'lucide-react'
import { useAnnotationStore } from '../../extensions/ai-annotations/store'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { formatAge } from '../../types/annotations'
import type { AIAnnotation, AnnotationType } from '../../types/annotations'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'

interface AIEditsHistoryPanelProps {
  /** Hide superseded (detached) entries. Owned by ChatPanel's tab header. */
  hideSuperseded: boolean
  /** Clear the filter (wired to the filtered-empty "Show all" affordance). */
  onShowAll: () => void
}

export function AIEditsHistoryPanel({ hideSuperseded, onShowAll }: AIEditsHistoryPanelProps) {
  const annotations = useAnnotationStore((s) => s.annotations)
  const removeAnnotation = useAnnotationStore((s) => s.removeAnnotation)
  const editor = useEditorInstanceStore((s) => s.editor)

  // Superseded (detached) entries are history-only — their annotated text was
  // replaced by a later edit (#674). The filter toggle lives in ChatPanel's
  // tab header; this panel just honours the resulting flag.
  const visibleAnnotations = useMemo(
    () => (hideSuperseded ? annotations.filter((a) => !a.detached) : annotations),
    [annotations, hideSuperseded]
  )

  // Newest first, grouped by calendar day.
  const groups = useMemo(
    () => groupAnnotationsByDate([...visibleAnnotations].sort((a, b) => b.createdAt - a.createdAt)),
    [visibleAnnotations]
  )

  const handleJump = useCallback(
    (annotation: AIAnnotation) => {
      if (!editor) return
      // Detached entries are history-only (#674): the annotated text was
      // replaced by a later edit, so the stored positions are stale.
      if (annotation.detached) return
      editor.commands.setTextSelection({ from: annotation.from, to: annotation.to })
      editor.commands.focus()

      // Scroll the selection into view
      const { selection } = editor.state
      const domAtPos = editor.view.domAtPos(selection.from)
      const el = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [editor]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {annotations.length === 0 ? (
          <EmptyState />
        ) : visibleAnnotations.length === 0 ? (
          <FilteredEmptyState onShowAll={onShowAll} />
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <DateGroup
                key={group.label}
                label={group.label}
                annotations={group.annotations}
                onJump={handleJump}
                onRemove={removeAnnotation}
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
        AI-applied edits to this document will appear here. Remove one to clear its
        AI-authored marking — the text stays.
      </p>
    </div>
  )
}

/** Shown when the superseded filter is on and every remaining entry is superseded. */
function FilteredEmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2">
      <Filter className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">All edits are superseded</p>
      <button
        onClick={onShowAll}
        className="text-[10px] text-muted-foreground/80 underline-offset-2 hover:underline"
      >
        Show all
      </button>
    </div>
  )
}

interface DateGroupProps {
  label: string
  annotations: AIAnnotation[]
  onJump: (annotation: AIAnnotation) => void
  onRemove: (id: string) => void
}

function DateGroup({ label, annotations, onJump, onRemove }: DateGroupProps) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 sticky top-0 bg-background z-10 border-b border-border/40">
        {label}
      </div>
      <div className="divide-y divide-border/30">
        {annotations.map((annotation) => (
          <HistoryEntryRow
            key={annotation.id}
            annotation={annotation}
            onJump={onJump}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  )
}

interface HistoryEntryRowProps {
  annotation: AIAnnotation
  onJump: (annotation: AIAnnotation) => void
  onRemove: (id: string) => void
}

function HistoryEntryRow({ annotation, onJump, onRemove }: HistoryEntryRowProps) {
  const snippet = annotation.content.slice(0, 200).replace(/\n/g, ' ')
  const isLong = annotation.content.length > 200
  const detached = annotation.detached === true

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onJump(annotation)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onJump(annotation)
        }
      }}
      title={detached ? 'This edit was later replaced — history record only' : 'Jump to in document'}
      className={cn(
        'group px-4 py-3 hover:bg-muted/40 transition-colors focus:outline-none focus:bg-muted/40',
        detached ? 'opacity-60 cursor-default' : 'cursor-pointer'
      )}
    >
      {/* Meta row: type badge · model · age · jump/remove */}
      <div className="flex items-center gap-2 mb-2">
        <TypeBadge type={annotation.type} />
        {detached && (
          <span
            data-testid="annotation-detached-badge"
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider bg-muted text-muted-foreground"
          >
            superseded
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {formatModelName(annotation.provenance.model)}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">
          {formatAge(annotation.createdAt)}
        </span>
        {!detached && (
          <Crosshair
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-primary/60 group-hover:text-primary transition-colors"
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(annotation.id)
              }}
              className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-destructive transition-all"
              aria-label="Remove AI marking"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove AI marking (keeps the text)</TooltipContent>
        </Tooltip>
      </div>

      {/* Title: the edited content */}
      <p className="text-[15px] leading-snug text-foreground break-words line-clamp-2">
        {snippet}
        {isLong && <span className="text-muted-foreground/50">…</span>}
      </p>

      {/* Explanation */}
      {annotation.explanation && (
        <p className="mt-1.5 text-xs italic text-muted-foreground leading-snug line-clamp-2">
          {annotation.explanation}
        </p>
      )}
    </div>
  )
}

function TypeBadge({ type }: { type: AnnotationType }) {
  const palette =
    type === 'insertion'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : type === 'deletion'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
  const symbol = type === 'insertion' ? '+' : type === 'deletion' ? '−' : '~'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        palette
      )}
    >
      {symbol} {type}
    </span>
  )
}

/**
 * Footer: toggle AI annotation visibility in the editor. Shares a single source of
 * truth with the toolbar's "Hide AI annotations" button (editorStore.annotationsVisible)
 * and mirrors its Eye/EyeOff icon + active-filled state, so the two controls stay in sync.
 */
function AnnotationVisibilityFooter() {
  const annotationsVisible = useEditorStore((s) => s.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((s) => s.toggleAnnotationsVisible)

  return (
    <div className="border-t border-border px-3 py-2 flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">
        Annotations in editor
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleAnnotationsVisible}
            aria-pressed={annotationsVisible}
            aria-label={annotationsVisible ? 'Hide AI annotations' : 'Show AI annotations'}
            className={cn(
              'flex items-center justify-center h-6 w-6 rounded transition-colors',
              annotationsVisible
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {annotationsVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{annotationsVisible ? 'Hide' : 'Show'} AI annotations</TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

interface AnnotationDateGroup {
  label: string
  annotations: AIAnnotation[]
}

/** Group annotations by calendar day (newest-first input → newest-first groups). */
function groupAnnotationsByDate(annotations: AIAnnotation[]): AnnotationDateGroup[] {
  const groups = new Map<string, AnnotationDateGroup>()
  for (const annotation of annotations) {
    const label = formatGroupLabel(annotation.createdAt)
    if (!groups.has(label)) groups.set(label, { label, annotations: [] })
    groups.get(label)!.annotations.push(annotation)
  }
  return Array.from(groups.values())
}

function formatGroupLabel(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)

  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((nowMidnight.getTime() - dateMidnight.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined })
}

/**
 * Compact display name for a model string.
 * e.g. "claude-sonnet-4-6" → "Sonnet 4.6", "claude-haiku-4-5-20251001" → "Haiku 4.5",
 * "external" → "External", "Imported" → "Imported".
 * Treats the first token as the name (title-cased) and joins the remaining
 * version tokens with dots, after dropping any trailing date stamp.
 */
function formatModelName(model: string): string {
  if (!model || model === 'external') return 'External'
  const tokens = model
    .replace(/^claude[-/]?/, '')
    .replace(/[-\s]?\d{6,}$/, '') // drop a trailing date stamp (e.g. -20251001)
    .split('-')
    .filter(Boolean)
  if (tokens.length === 0) return model
  const name = tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1)
  const version = tokens.slice(1).join('.')
  return version ? `${name} ${version}` : name
}
