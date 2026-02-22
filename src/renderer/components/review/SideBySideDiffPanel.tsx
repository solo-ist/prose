import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Check, X, CheckCheck, XCircle, MessageSquare } from 'lucide-react'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useReviewStore } from '../../stores/reviewStore'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { computeWordDiff, scrollSelectionIntoCenter, type DiffSegment } from '../../lib/diffUtils'
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

  // Auto-close review when all suggestions have been handled
  useEffect(() => {
    if (total === 0) {
      setReviewMode(null)
      return
    }
    const allHaveFeedback = suggestions.every((s) => s.userReply && s.userReply.trim() !== '')
    if (allHaveFeedback) {
      setReviewMode(null)
    }
  }, [suggestions, total, setReviewMode])

  const handleAccept = useCallback((suggestion: AISuggestionData) => {
    if (!editor) return
    editor.commands.acceptAISuggestion(suggestion.id)
  }, [editor])

  const handleReject = useCallback((suggestion: AISuggestionData) => {
    if (!editor) return
    editor.commands.rejectAISuggestion(suggestion.id)
  }, [editor])

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
    editor.commands.focus()
    editor.commands.setTextSelection(suggestion.from)
    scrollSelectionIntoCenter(editor)
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
          {total} suggestion{total !== 1 ? 's' : ''} remaining
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
            editor={editor}
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
  editor,
  onAccept,
  onReject,
  onScrollTo,
}: {
  suggestion: AISuggestionData
  editor: ReturnType<typeof useEditorInstanceStore.getState>['editor']
  onAccept: () => void
  onReject: () => void
  onScrollTo: () => void
}) {
  const diff = useMemo(
    () => computeWordDiff(suggestion.originalText, suggestion.suggestedText),
    [suggestion.originalText, suggestion.suggestedText]
  )

  const [feedbackInput, setFeedbackInput] = useState(suggestion.userReply ?? '')
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (showFeedbackForm && feedbackInputRef.current) {
      feedbackInputRef.current.focus()
    }
  }, [showFeedbackForm])

  const handleSubmitFeedback = useCallback(() => {
    if (!editor || !feedbackInput.trim()) return
    editor.commands.setAISuggestionReply(suggestion.id, feedbackInput.trim())
    setShowFeedbackForm(false)
  }, [editor, suggestion.id, feedbackInput])

  const handleFeedbackKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmitFeedback()
    }
  }, [handleSubmitFeedback])

  return (
    <div
      className="border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={onScrollTo}
    >
      {/* Explanation header */}
      {suggestion.explanation && (
        <div className="mx-4 mt-3 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
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

      {/* Feedback */}
      {showFeedbackForm ? (
        <div className="mx-4 mb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
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
              onClick={(e) => { e.stopPropagation(); handleSubmitFeedback() }}
              disabled={!feedbackInput.trim()}
              className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors"
            >
              Submit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowFeedbackForm(false) }}
              className="rounded-md px-2.5 py-1 text-xs font-medium border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : suggestion.userReply ? (
        <div className="mx-4 mb-3 space-y-1" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs font-medium text-muted-foreground">Your feedback</div>
          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2 leading-relaxed">
            {suggestion.userReply}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setFeedbackInput(suggestion.userReply ?? ''); setShowFeedbackForm(true) }}
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Edit
          </button>
        </div>
      ) : null}

      {/* Per-hunk actions */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          onClick={(e) => { e.stopPropagation(); onReject() }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
        >
          <X className="h-3 w-3" />
          Reject
        </button>
        {!showFeedbackForm && !suggestion.userReply && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowFeedbackForm(true) }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border border-border hover:bg-muted transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
        )}
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
