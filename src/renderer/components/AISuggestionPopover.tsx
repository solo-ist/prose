/**
 * AI Suggestion Popover - Shows suggested text with accept/reject/feedback actions
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Check, X, MessageSquare } from 'lucide-react'

interface AISuggestionPopoverProps {
  editor: Editor
}

interface PopoverState {
  isOpen: boolean
  suggestionId: string | null
  suggestedText: string
  explanation: string
  userReply: string
  position: { x: number; y: number }
}

export function AISuggestionPopover({ editor }: AISuggestionPopoverProps) {
  const [popover, setPopover] = useState<PopoverState>({
    isOpen: false,
    suggestionId: null,
    suggestedText: '',
    explanation: '',
    userReply: '',
    position: { x: 0, y: 0 },
  })
  const [feedbackInput, setFeedbackInput] = useState('')
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
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
          const rect = suggestionMark.getBoundingClientRect()
          setFeedbackInput(userReply) // Pre-fill with existing feedback
          setShowFeedbackForm(false) // Always start in view mode, user can click Edit
          setPopover({
            isOpen: true,
            suggestionId: id,
            suggestedText,
            explanation,
            userReply,
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
  }, [])

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

  // Focus feedback input when form is shown
  useEffect(() => {
    if (showFeedbackForm && feedbackInputRef.current) {
      feedbackInputRef.current.focus()
    }
  }, [showFeedbackForm])

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

  // Adjust position to keep popover in viewport
  const adjustedPosition = { ...popover.position }
  if (popoverRef.current) {
    const rect = popoverRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Adjust horizontal position
    if (adjustedPosition.x + rect.width / 2 > viewportWidth - 16) {
      adjustedPosition.x = viewportWidth - rect.width / 2 - 16
    }
    if (adjustedPosition.x - rect.width / 2 < 16) {
      adjustedPosition.x = rect.width / 2 + 16
    }

    // Adjust vertical position (show above if not enough space below)
    if (adjustedPosition.y + rect.height > viewportHeight - 16) {
      adjustedPosition.y = popover.position.y - rect.height - 40
    }
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="ai-suggestion-popover"
      style={{
        position: 'fixed',
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        transform: 'translateX(-50%)',
      }}
    >
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
