import { useState, useEffect, useRef } from 'react'
import { Editor } from '@tiptap/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

interface AddCommentDialogProps {
  editor: Editor | null
  isOpen: boolean
  onClose: () => void
}

export function AddCommentDialog({ editor, isOpen, onClose }: AddCommentDialogProps) {
  const [comment, setComment] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Capture the selected text when dialog opens
  useEffect(() => {
    if (isOpen && editor) {
      const { from, to } = editor.state.selection
      if (from !== to) {
        const text = editor.state.doc.textBetween(from, to, ' ')
        setSelectedText(text)
      }
    }
  }, [isOpen, editor])

  // Focus textarea when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [isOpen])

  const handleSubmit = () => {
    if (!editor || !comment.trim()) return

    const { from, to } = editor.state.selection
    if (from === to) {
      onClose()
      return
    }

    // Generate a unique ID for this comment
    const id = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Add the comment mark to the selection
    editor.commands.setComment({ id, comment: comment.trim() })

    // Reset and close
    setComment('')
    setSelectedText('')
    onClose()
  }

  const handleClose = () => {
    setComment('')
    setSelectedText('')
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Comment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {selectedText && (
            <div className="text-sm">
              <span className="text-muted-foreground">Selected text: </span>
              <span className="italic">
                "{selectedText.length > 100 ? selectedText.slice(0, 100) + '...' : selectedText}"
              </span>
            </div>
          )}
          <Textarea
            ref={textareaRef}
            placeholder="Enter your instruction for the AI (e.g., 'make this more concise')"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Tip: Press Cmd+Enter to submit
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!comment.trim()}>
            Add Comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
