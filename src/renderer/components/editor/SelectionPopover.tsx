import { useEffect, useState, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '../ui/button'

interface SelectionPopoverProps {
  editor: Editor | null
  onAddComment: () => void
}

export function SelectionPopover({ editor, onAddComment }: SelectionPopoverProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  const updatePosition = useCallback(() => {
    if (!editor) {
      setIsVisible(false)
      return
    }

    const { from, to } = editor.state.selection

    // Only show if there's a text selection (not just cursor)
    if (from === to) {
      setIsVisible(false)
      return
    }

    // Check if selection already has a comment mark
    const hasComment = editor.state.doc.rangeHasMark(from, to, editor.schema.marks.comment)
    if (hasComment) {
      setIsVisible(false)
      return
    }

    // Get the DOM coordinates of the selection
    const coords = editor.view.coordsAtPos(to)

    // Position the popover above and to the right of the selection end
    setPosition({
      top: coords.top - 40,
      left: coords.left + 10
    })
    setIsVisible(true)
  }, [editor])

  useEffect(() => {
    if (!editor) return

    // Listen for selection changes
    const handleSelectionUpdate = () => {
      // Small delay to let the selection settle
      setTimeout(updatePosition, 10)
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    editor.on('blur', () => setIsVisible(false))

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
      editor.off('blur', () => setIsVisible(false))
    }
  }, [editor, updatePosition])

  // Hide on scroll
  useEffect(() => {
    const handleScroll = () => setIsVisible(false)
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [])

  if (!isVisible || !position) return null

  return (
    <div
      className="fixed z-50 animate-in fade-in-0 zoom-in-95"
      style={{
        top: position.top,
        left: position.left
      }}
    >
      <Button
        size="sm"
        variant="secondary"
        className="h-8 px-2 shadow-md border"
        onMouseDown={(e) => {
          // Prevent blur so selection is preserved when dialog opens
          e.preventDefault()
          e.stopPropagation()
          onAddComment()
        }}
        title="Add comment (Cmd+Shift+C)"
      >
        <MessageSquarePlus className="h-4 w-4" />
      </Button>
    </div>
  )
}
