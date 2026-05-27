/**
 * Comment Popover — shows an existing comment's text with a Remove action.
 * Mirrors the visual language of AISuggestionPopover.
 */

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Trash2, X, Sparkles } from 'lucide-react'
import { useChat } from '../hooks/useChat'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { aiUnavailableMessage } from '../lib/llm'

interface CommentPopoverProps {
  editor: Editor
}

interface PopoverState {
  isOpen: boolean
  commentId: string | null
  commentText: string
  position: { x: number; y: number }
}

export function CommentPopover({ editor }: CommentPopoverProps) {
  const [popover, setPopover] = useState<PopoverState>({
    isOpen: false,
    commentId: null,
    commentText: '',
    position: { x: 0, y: 0 },
  })
  const [adjustedPosition, setAdjustedPosition] = useState<{ x: number; y: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const { processComment } = useChat()
  const ai = useAIConfigured()

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const mark = target.closest('.comment-mark') as HTMLElement | null
      if (mark) {
        event.preventDefault()
        event.stopPropagation()

        const id = mark.getAttribute('data-comment-id')
        if (!id) {
          // Malformed mark — the Comment extension's renderHTML drops the
          // attribute when attrs.id is falsy. Warn loudly so the source of
          // the bad mark is debuggable, but don't silently swallow the click.
          console.warn('[CommentPopover] comment-mark clicked with no data-comment-id', mark)
          return
        }
        const text = mark.getAttribute('data-comment') || ''
        const rect = mark.getBoundingClientRect()
        setPopover({
          isOpen: true,
          commentId: id,
          commentText: text,
          position: { x: rect.left + rect.width / 2, y: rect.bottom + 8 },
        })
        return
      }

      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popover.isOpen) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [popover.isOpen])

  useEffect(() => {
    setAdjustedPosition(null)
  }, [popover.position.x, popover.position.y])

  useLayoutEffect(() => {
    if (!popover.isOpen || !popoverRef.current || adjustedPosition) return
    const rect = popoverRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const newPosition = { ...popover.position }
    if (newPosition.x + rect.width / 2 > viewportWidth - 16) {
      newPosition.x = viewportWidth - rect.width / 2 - 16
    }
    if (newPosition.x - rect.width / 2 < 16) {
      newPosition.x = rect.width / 2 + 16
    }
    if (newPosition.y + rect.height > viewportHeight - 16) {
      newPosition.y = popover.position.y - rect.height - 40
    }
    if (newPosition.x !== popover.position.x || newPosition.y !== popover.position.y) {
      setAdjustedPosition(newPosition)
    } else {
      setAdjustedPosition(popover.position)
    }
  }, [popover.isOpen, popover.position, adjustedPosition])

  const handleRemove = useCallback(() => {
    if (popover.commentId) {
      editor.commands.unsetComment(popover.commentId)
      setPopover((prev) => ({ ...prev, isOpen: false }))
    }
  }, [editor, popover.commentId])

  const handleProcess = useCallback(() => {
    if (popover.commentId) {
      const id = popover.commentId
      setPopover((prev) => ({ ...prev, isOpen: false }))
      processComment(id)
    }
  }, [popover.commentId, processComment])

  const handleClose = useCallback(() => {
    setPopover((prev) => ({ ...prev, isOpen: false }))
  }, [])

  if (!popover.isOpen) return null

  const displayPosition = adjustedPosition || popover.position

  return createPortal(
    <div
      ref={popoverRef}
      className="comment-popover"
      style={{
        position: 'fixed',
        left: displayPosition.x,
        top: displayPosition.y,
        transform: 'translateX(-50%)',
        visibility: adjustedPosition ? 'visible' : 'hidden',
      }}
    >
      <div className="comment-label">Comment:</div>
      <div className="comment-text">{popover.commentText}</div>
      <div className="actions">
        <button
          className="process-btn"
          onClick={handleProcess}
          disabled={!ai.available}
        >
          <Sparkles size={16} />
          Process
        </button>
        <button className="remove-btn" onClick={handleRemove}>
          <Trash2 size={16} />
          Remove
        </button>
        <button className="close-btn" onClick={handleClose}>
          <X size={16} />
          Close
        </button>
      </div>
      {!ai.available && ai.reason && (
        <div className="ai-hint">{aiUnavailableMessage(ai.reason)}</div>
      )}
    </div>,
    document.body
  )
}
