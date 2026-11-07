/**
 * AI Suggestion Popover - Shows suggested text with accept/reject/feedback actions
 */

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Check, X, MessageSquare } from 'lucide-react'
import { getAISuggestions } from '../extensions/ai-suggestions'
import { actorLabel, actorOfProvenance } from '../../shared/review/actor'
import { useSelfName } from '../hooks/useSelfName'

interface AISuggestionPopoverProps {
  editor: Editor
}

interface PopoverState {
  isOpen: boolean
  suggestionId: string | null
  suggestedText: string
  explanation: string
  userReply: string
  /** Who proposed it (#1232), read from the state by id. */
  by: string
  position: { x: number; y: number }
}

export function AISuggestionPopover({ editor }: AISuggestionPopoverProps) {
  const [popover, setPopover] = useState<PopoverState>({
    isOpen: false,
    suggestionId: null,
    suggestedText: '',
    explanation: '',
    userReply: '',
    by: '',
    position: { x: 0, y: 0 },
  })
  const selfName = useSelfName()
  const [feedbackInput, setFeedbackInput] = useState('')
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const [adjustedPosition, setAdjustedPosition] = useState<{ x: number; y: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null)

  // Handle clicks on AI suggestion marks
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Check if clicked on an AI suggestion mark
      const suggestionMark = target.closest('.ai-suggestion-mark')
      if (suggestionMark) {
        event.preventDefault()
        event.stopPropagation()

        const id = suggestionMark.getAttribute('data-ai-suggestion-id')
        const suggestedText = suggestionMark.getAttribute('data-ai-suggested') || ''
        const explanation = suggestionMark.getAttribute('data-ai-explanation') || ''
        const userReply = suggestionMark.getAttribute('data-ai-user-reply') || ''

        if (id) {
          const record = getAISuggestions(editor).find((s) => s.id === id)
          const by = record ? actorLabel(actorOfProvenance(record.provenanceModel, record.actor), { selfName }) : ''
          const rect = suggestionMark.getBoundingClientRect()
          setFeedbackInput(userReply) // Pre-fill with existing feedback
          setShowFeedbackForm(false) // Always start in view mode, user can click Edit
          setPopover({
            isOpen: true,
            suggestionId: id,
            suggestedText,
            explanation,
            userReply,
            by,
            position: {
              x: rect.left + rect.width / 2,
              y: rect.bottom + 8,
            },
          })
        }
        return
      }

      // Close popover if clicking outside
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
        setShowFeedbackForm(false)
        setFeedbackInput('')
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [editor, selfName])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popover.isOpen) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
        setShowFeedbackForm(false)
        setFeedbackInput('')
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [popover.isOpen])

  // Follow the mark as the document scrolls or the window resizes (#1168):
  // re-read its rect in one animation frame and re-anchor (the viewport clamp
  // below re-runs from the new position). Close for good when the mark is
  // gone (accepted, rejected) or has left the editor pane, so the card rides
  // off with its text instead of popping back in on scroll-back. Capture
  // phase catches the inner scroller: scroll events do not bubble but do
  // propagate down from the window in capture.
  useEffect(() => {
    if (!popover.isOpen || !popover.suggestionId) return
    const id = popover.suggestionId
    let raf = 0
    const reposition = () => {
      raf = 0
      const mark = document.querySelector(`.ai-suggestion-mark[data-ai-suggestion-id="${id}"]`) as HTMLElement | null
      const rect = mark?.getBoundingClientRect()
      const pane = mark?.closest('.overflow-auto')?.getBoundingClientRect()
      const paneTop = pane?.top ?? 0
      const paneBottom = pane?.bottom ?? window.innerHeight
      if (!mark || !rect || rect.bottom < paneTop || rect.top > paneBottom) {
        setPopover((prev) => (prev.suggestionId === id ? { ...prev, isOpen: false } : prev))
        return
      }
      setPopover((prev) =>
        prev.isOpen && prev.suggestionId === id
          ? { ...prev, position: { x: rect.left + rect.width / 2, y: rect.bottom + 8 } }
          : prev
      )
    }
    const onChange = () => {
      if (!raf) raf = requestAnimationFrame(reposition)
    }
    window.addEventListener('scroll', onChange, true)
    window.addEventListener('resize', onChange)
    return () => {
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [popover.isOpen, popover.suggestionId])

  // Focus feedback input when form is shown
  useEffect(() => {
    if (showFeedbackForm && feedbackInputRef.current) {
      feedbackInputRef.current.focus()
    }
  }, [showFeedbackForm])

  // Reset adjusted position when popover opens at new position
  useEffect(() => {
    setAdjustedPosition(null)
  }, [popover.position.x, popover.position.y])

  // Adjust position to keep popover in viewport (after render)
  useLayoutEffect(() => {
    if (!popover.isOpen || !popoverRef.current || adjustedPosition) return

    const rect = popoverRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const newPosition = { ...popover.position }

    // Adjust horizontal position
    if (newPosition.x + rect.width / 2 > viewportWidth - 16) {
      newPosition.x = viewportWidth - rect.width / 2 - 16
    }
    if (newPosition.x - rect.width / 2 < 16) {
      newPosition.x = rect.width / 2 + 16
    }

    // Adjust vertical position (show above if not enough space below)
    if (newPosition.y + rect.height > viewportHeight - 16) {
      newPosition.y = popover.position.y - rect.height - 40
    }

    // Only update if position changed
    if (newPosition.x !== popover.position.x || newPosition.y !== popover.position.y) {
      setAdjustedPosition(newPosition)
    } else {
      setAdjustedPosition(popover.position)
    }
  }, [popover.isOpen, popover.position, adjustedPosition])

  const handleAccept = useCallback(() => {
    if (popover.suggestionId) {
      editor.commands.acceptAISuggestion(popover.suggestionId)
      setPopover((prev) => ({ ...prev, isOpen: false }))
      setShowFeedbackForm(false)
      setFeedbackInput('')
    }
  }, [editor, popover.suggestionId])

  const handleReject = useCallback(() => {
    if (popover.suggestionId) {
      editor.commands.rejectAISuggestion(popover.suggestionId)
      setPopover((prev) => ({ ...prev, isOpen: false }))
      setShowFeedbackForm(false)
      setFeedbackInput('')
    }
  }, [editor, popover.suggestionId])

  const handleToggleFeedback = useCallback(() => {
    setShowFeedbackForm((prev) => !prev)
  }, [])

  const handleSubmitFeedback = useCallback(() => {
    if (popover.suggestionId && feedbackInput.trim()) {
      editor.commands.setAISuggestionReply(popover.suggestionId, feedbackInput.trim())
      setPopover((prev) => ({ ...prev, isOpen: false, userReply: feedbackInput.trim() }))
      setShowFeedbackForm(false)
      setFeedbackInput('')
    }
  }, [editor, popover.suggestionId, feedbackInput])

  const handleFeedbackKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmitFeedback()
    }
  }, [handleSubmitFeedback])

  if (!popover.isOpen) return null

  // Use adjusted position if available, otherwise use initial position (will be adjusted after first render)
  const displayPosition = adjustedPosition || popover.position

  return createPortal(
    <div
      ref={popoverRef}
      className="ai-suggestion-popover"
      style={{
        position: 'fixed',
        left: displayPosition.x,
        top: displayPosition.y,
        transform: 'translateX(-50%)',
        // Hide until position is adjusted to prevent flash at wrong position
        visibility: adjustedPosition ? 'visible' : 'hidden',
      }}
    >
      {popover.by && (
        <div className="suggested-label" data-testid="suggestion-actor">By {popover.by}</div>
      )}
      <div className="suggested-label">Suggested:</div>
      <div className="suggested-text">{popover.suggestedText}</div>

      {popover.explanation && (
        <>
          <div className="explanation-label">Explanation:</div>
          <div className="explanation-text">{popover.explanation}</div>
        </>
      )}

      {/* Feedback section */}
      {showFeedbackForm ? (
        <div className="feedback-section">
          <div className="feedback-label">Your feedback:</div>
          <textarea
            ref={feedbackInputRef}
            className="feedback-input"
            value={feedbackInput}
            onChange={(e) => setFeedbackInput(e.target.value)}
            onKeyDown={handleFeedbackKeyDown}
            placeholder="Tell the AI what to change..."
            rows={2}
          />
          <div className="feedback-actions">
            <button className="feedback-submit-btn" onClick={handleSubmitFeedback} disabled={!feedbackInput.trim()}>
              Submit
            </button>
            <button className="feedback-cancel-btn" onClick={handleToggleFeedback}>
              Cancel
            </button>
          </div>
        </div>
      ) : popover.userReply ? (
        <div className="existing-feedback">
          <div className="feedback-label">Your feedback:</div>
          <div className="feedback-text">{popover.userReply}</div>
          <button className="edit-feedback-btn" onClick={handleToggleFeedback}>
            Edit
          </button>
        </div>
      ) : null}

      <div className="actions">
        <button className="accept-btn" onClick={handleAccept}>
          <Check size={16} />
          Accept
        </button>
        <button className="reject-btn" onClick={handleReject}>
          <X size={16} />
          Reject
        </button>
        {!showFeedbackForm && !popover.userReply && (
          <button className="feedback-btn" onClick={handleToggleFeedback}>
            <MessageSquare size={16} />
            Feedback
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
