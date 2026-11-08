/**
 * AI Edits History Panel (Activity)
 *
 * A live view of the AI authorship annotations and comment threads on the
 * current document. Annotations derive from the active document's state
 * (the annotations plugin, #1146); comment activity (open / pending /
 * resolved threads + replies) from the same state's comment threads plugin
 * (#1147). Redesigned per the Claude Design "Comment Threads" handoff:
 * status-badged cards, expand/collapse, avatar reply previews, resolved threads
 * shown greyed (click to brighten for review), and a multi-category filter that
 * toggles any item type (open/pending/resolved threads, current/superseded
 * edits) on or off.
 *
 * Surface: rendered inside the chat sidebar when the user selects the Activity
 * tab in the ChatPanel header. The filter lives in that header; this panel
 * receives the resulting ActivityFilter as a prop.
 */

import { useCallback, useMemo, useState } from 'react'
import { Wand2, Crosshair, X, MessageSquare, CheckCheck, Clock, ArrowUpRight, User, Eye, EyeOff, Maximize2 } from 'lucide-react'
import { selectAnnotations } from '../../extensions/ai-annotations'
import { useActiveSession } from '../../document/useActiveSession'
import { OPEN_COMMENT_EVENT, selectThreads } from '../../extensions/comments'
import { selectReviewLog, type SuggestionHistory } from '../../extensions/review-log'
import { getAISuggestions } from '../../extensions/ai-suggestions'
import type { Actor } from '../../../shared/review/actor'
import { useReviewStore } from '../../stores/reviewStore'
import { useShareStore } from '../../stores/shareStore'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { formatAge } from '../../types/annotations'
import type { AIAnnotation, AnnotationType } from '../../types/annotations'
import type { CommentData, CommentReply } from '../../extensions/comments/types'
import { PROSE_ICONS, IconThumb } from '../../lib/prose-icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { renderMarkdown } from '../chat/ChatMessage'
import { cn } from '../../lib/utils'
import { actorAvatarKind, actorLabel, actorOfComment, actorOfProvenance, isAgentActor } from '../../../shared/review/actor'
import { useSelfName } from '../../hooks/useSelfName'

/** Which activity categories are visible. Every category defaults to shown. */
export interface ActivityFilter {
  openThreads: boolean
  pendingThreads: boolean
  resolvedThreads: boolean
  edits: boolean
  superseded: boolean
  /** Suggestions still waiting for the writer (#1234). */
  pendingSuggestions: boolean
  /** Accepted, rejected and superseded suggestions, from the review log (#1234). */
  decidedSuggestions: boolean
}

export const DEFAULT_ACTIVITY_FILTER: ActivityFilter = {
  openThreads: true,
  pendingThreads: true,
  resolvedThreads: true,
  edits: true,
  superseded: true,
  pendingSuggestions: true,
  decidedSuggestions: true,
}

/** The actor filter's "show everyone" value. Any other value is an actor label. */
export const ALL_ACTORS = ''

// Re-exported for existing importers (e.g. CommentPopover). Source of truth is
// the comments extension module, so chat tool-results can import it without a cycle.
export { OPEN_COMMENT_EVENT }

/**
 * Enter Comment Review (a top-level reviewMode takeover), optionally focused on
 * a thread. The single entry point used by the status-bar comment count, the
 * "Review comments" chip, and the card/popover expand icons. Routing through the
 * review store (rather than a DOM event) makes Comment Review a peer of Quick
 * Review: they share one mode slot, so they toggle cleanly and the App-level
 * panel-open/resize effect treats them identically.
 */
export function requestCommentReview(id?: string): void {
  useReviewStore.getState().enterCommentReview(id)
  // Entering Comment Review counts as "seen" for the ◎ share badge (#769).
  useShareStore.getState().clearUnseenComments()
}

// Unified activity item for the mixed feed
type ActivityItem =
  | { kind: 'annotation'; annotation: AIAnnotation; createdAt: number }
  | { kind: 'comment'; comment: CommentData; createdAt: number }
  | { kind: 'suggestion'; suggestion: SuggestionHistory; createdAt: number }

type ActivitySubject =
  | { kind: 'annotation'; annotation: AIAnnotation }
  | { kind: 'comment'; comment: CommentData }
  | { kind: 'suggestion'; suggestion: SuggestionHistory }

/** Everyone who made or touched an item (#1234): the actor filter matches any of them. */
export function activityActors(item: ActivitySubject): Actor[] {
  if (item.kind === 'annotation') return [actorOfProvenance(item.annotation.provenance.model, item.annotation.provenance.actor)]
  if (item.kind === 'comment') return [actorOfComment(item.comment), ...(item.comment.replies ?? []).map(actorOfComment)]
  const s = item.suggestion
  return [s.actor, ...(s.decidedBy ? [s.decidedBy] : []), ...s.feedback.map((f) => f.actor)]
}

/** A suggestion row's latest moment: its decision, else its last feedback, else its proposal. */
function suggestionMoment(s: SuggestionHistory): number {
  return s.decidedAt ?? s.feedback.at(-1)?.createdAt ?? s.createdAt
}

interface ActivityDateGroup {
  label: string
  items: ActivityItem[]
}

/** Classify a comment into one of the three thread categories. */
function commentCategory(c: CommentData): 'open' | 'pending' | 'resolved' {
  if (c.resolved) return 'resolved'
  return (c.replies?.length ?? 0) > 0 ? 'open' : 'pending'
}

/** Whether an item passes the active filter. Exported so the tab badge count
 *  in ChatPanel can use the same predicate. */
export function activityItemVisible(
  item: ActivitySubject,
  f: ActivityFilter,
  actor: { label: string; selfName: string } = { label: ALL_ACTORS, selfName: '' }
): boolean {
  if (actor.label !== ALL_ACTORS && !activityActors(item).some((a) => actorLabel(a, { selfName: actor.selfName }) === actor.label)) {
    return false
  }
  if (item.kind === 'annotation') {
    return item.annotation.detached ? f.superseded : f.edits
  }
  if (item.kind === 'suggestion') {
    return item.suggestion.status === 'pending' ? f.pendingSuggestions : f.decidedSuggestions
  }
  const cat = commentCategory(item.comment)
  return cat === 'open' ? f.openThreads : cat === 'pending' ? f.pendingThreads : f.resolvedThreads
}

interface AIEditsHistoryPanelProps {
  /** Active category filter. Owned by ChatPanel's tab header. */
  filter: ActivityFilter
  /** Active actor filter: an actor label, or ALL_ACTORS (#1234). */
  actorFilter: string
  /** Reset the filter to show everything (wired to the filtered-empty CTA). */
  onShowAll: () => void
  /** Enter comment Review mode focused on a specific thread (the expand icon). */
  onReviewThread: (id: string) => void
}

export function AIEditsHistoryPanel({ filter, actorFilter, onShowAll, onReviewThread }: AIEditsHistoryPanelProps) {
  const annotations = useActiveSession(selectAnnotations)
  const pendingComments = useActiveSession(selectThreads)
  const reviewLog = useActiveSession(selectReviewLog)
  const editor = useEditorInstanceStore((s) => s.editor)
  const selfName = useSelfName()

  // Build the unified, filtered feed (newest-first).
  const items: ActivityItem[] = useMemo(() => {
    const actor = { label: actorFilter, selfName }
    const annotationItems: ActivityItem[] = annotations
      .filter((a) => activityItemVisible({ kind: 'annotation', annotation: a }, filter, actor))
      .map((a) => ({ kind: 'annotation', annotation: a, createdAt: a.createdAt }))
    const suggestionItems: ActivityItem[] = reviewLog.suggestions
      .filter((sg) => activityItemVisible({ kind: 'suggestion', suggestion: sg }, filter, actor))
      .map((sg) => ({ kind: 'suggestion', suggestion: sg, createdAt: suggestionMoment(sg) }))
    const commentItems: ActivityItem[] = pendingComments
      .filter((c) => activityItemVisible({ kind: 'comment', comment: c }, filter, actor))
      .map((c) => ({
        kind: 'comment',
        comment: c,
        createdAt:
          c.replies && c.replies.length > 0
            ? c.replies[c.replies.length - 1].createdAt
            : c.createdAt,
      }))
    return [...annotationItems, ...suggestionItems, ...commentItems].sort((a, b) => b.createdAt - a.createdAt)
  }, [annotations, pendingComments, reviewLog, filter, actorFilter, selfName])

  const hasAnyActivity = annotations.length > 0 || pendingComments.length > 0 || reviewLog.suggestions.length > 0
  const nothingVisible = items.length === 0
  const groups = useMemo(() => groupActivityByDate(items), [items])

  const handleJump = useCallback(
    (annotation: AIAnnotation) => {
      if (!editor) return
      if (annotation.detached) return // detached entries are history-only (#674)
      editor.commands.setTextSelection({ from: annotation.from, to: annotation.to })
      editor.commands.focus()
      const { selection } = editor.state
      const domAtPos = editor.view.domAtPos(selection.from)
      const el = domAtPos.node instanceof Element ? domAtPos.node : domAtPos.node.parentElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
    [editor]
  )

  // A pending suggestion opens Quick Review on itself (#854's card hand-off).
  const handleReviewSuggestion = useCallback(
    (id: string) => {
      if (!editor) return
      const index = getAISuggestions(editor).findIndex((sg) => sg.id === id)
      if (index === -1) return
      const store = useReviewStore.getState()
      store.setReviewMode('quick')
      store.setCurrentSuggestionIndex(index)
    },
    [editor]
  )

  const handleRemoveAnnotation = useCallback(
    (id: string) => {
      editor?.commands.removeAIAnnotation(id)
    },
    [editor]
  )

  // One transaction drops the thread and its marks; a shared thread comes
  // off the shared page too (#903) through the push the transition records.
  const handleRemoveComment = useCallback(
    (id: string) => {
      editor?.commands.removeThread(id)
    },
    [editor]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasAnyActivity ? (
          <EmptyState />
        ) : nothingVisible ? (
          <FilteredEmptyState onShowAll={onShowAll} />
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <ActivityDateGroupView
                key={group.label}
                label={group.label}
                items={group.items}
                onJumpAnnotation={handleJump}
                onRemoveAnnotation={handleRemoveAnnotation}
                onRemoveComment={handleRemoveComment}
                onReviewThread={onReviewThread}
                onReviewSuggestion={handleReviewSuggestion}
              />
            ))}
          </div>
        )}
      </div>
      <AnnotationVisibilityFooter />
    </div>
  )
}

// ─── Empty states ───────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Wand2 className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">No activity yet</p>
      <p className="max-w-[180px] text-[10px] leading-relaxed text-muted-foreground/60">
        AI edits and comment thread activity will appear here.
      </p>
    </div>
  )
}

function FilteredEmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">Everything is filtered out</p>
      <button
        onClick={onShowAll}
        className="text-[10px] text-muted-foreground/80 underline-offset-2 hover:underline"
      >
        Show all
      </button>
    </div>
  )
}

// ─── Group ──────────────────────────────────────────────────────────────────

interface ActivityDateGroupProps {
  label: string
  items: ActivityItem[]
  onJumpAnnotation: (annotation: AIAnnotation) => void
  onRemoveAnnotation: (id: string) => void
  onRemoveComment: (id: string) => void
  onReviewThread: (id: string) => void
  onReviewSuggestion: (id: string) => void
}

function ActivityDateGroupView({
  label,
  items,
  onJumpAnnotation,
  onRemoveAnnotation,
  onRemoveComment,
  onReviewThread,
  onReviewSuggestion,
}: ActivityDateGroupProps) {
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border/40 bg-background px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      {/* Contained cards with inter-card gaps (the panel bg shows through) —
          hairline separators disappeared on the dark surface. 12px side gutter. */}
      <div className="flex flex-col gap-[9px] px-3 pb-2 pt-1.5">
        {items.map((item) =>
          item.kind === 'annotation' ? (
            <HistoryEntryRow
              key={item.annotation.id}
              annotation={item.annotation}
              onJump={onJumpAnnotation}
              onRemove={onRemoveAnnotation}
            />
          ) : item.kind === 'suggestion' ? (
            <SuggestionActivityRow
              key={`suggestion-${item.suggestion.id}`}
              suggestion={item.suggestion}
              onReview={onReviewSuggestion}
            />
          ) : (
            <CommentActivityRow
              key={item.comment.id}
              comment={item.comment}
              onRemove={onRemoveComment}
              onReview={onReviewThread}
            />
          )
        )}
      </div>
    </div>
  )
}

// ─── Suggestion row (#1234) ─────────────────────────────────────────────────

const SUGGESTION_STATUS: Record<SuggestionHistory['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  accepted: { label: 'Accepted', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  rejected: { label: 'Rejected', className: 'bg-muted text-muted-foreground' },
  superseded: { label: 'Superseded', className: 'bg-muted text-muted-foreground' },
}

function SuggestionActivityRow({ suggestion, onReview }: { suggestion: SuggestionHistory; onReview: (id: string) => void }) {
  const selfName = useSelfName()
  const [expanded, setExpanded] = useState(false)
  const status = SUGGESTION_STATUS[suggestion.status]
  const pending = suggestion.status === 'pending'
  const name = (a: Actor) => actorLabel(a, { selfName })
  return (
    <div
      data-testid="suggestion-activity-row"
      data-suggestion-id={suggestion.id}
      data-status={suggestion.status}
      onClick={() => (pending ? onReview(suggestion.id) : setExpanded((v) => !v))}
      className={cn(
        'group cursor-pointer rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 transition-colors hover:bg-accent/40',
        !pending && 'opacity-75 hover:opacity-100'
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span data-testid="suggestion-status" className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider', status.className)}>
          {status.label}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground" data-testid="suggestion-row-actor">
          {name(suggestion.actor)}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">{formatAge(suggestionMoment(suggestion))}</span>
      </div>
      <p className="line-clamp-2 text-[12.5px] leading-relaxed text-foreground/60 line-through decoration-foreground/30">
        {suggestion.originalText}
      </p>
      <p className="line-clamp-3 text-[12.5px] leading-relaxed text-foreground/90">{suggestion.suggestedText}</p>
      {suggestion.decidedBy && suggestion.status !== 'pending' && (
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="suggestion-decided-by">
          {suggestion.status === 'superseded' ? 'Revised by' : `${status.label} by`} {name(suggestion.decidedBy)}
        </p>
      )}
      {suggestion.feedback.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <MessageSquare className="h-3 w-3" />
          {suggestion.feedback.length} {suggestion.feedback.length === 1 ? 'reply' : 'replies'}
        </button>
      )}
      {expanded && (
        <div className="mt-2 flex flex-col gap-2" data-testid="suggestion-feedback">
          {suggestion.explanation && <p className="text-[11.5px] italic text-muted-foreground">{suggestion.explanation}</p>}
          {suggestion.feedback.map((f) => (
            <FullRow key={f.id} kind={actorAvatarKind(f.actor)} name={name(f.actor)} time={formatAge(f.createdAt)} text={f.text} markdown={isAgentActor(f.actor)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Annotation row (kept; aligned styling) ─────────────────────────────────

interface HistoryEntryRowProps {
  annotation: AIAnnotation
  onJump: (annotation: AIAnnotation) => void
  onRemove: (id: string) => void
}

function HistoryEntryRow({ annotation, onJump, onRemove }: HistoryEntryRowProps) {
  const selfName = useSelfName()
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
        'group rounded-[10px] border border-border bg-muted/50 px-3 py-3 transition-colors hover:border-muted-foreground/30 hover:bg-muted/85 focus:border-muted-foreground/40 focus:outline-hidden',
        detached ? 'cursor-default opacity-60 hover:opacity-100' : 'cursor-pointer'
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <TypeBadge type={annotation.type} />
        {detached && (
          <span
            data-testid="annotation-detached-badge"
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider bg-muted text-muted-foreground"
          >
            superseded
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground" data-testid="annotation-actor">
          {actorLabel(actorOfProvenance(annotation.provenance.model, annotation.provenance.actor), { selfName })}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">{formatAge(annotation.createdAt)}</span>
        {!detached && (
          <Crosshair aria-hidden className="h-4 w-4 shrink-0 text-primary/60 transition-colors group-hover:text-primary" />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(annotation.id)
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
              aria-label="Remove AI marking"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove AI marking (keeps the text)</TooltipContent>
        </Tooltip>
      </div>
      <p className="line-clamp-2 wrap-break-word text-[15px] leading-snug text-foreground">
        {snippet}
        {isLong && <span className="text-muted-foreground/50">…</span>}
      </p>
      {annotation.explanation && (
        <p className="mt-1.5 line-clamp-2 text-xs italic leading-snug text-muted-foreground">{annotation.explanation}</p>
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

// ─── Comment thread card ────────────────────────────────────────────────────

interface CommentActivityRowProps {
  comment: CommentData
  onRemove: (id: string) => void
  onReview: (id: string) => void
}

function CommentActivityRow({ comment, onRemove, onReview }: CommentActivityRowProps) {
  const selfName = useSelfName()
  const [expanded, setExpanded] = useState(false)
  const replies = comment.replies ?? []
  const category = commentCategory(comment)
  const isResolved = category === 'resolved'
  const last = replies.length > 0 ? replies[replies.length - 1] : null
  const hasMark = !isResolved // resolved threads remove their mark from the doc
  // The top-level comment may be agent-authored (left via add_comment); name
  // every actor (#1232).
  const commentActor = actorOfComment(comment)
  const commentIsAI = isAgentActor(commentActor)
  const lastActor = last ? actorOfComment(last) : null

  const openInDocument = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent(OPEN_COMMENT_EVENT, { detail: { id: comment.id } }))
  }

  return (
    <div
      data-testid="comment-activity-row"
      onClick={() => setExpanded((v) => !v)}
      className={cn(
        'group cursor-pointer rounded-[10px] border border-border bg-muted/50 px-3 py-3 transition-all hover:border-muted-foreground/30 hover:bg-muted/85',
        // Resolved threads read quiet until clicked open (then full brightness).
        isResolved && !expanded && 'opacity-60 hover:opacity-100'
      )}
    >
      {/* Badge + time + review + remove */}
      <div className="mb-2 flex items-center gap-2">
        <ThreadBadge category={category} />
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">{formatAge(comment.createdAt)}</span>
        {!isResolved && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onReview(comment.id)
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-violet-600 group-hover:opacity-100 dark:hover:text-violet-400"
                aria-label="Review this thread"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Open in Review</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(comment.id)
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
              aria-label="Remove comment thread"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove comment thread</TooltipContent>
        </Tooltip>
      </div>

      {/* Quote */}
      {comment.markedText?.trim() && (
        <p className="mb-2 line-clamp-2 text-[13.5px] italic leading-snug text-foreground/80">
          “{comment.markedText.trim()}”
        </p>
      )}

      {!expanded ? (
        // Collapsed: comment (1 line) + last reply / awaiting (2 lines)
        <div className="flex flex-col gap-1.5">
          <PreviewRow kind={commentIsAI ? 'ai' : 'user'} text={comment.comment} clamp={1} markdown={commentIsAI} />
          {last ? (
            <PreviewRow kind={actorAvatarKind(lastActor!)} text={last.text} clamp={2} markdown={isAgentActor(lastActor!)} />
          ) : !isResolved ? (
            <PreviewRow kind="pending" text="Awaiting reply…" clamp={1} />
          ) : null}
        </div>
      ) : (
        // Expanded: full thread + open-in-document
        <div className="flex flex-col gap-2.5">
          <FullRow
            kind={commentIsAI ? 'ai' : 'user'}
            name={actorLabel(commentActor, { selfName })}
            time={formatAge(comment.createdAt)}
            text={comment.comment}
            markdown={commentIsAI}
          />
          {replies.map((r) => {
            const actor = actorOfComment(r)
            return (
              <FullRow
                key={r.id}
                kind={actorAvatarKind(actor)}
                name={actorLabel(actor, { selfName })}
                time={formatAge(r.createdAt)}
                text={r.text}
                markdown={isAgentActor(actor)}
              />
            )
          })}
          {hasMark && (
            <button
              onClick={openInDocument}
              className="inline-flex items-center gap-1 self-start text-[11.5px] font-medium text-violet-600 hover:underline dark:text-violet-400"
            >
              Open in document
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ThreadBadge({ category }: { category: 'open' | 'pending' | 'resolved' }) {
  if (category === 'resolved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/12 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        <CheckCheck className="h-3 w-3" />
        Resolved
      </span>
    )
  }
  if (category === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-pink-500/12 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-pink-600 dark:text-pink-400">
        <Clock className="h-3 w-3" />
        Pending
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/12 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">
      <MessageSquare className="h-3 w-3" />
      Thread
    </span>
  )
}

// ─── Avatars + rows ─────────────────────────────────────────────────────────

function MiniAvatar({ kind }: { kind: 'ai' | 'user' | 'pending' }) {
  const iconId = useSettingsStore((s) => s.settings.appearance.icon)
  if (kind === 'ai') {
    const selected = PROSE_ICONS.find((i) => i.id === iconId) ?? PROSE_ICONS[0]
    return (
      <span className="mt-px shrink-0">
        <IconThumb Component={selected.Component} size={18} />
      </span>
    )
  }
  if (kind === 'pending') {
    return (
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-pink-500/15 text-pink-600 dark:text-pink-400">
        <Clock className="h-2.5 w-2.5" />
      </span>
    )
  }
  return (
    <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground">
      <User className="h-2.5 w-2.5" />
    </span>
  )
}

function PreviewRow({
  kind,
  text,
  clamp,
  markdown,
}: {
  kind: 'ai' | 'user' | 'pending'
  text: string
  clamp: 1 | 2
  markdown?: boolean
}) {
  const editor = useEditorInstanceStore((s) => s.editor)
  return (
    <div className="flex items-start gap-2">
      <MiniAvatar kind={kind} />
      <div
        className={cn(
          'min-w-0 text-[12.5px] leading-snug',
          kind === 'pending' ? 'text-muted-foreground/80 italic' : 'text-foreground/75',
          clamp === 1 ? 'line-clamp-1' : 'line-clamp-2'
        )}
      >
        {markdown ? <span className="**:inline">{renderMarkdown(text, editor)}</span> : text}
      </div>
    </div>
  )
}

function FullRow({
  kind,
  name,
  time,
  text,
  markdown,
}: {
  kind: 'ai' | 'user'
  name: string
  time: string
  text: string
  markdown?: boolean
}) {
  const editor = useEditorInstanceStore((s) => s.editor)
  return (
    <div className="flex items-start gap-2">
      <MiniAvatar kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] text-muted-foreground">
          <span data-testid="activity-actor">{name}</span> · {time}
        </div>
        {markdown ? (
          <div className="prose-chat wrap-break-word text-[12.5px] leading-relaxed text-foreground/85">
            {renderMarkdown(text, editor)}
          </div>
        ) : (
          <div className="whitespace-pre-wrap wrap-break-word text-[12.5px] leading-relaxed text-foreground/85">{text}</div>
        )}
      </div>
    </div>
  )
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function AnnotationVisibilityFooter() {
  const annotationsVisible = useEditorStore((s) => s.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((s) => s.toggleAnnotationsVisible)
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2">
      <span className="text-[10px] text-muted-foreground">Annotations in editor</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleAnnotationsVisible}
            aria-pressed={annotationsVisible}
            aria-label={annotationsVisible ? 'Hide AI annotations' : 'Show AI annotations'}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition-colors',
              annotationsVisible ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function groupActivityByDate(items: ActivityItem[]): ActivityDateGroup[] {
  const groups = new Map<string, ActivityDateGroup>()
  for (const item of items) {
    const label = formatGroupLabel(item.createdAt)
    if (!groups.has(label)) groups.set(label, { label, items: [] })
    groups.get(label)!.items.push(item)
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
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined })
}
