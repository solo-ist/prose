/**
 * Floating panel component for suggested edits.
 *
 * Shows when the user clicks on marked text with a suggestion.
 * Provides accept/reject buttons and shows the suggested replacement.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { Button } from '../../components/ui/button'
import { Check, X } from 'lucide-react'

interface SuggestionPanelProps {
  editor: Editor | null
}

interface SuggestionData {
  id: string
  suggestedText: string
  comment: string
  pos: number
}

interface Position {
  top: number
  left: number
}

export function SuggestionPanel({ editor }: SuggestionPanelProps) {
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Listen for suggestion clicks
  useEffect(() => {
    const handleSuggestionClick = (event: CustomEvent<SuggestionData>) => {
      const { id, suggestedText, comment, pos } = event.detail

      // Get position from the editor view
      if (editor) {
        const coords = editor.view.coordsAtPos(pos)
        setPosition({
          top: coords.bottom + 8,
          left: coords.left,
        })
      }

      setSuggestion({ id, suggestedText, comment, pos })
    }

    window.addEventListener('suggested-edit-clicked', handleSuggestionClick as EventListener)
    return () => {
      window.removeEventListener('suggested-edit-clicked', handleSuggestionClick as EventListener)
    }
  }, [editor])

  // Adjust position to keep panel in viewport
  useEffect(() => {
    if (!panelRef.current || !position) return

    const panel = panelRef.current
    const rect = panel.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let newTop = position.top
    let newLeft = position.left

    // Adjust if panel goes off right edge
    if (newLeft + rect.width > viewportWidth - 16) {
      newLeft = viewportWidth - rect.width - 16
    }

    // Adjust if panel goes off bottom edge
    if (newTop + rect.height > viewportHeight - 16) {
      // Show above instead
      newTop = position.top - rect.height - 24
    }

    // Ensure minimum left position
    if (newLeft < 16) {
      newLeft = 16
    }

    if (newTop !== position.top || newLeft !== position.left) {
      setPosition({ top: newTop, left: newLeft })
    }
  }, [position, suggestion])

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setSuggestion(null)
        setPosition(null)
      }
    }

    if (suggestion) {
      // Small delay to avoid closing immediately from the triggering click
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, 100)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [suggestion])

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSuggestion(null)
        setPosition(null)
      }
    }

    if (suggestion) {
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [suggestion])

  const handleAccept = useCallback(() => {
    if (!editor || !suggestion) return
    editor.commands.acceptSuggestedEdit(suggestion.id)
    setSuggestion(null)
    setPosition(null)
  }, [editor, suggestion])

  const handleReject = useCallback(() => {
    if (!editor || !suggestion) return
    editor.commands.rejectSuggestedEdit(suggestion.id)
    setSuggestion(null)
    setPosition(null)
  }, [editor, suggestion])

  if (!suggestion || !position) return null

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 50,
      }}
      className="min-w-[200px] max-w-[400px] rounded-md border bg-popover p-3 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
    >
      <div className="space-y-2">
        {/* Suggested replacement */}
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Suggested:</div>
          <div className="text-sm bg-green-500/10 text-green-700 dark:text-green-400 p-2 rounded border border-green-500/20">
            {suggestion.suggestedText || <em className="text-muted-foreground">Delete text</em>}
          </div>
        </div>

        {/* Comment/explanation if present */}
        {suggestion.comment && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Explanation:</div>
            <div className="text-sm text-muted-foreground">{suggestion.comment}</div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="default"
            className="flex-1 bg-green-600 hover:bg-green-700"
            onClick={handleAccept}
          >
            <Check className="h-3 w-3 mr-1" />
            Accept
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={handleReject}>
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        </div>
      </div>
    </div>
  )
}
