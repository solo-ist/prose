import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, X, ChevronLeft, ChevronRight, MessageSquare, ArrowLeftRight } from 'lucide-react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useReviewStore, useCurrentSuggestionIndex } from '../../stores/reviewStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { computeWordDiff, scrollSelectionIntoCenter, type DiffSegment } from '../../lib/diffUtils'
import type { AISuggestionData } from '../../extensions/ai-suggestions/types'
import { cn } from '../../lib/utils'

/**
 * Card-based quick review component — redesigned (#385).
 *
 * Layout change: accept/reject buttons are now placed ABOVE the diff card,
 * clustering the actionable controls right above the suggestion content
 * (closer to the top-right panel where the review lives). Previously the
 * buttons were at the bottom of the panel, far from both the diff and the
 * navigation header.
 *
 * Navigation (prev/next) stays in the top header row alongside the counter.
 * The diff content is the visual "anchor" — buttons above, explanation +
 * feedback below — so the user's eye travels the minimum distance.
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

  // Subscribe to editor transactions for reactive updates
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
  useEffect(() => {
    if (!editor || !current) return
    if (!showFeedbackForm) {
      editor.commands.focus()
    }
    editor.commands.setTextSelection(current.from)
    scrollSelectionIntoCenter(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, current?.id])

  // Swipe gesture values — drag the card left to reject, right to accept
  const dragX = useMotionValue(0)
  const cardRotate = useTransform(dragX, [-200, 0, 200], [-6, 0, 6])
  const cardOpacity = useTransform(dragX, [-200, -100, 0, 100, 200], [0.5, 0.8, 1, 0.8, 0.5])

  // Reject button lights up red as card is dragged left
  const rejectBg = useTransform(dragX, [-120, -60, 0], ['rgba(239,68,68,0.20)', 'rgba(239,68,68,0.10)', 'rgba(0,0,0,0)'])
  const rejectBorderColor = useTransform(dragX, [-120, -60, 0], ['rgba(239,68,68,0.45)', 'rgba(239,68,68,0.22)', 'rgba(0,0,0,0)'])

  // Accept button lights up green as card is dragged right
  const acceptBg = useTransform(dragX, [0, 60, 120], ['rgba(0,0,0,0)', 'rgba(16,185,129,0.10)', 'rgba(16,185,129,0.20)'])
  const acceptBorderColor = useTransform(dragX, [0, 60, 120], ['rgba(0,0,0,0)', 'rgba(16,185,129,0.22)', 'rgba(16,185,129,0.45)'])

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

  // Auto-close when all suggestions are handled
  useEffect(() => {
    if (total === 0) return
    const allHaveFeedback = suggestions.every((s) => s.userReply && s.userReply.trim() !== '')
    if (allHaveFeedback) {
      setReviewMode(null)
    }
  }, [suggestions, total, setReviewMode])

  // Reset feedback state when navigating
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
      <div className="flex flex-col h-full">
        {/* Keep close button accessible on empty state */}
        <div className="flex items-center justify-between border-b border-border pl-4 pr-2 py-2.5 shrink-0">
          <h2 className="text-sm font-medium">Quick Review</h2>
          <button
            onClick={() => setReviewMode(null)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close review"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground p-4">
          No suggestions to review.
        </div>
      </div>
    )
  }

  const diff = computeWordDiff(current.originalText, current.suggestedText)

  return (
    <div className="flex flex-col h-full">

      {/* ── Row 1: Header — title + navigation + close ────────────────── */}
      {/* All top-of-panel chrome lives here: the review title, counter,   */}
      {/* prev/next navigation, mode cross-link, and close button.         */}
      {/* Keeping close in the header preserves Fitts' Law for dismissal   */}
      {/* (top-right corner). The action row below focuses on accept/reject.*/}
      <div className="flex items-center border-b border-border pl-4 pr-2 py-2.5 shrink-0 gap-2">
        {/* Title + mode cross-link */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="text-sm font-medium shrink-0">Quick Review</h2>
          <button
            onClick={() => setReviewMode('side-by-side')}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors truncate"
          >
            <ArrowLeftRight className="h-3 w-3 shrink-0" />
            <span className="truncate">Full diff</span>
          </button>
        </div>

        {/* Prev / Next navigation */}
        <div className="flex items-center gap-0 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums mr-1.5">
            {currentSuggestionIndex + 1}/{total}
          </span>
          <button
            onClick={goPrev}
            disabled={currentSuggestionIndex === 0}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous suggestion"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={goNext}
            disabled={currentSuggestionIndex === total - 1}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next suggestion"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Close */}
        <button
          onClick={() => setReviewMode(null)}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Close review (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Row 2: Accept / Reject — directly above the diff card ─────── */}
      {/* This is the core of the redesign: the action row lives right above */}
      {/* the suggestion content so the user can read + act without moving   */}
      {/* their eyes/cursor to the bottom of the panel.                      */}
      {/*                                                                     */}
      {/* Hover fix: motion.div carries the MotionValue backgroundColor for  */}
      {/* drag-reactive lighting; the inner <button> uses Tailwind hover      */}
      {/* classes without being overridden by an inline style MotionValue.    */}
      <div className="flex items-stretch gap-2 px-4 pt-3 pb-2 shrink-0">
        <motion.div
          style={{ backgroundColor: rejectBg, borderColor: rejectBorderColor }}
          className="flex-1 rounded-md border border-border"
        >
          <button
            onClick={handleReject}
            className="w-full h-full flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium hover:bg-destructive/10 hover:text-destructive transition-colors"
            aria-label="Reject suggestion (Backspace)"
          >
            <X className="h-3.5 w-3.5 shrink-0" />
            Reject
          </button>
        </motion.div>

        {/* Feedback toggle — compact icon-only button between Reject and Accept */}
        {!showFeedbackForm && !current.userReply && (
          <button
            onClick={() => setShowFeedbackForm(true)}
            className="flex items-center justify-center rounded-md px-2.5 py-2 text-xs font-medium border border-border hover:bg-muted transition-colors"
            aria-label="Add feedback"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        )}

        <motion.div
          style={{ backgroundColor: acceptBg, borderColor: acceptBorderColor }}
          className="flex-1 rounded-md border border-border"
        >
          <button
            onClick={handleAccept}
            className="w-full h-full flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            aria-label="Accept suggestion (Enter)"
          >
            <Check className="h-3.5 w-3.5 shrink-0" />
            Accept
          </button>
        </motion.div>
      </div>

      {/* ── Row 3: Diff card — the main content ───────────────────────── */}
      {/* Draggable: swipe right to accept, left to reject.                */}
      <div className="flex-1 overflow-hidden">
        <motion.div
          key={current.id}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.7}
          onDragEnd={handleDragEnd}
          style={{ x: dragX, rotate: cardRotate, opacity: cardOpacity }}
          initial={{ opacity: 0, x: direction === 'next' ? 24 : -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18 }}
          className={cn(
            'h-full overflow-y-auto p-4 cursor-grab active:cursor-grabbing touch-none',
            animating && 'pointer-events-none'
          )}
        >
          {/* Original text */}
          <div className="mb-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Original
            </div>
            <div className="text-sm leading-relaxed rounded-md bg-muted/30 px-3 py-2.5 border border-border">
              <DiffText segments={diff.old} mode="old" />
            </div>
          </div>

          {/* Suggested text */}
          <div className="mb-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Suggested
            </div>
            <div className="text-sm leading-relaxed rounded-md bg-muted/30 px-3 py-2.5 border border-border">
              <DiffText segments={diff.new} mode="new" />
            </div>
          </div>

          {/* Explanation */}
          {current.explanation && (
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed mb-3">
              {current.explanation}
            </div>
          )}

          {/* Feedback form / existing feedback display */}
          {showFeedbackForm ? (
            <div className="space-y-2" onPointerDownCapture={(e) => e.stopPropagation()}>
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
            <div className="space-y-1">
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

      {/* ── Row 4: Keyboard / gesture hint — always visible, pinned ──────── */}
      {/* Outside the scrollable card so it never scrolls off-screen.         */}
      <div className="shrink-0 px-4 pb-3 pt-1 text-[10px] text-muted-foreground/40 text-center select-none leading-relaxed">
        ← swipe to reject · swipe to accept →
        <span className="mx-1">·</span>
        ↵ accept · ⌫ reject · ← → navigate
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
