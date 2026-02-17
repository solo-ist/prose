import { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useReviewStore } from '../../stores/reviewStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { computeWordDiff, type DiffSegment } from '../../lib/diffUtils'
import { cn } from '../../lib/utils'

/**
 * Card-based quick review component.
 * Shows one suggestion at a time with accept/reject buttons,
 * word-level diff highlighting, and auto-scroll to the current suggestion.
 */
export function QuickReviewPanel() {
  const editor = useEditorInstanceStore((state) => state.editor)
  const { currentSuggestionIndex, setCurrentSuggestionIndex, setReviewMode } = useReviewStore()
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [animating, setAnimating] = useState(false)

  const suggestions = useMemo(() => {
    if (!editor) return []
    return getAISuggestions(editor)
  }, [editor, editor?.state.doc])

  const total = suggestions.length
  const current = suggestions[currentSuggestionIndex]

  // Auto-dismiss when no suggestions remain
  useEffect(() => {
    if (total === 0) {
      setReviewMode(null)
    }
  }, [total, setReviewMode])

  // Scroll editor to current suggestion
  useEffect(() => {
    if (!editor || !current) return
    editor.commands.setTextSelection(current.from)
    editor.commands.scrollIntoView()
  }, [editor, current])

  const animateTransition = useCallback((dir: 'next' | 'prev', callback: () => void) => {
    setDirection(dir)
    setAnimating(true)
    setTimeout(() => {
      callback()
      setAnimating(false)
    }, 150)
  }, [])

  const handleAccept = useCallback(() => {
    if (!editor || !current) return
    animateTransition('next', () => {
      editor.commands.acceptAISuggestion(current.id)
      // After accepting, the suggestions list shrinks. Re-read and clamp index.
      const remaining = getAISuggestions(editor)
      if (remaining.length === 0) {
        setReviewMode(null)
      } else {
        setCurrentSuggestionIndex(Math.min(currentSuggestionIndex, remaining.length - 1))
      }
    })
  }, [editor, current, currentSuggestionIndex, animateTransition, setCurrentSuggestionIndex, setReviewMode])

  const handleReject = useCallback(() => {
    if (!editor || !current) return
    animateTransition('next', () => {
      editor.commands.rejectAISuggestion(current.id)
      const remaining = getAISuggestions(editor)
      if (remaining.length === 0) {
        setReviewMode(null)
      } else {
        setCurrentSuggestionIndex(Math.min(currentSuggestionIndex, remaining.length - 1))
      }
    })
  }, [editor, current, currentSuggestionIndex, animateTransition, setCurrentSuggestionIndex, setReviewMode])

  const goNext = useCallback(() => {
    if (currentSuggestionIndex < total - 1) {
      animateTransition('next', () => setCurrentSuggestionIndex(currentSuggestionIndex + 1))
    }
  }, [currentSuggestionIndex, total, animateTransition, setCurrentSuggestionIndex])

  const goPrev = useCallback(() => {
    if (currentSuggestionIndex > 0) {
      animateTransition('prev', () => setCurrentSuggestionIndex(currentSuggestionIndex - 1))
    }
  }, [currentSuggestionIndex, animateTransition, setCurrentSuggestionIndex])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if focused in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          goNext()
          break
        case 'ArrowLeft':
          e.preventDefault()
          goPrev()
          break
        case 'Enter':
          e.preventDefault()
          handleAccept()
          break
        case 'Backspace':
          e.preventDefault()
          handleReject()
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goNext, goPrev, handleAccept, handleReject])

  if (!current) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4">
        No suggestions to review.
      </div>
    )
  }

  const diff = computeWordDiff(current.originalText, current.suggestedText)

  return (
    <div className="flex flex-col h-full">
      {/* Progress */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground border-b border-border">
        <span>{currentSuggestionIndex + 1} of {total} suggestions</span>
        <div className="flex items-center gap-1">
          <button
            onClick={goPrev}
            disabled={currentSuggestionIndex === 0}
            className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous suggestion"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={goNext}
            disabled={currentSuggestionIndex === total - 1}
            className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next suggestion"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 overflow-y-auto p-4">
        <div
          className={cn(
            'transition-all duration-150',
            animating && direction === 'next' && 'opacity-0 -translate-x-2',
            animating && direction === 'prev' && 'opacity-0 translate-x-2',
            !animating && 'opacity-100 translate-x-0'
          )}
        >
          {/* Original text */}
          <div className="mb-3">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Original</div>
            <div className="text-sm leading-relaxed rounded-md bg-muted/30 p-3 border border-border">
              <DiffText segments={diff.old} mode="old" />
            </div>
          </div>

          {/* Suggested text */}
          <div className="mb-3">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Suggested</div>
            <div className="text-sm leading-relaxed rounded-md bg-muted/30 p-3 border border-border">
              <DiffText segments={diff.new} mode="new" />
            </div>
          </div>

          {/* Explanation */}
          {current.explanation && (
            <div className="text-xs text-muted-foreground italic leading-relaxed">
              {current.explanation}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
        <button
          onClick={handleReject}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
        <button
          onClick={handleAccept}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Check className="h-3.5 w-3.5" />
          Accept
        </button>
      </div>

      {/* Keyboard hints */}
      <div className="px-4 pb-2 text-[10px] text-muted-foreground/50 text-center">
        Enter accept / Backspace reject / Arrows navigate
      </div>
    </div>
  )
}

/** Render diff segments with word-level highlighting */
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
