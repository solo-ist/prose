import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, X, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useReviewStore, useCurrentSuggestionIndex } from '../../stores/reviewStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { computeWordDiff, scrollSelectionIntoCenter, type DiffSegment } from '../../lib/diffUtils'
import type { AISuggestionData } from '../../extensions/ai-suggestions/types'
import { cn } from '../../lib/utils'

/**
 * Card-based quick review component.
 * Shows one suggestion at a time with accept/reject buttons,
 * word-level diff highlighting, and auto-scroll to the current suggestion.
 */
export function QuickReviewPanel() {
  const editor = useEditorInstanceStore((state) => state.editor)
  const currentSuggestionIndex = useCurrentSuggestionIndex()
  const setCurrentSuggestionIndex = useReviewStore((s) => s.setCurrentSuggestionIndex)
  const setReviewMode = useReviewStore((s) => s.setReviewMode)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [animating, setAnimating] = useState(false)
  const [feedbackInput, setFeedbackInput] = useState('')
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null)
  const [suggestions, setSuggestions] = useState<AISuggestionData[]>([])

  // Subscribe to editor transactions for reactive updates (e.g., after setAISuggestionReply)
  useEffect(() => {
    if (!editor) {
      setSuggestions([])
      return
    }
    setSuggestions(getAISuggestions(editor))
    const handler = () => setSuggestions(getAISuggestions(editor))
    editor.on('transaction', handler)
    return () => { editor.off('transaction', handler) }
  }, [editor])

  const total = suggestions.length
  const current = suggestions[currentSuggestionIndex]

  // Scroll editor to current suggestion (centered in viewport)
  // Use current?.id as dep — not the object ref, which changes on every transaction
  useEffect(() => {
    if (!editor || !current) return
    if (!showFeedbackForm) {
      editor.commands.focus()
    }
    editor.commands.setTextSelection(current.from)
    scrollSelectionIntoCenter(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, current?.id])

  // Swipe gesture state
  const dragX = useMotionValue(0)
  const cardRotate = useTransform(dragX, [-200, 0, 200], [-8, 0, 8])
  const cardOpacity = useTransform(dragX, [-200, -100, 0, 100, 200], [0.5, 0.8, 1, 0.8, 0.5])
  // Button color transforms: fade in red/green backgrounds as the user drags
  const rejectBg = useTransform(dragX, [-120, -60, 0], ['rgba(239,68,68,0.25)', 'rgba(239,68,68,0.12)', 'rgba(0,0,0,0)'])
  const rejectBorder = useTransform(dragX, [-120, -60, 0], ['rgba(239,68,68,0.5)', 'rgba(239,68,68,0.25)', 'rgba(0,0,0,0)'])
  const acceptBg = useTransform(dragX, [0, 60, 120], ['rgba(0,0,0,0)', 'rgba(16,185,129,0.12)', 'rgba(16,185,129,0.25)'])
  const acceptBorder = useTransform(dragX, [0, 60, 120], ['rgba(0,0,0,0)', 'rgba(16,185,129,0.25)', 'rgba(16,185,129,0.5)'])
  const SWIPE_THRESHOLD = 100

  const handleAccept = useCallback(() => {
    if (!editor || !current) return
    setDirection('next')
    setAnimating(true)
    setTimeout(() => {
      editor.commands.acceptAISuggestion(current.id)
      const remaining = getAISuggestions(editor)
      if (remaining.length === 0) {
        setReviewMode(null)
      } else {
        setCurrentSuggestionIndex(Math.min(currentSuggestionIndex, remaining.length - 1))
      }
      setAnimating(false)
    }, 150)
  }, [editor, current, currentSuggestionIndex, setCurrentSuggestionIndex, setReviewMode])

  const handleReject = useCallback(() => {
    if (!editor || !current) return
    setDirection('next')
    setAnimating(true)
    setTimeout(() => {
      editor.commands.rejectAISuggestion(current.id)
      const remaining = getAISuggestions(editor)
      if (remaining.length === 0) {
        setReviewMode(null)
      } else {
        setCurrentSuggestionIndex(Math.min(currentSuggestionIndex, remaining.length - 1))
      }
      setAnimating(false)
    }, 150)
  }, [editor, current, currentSuggestionIndex, setCurrentSuggestionIndex, setReviewMode])

  const handleDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > SWIPE_THRESHOLD) {
      handleAccept()
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      handleReject()
    }
  }, [handleAccept, handleReject])

  const goNext = useCallback(() => {
    if (currentSuggestionIndex < total - 1) {
      setDirection('next')
      setAnimating(true)
      setTimeout(() => {
        setCurrentSuggestionIndex(currentSuggestionIndex + 1)
        setAnimating(false)
      }, 150)
    }
  }, [currentSuggestionIndex, total, setCurrentSuggestionIndex])

  const goPrev = useCallback(() => {
    if (currentSuggestionIndex > 0) {
      setDirection('prev')
      setAnimating(true)
      setTimeout(() => {
        setCurrentSuggestionIndex(currentSuggestionIndex - 1)
        setAnimating(false)
      }, 150)
    }
  }, [currentSuggestionIndex, setCurrentSuggestionIndex])

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

  // Auto-close review when all suggestions have been handled
  // (all accepted/rejected = total 0, or all remaining have feedback)
  useEffect(() => {
    if (total === 0) return // handled by accept/reject callbacks
    const allHaveFeedback = suggestions.every((s) => s.userReply && s.userReply.trim() !== '')
    if (allHaveFeedback) {
      setReviewMode(null)
    }
  }, [suggestions, total, setReviewMode])

  // Reset feedback state when navigating to a different suggestion
  useEffect(() => {
    setShowFeedbackForm(false)
    setFeedbackInput(current?.userReply ?? '')
  }, [current?.id])

  // Focus feedback textarea when form opens
  useEffect(() => {
    if (showFeedbackForm && feedbackInputRef.current) {
      feedbackInputRef.current.focus()
    }
  }, [showFeedbackForm])

  const handleSubmitFeedback = useCallback(() => {
    if (!editor || !current || !feedbackInput.trim()) return
    editor.commands.setAISuggestionReply(current.id, feedbackInput.trim())
    setShowFeedbackForm(false)
  }, [editor, current, feedbackInput])

  const handleFeedbackKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmitFeedback()
    }
  }, [handleSubmitFeedback])

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

      {/* Card — draggable area fills all available space */}
      <div className="flex-1 overflow-hidden">
        <motion.div
          key={current.id}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.7}
          onDragEnd={handleDragEnd}
          style={{ x: dragX, rotate: cardRotate, opacity: cardOpacity }}
          initial={{ opacity: 0, x: direction === 'next' ? 30 : -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'h-full overflow-y-auto p-4 cursor-grab active:cursor-grabbing touch-none',
            animating && 'pointer-events-none'
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
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
              {current.explanation}
            </div>
          )}

          {/* Feedback */}
          {showFeedbackForm ? (
            <div className="mt-3 space-y-2" onPointerDownCapture={(e) => e.stopPropagation()}>
              <div className="text-xs font-medium text-muted-foreground">Your feedback</div>
              <textarea
                ref={feedbackInputRef}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                value={feedbackInput}
                onChange={(e) => setFeedbackInput(e.target.value)}
                onKeyDown={handleFeedbackKeyDown}
                placeholder="Tell the AI what to change..."
                rows={2}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSubmitFeedback}
                  disabled={!feedbackInput.trim()}
                  className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
                >
                  Submit
                </button>
                <button
                  onClick={() => setShowFeedbackForm(false)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : current.userReply ? (
            <div className="mt-3 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Your feedback</div>
              <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2 leading-relaxed">
                {current.userReply}
              </div>
              <button
                onClick={() => { setFeedbackInput(current.userReply ?? ''); setShowFeedbackForm(true) }}
                className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
              >
                Edit
              </button>
            </div>
          ) : null}
        </motion.div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
        <motion.button
          onClick={handleReject}
          style={{ backgroundColor: rejectBg, borderColor: rejectBorder }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </motion.button>
        {!showFeedbackForm && !current.userReply && (
          <button
            onClick={() => setShowFeedbackForm(true)}
            className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium border border-border hover:bg-muted transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        )}
        <motion.button
          onClick={handleAccept}
          style={{ backgroundColor: acceptBg, borderColor: acceptBorder }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium border border-border hover:bg-primary/90 transition-colors"
        >
          <Check className="h-3.5 w-3.5" />
          Accept
        </motion.button>
      </div>

      {/* Keyboard hints */}
      <div className="px-4 pb-2 text-[10px] text-muted-foreground/50 text-center">
        Swipe right accept / left reject / Arrows navigate
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
              className="bg-red-500/20 text-red-700 dark:text-red-400 line-through rounded-sm px-0.5"
            >
              {seg.text}
            </span>
          )
        }
        if (mode === 'new' && seg.type === 'added') {
          return (
            <span
              key={i}
              className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-sm px-0.5"
            >
              {seg.text}
            </span>
          )
        }
        return <span key={i} className="opacity-50">{seg.text}</span>
      })}
    </span>
  )
}
