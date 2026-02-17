import { useState, useMemo, useCallback } from 'react'
import { Check, X, CheckCheck, XCircle } from 'lucide-react'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useReviewStore } from '../../stores/reviewStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { computeWordDiff, type DiffSegment } from '../../lib/diffUtils'
import type { AISuggestionData } from '../../extensions/ai-suggestions/types'
import { cn } from '../../lib/utils'

/**
 * Side-by-side diff panel showing all suggestions as diff hunks.
 * Each hunk has original (left) and suggested (right) text with word-level highlighting,
 * plus individual and bulk accept/reject controls.
 */
export function SideBySideDiffPanel() {
  const editor = useEditorInstanceStore((state) => state.editor)
  const setReviewMode = useReviewStore((s) => s.setReviewMode)
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())

  const suggestions = useMemo(() => {
    if (!editor) return []
    return getAISuggestions(editor)
  }, [editor, editor?.state.doc])

  const total = suggestions.length
  const reviewedCount = reviewed.size

  const markReviewed = useCallback((id: string) => {
    setReviewed(prev => new Set(prev).add(id))
  }, [])

  const handleAccept = useCallback((suggestion: AISuggestionData) => {
    if (!editor) return
    editor.commands.acceptAISuggestion(suggestion.id)
    markReviewed(suggestion.id)
  }, [editor, markReviewed])

  const handleReject = useCallback((suggestion: AISuggestionData) => {
    if (!editor) return
    editor.commands.rejectAISuggestion(suggestion.id)
    markReviewed(suggestion.id)
  }, [editor, markReviewed])

  const handleAcceptAll = useCallback(() => {
    if (!editor) return
    // Process in reverse order to avoid position shifting issues
    const current = getAISuggestions(editor)
    for (let i = current.length - 1; i >= 0; i--) {
      editor.commands.acceptAISuggestion(current[i].id)
    }
    setReviewMode(null)
  }, [editor, setReviewMode])

  const handleRejectAll = useCallback(() => {
    if (!editor) return
    const current = getAISuggestions(editor)
    for (let i = current.length - 1; i >= 0; i--) {
      editor.commands.rejectAISuggestion(current[i].id)
    }
    setReviewMode(null)
  }, [editor, setReviewMode])

  const scrollToSuggestion = useCallback((suggestion: AISuggestionData) => {
    if (!editor) return
    editor.commands.setTextSelection(suggestion.from)
    editor.commands.scrollIntoView()
  }, [editor])

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4">
        No suggestions to review.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with bulk actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {reviewedCount} of {total} reviewed
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRejectAll}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
          >
            <XCircle className="h-3 w-3" />
            Reject All
          </button>
          <button
            onClick={handleAcceptAll}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <CheckCheck className="h-3 w-3" />
            Accept All
          </button>
        </div>
      </div>

      {/* Scrollable hunk list */}
      <div className="flex-1 overflow-y-auto">
        {suggestions.map((suggestion) => (
          <DiffHunk
            key={suggestion.id}
            suggestion={suggestion}
            onAccept={() => handleAccept(suggestion)}
            onReject={() => handleReject(suggestion)}
            onScrollTo={() => scrollToSuggestion(suggestion)}
          />
        ))}
      </div>
    </div>
  )
}

function DiffHunk({
  suggestion,
  onAccept,
  onReject,
  onScrollTo,
}: {
  suggestion: AISuggestionData
  onAccept: () => void
  onReject: () => void
  onScrollTo: () => void
}) {
  const diff = useMemo(
    () => computeWordDiff(suggestion.originalText, suggestion.suggestedText),
    [suggestion.originalText, suggestion.suggestedText]
  )

  // Dynamic context: show a snippet of surrounding text via explanation
  return (
    <div
      className="border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={onScrollTo}
    >
      {/* Explanation header */}
      {suggestion.explanation && (
        <div className="px-4 pt-3 text-xs text-muted-foreground italic">
          {suggestion.explanation}
        </div>
      )}

      {/* Two-column diff */}
      <div className="grid grid-cols-2 gap-0 px-4 py-3">
        {/* Original */}
        <div className="pr-2 border-r border-border">
          <div className="text-[10px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">Original</div>
          <div className="text-sm leading-relaxed">
            <DiffText segments={diff.old} mode="old" />
          </div>
        </div>

        {/* Suggested */}
        <div className="pl-2">
          <div className="text-[10px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">Suggested</div>
          <div className="text-sm leading-relaxed">
            <DiffText segments={diff.new} mode="new" />
          </div>
        </div>
      </div>

      {/* Per-hunk actions */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          onClick={(e) => { e.stopPropagation(); onReject() }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
        >
          <X className="h-3 w-3" />
          Reject
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAccept() }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Check className="h-3 w-3" />
          Accept
        </button>
      </div>
    </div>
  )
}

function DiffText({ segments, mode }: { segments: DiffSegment[]; mode: 'old' | 'new' }) {
  return (
    <span>
      {segments.map((seg, i) => {
        if (mode === 'old' && seg.type === 'removed') {
          return (
            <span
              key={i}
              className="bg-red-500/15 text-red-700 dark:text-red-400 line-through rounded-sm px-0.5"
            >
              {seg.text}
            </span>
          )
        }
        if (mode === 'new' && seg.type === 'added') {
          return (
            <span
              key={i}
              className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-sm px-0.5"
            >
              {seg.text}
            </span>
          )
        }
        return <span key={i}>{seg.text}</span>
      })}
    </span>
  )
}
