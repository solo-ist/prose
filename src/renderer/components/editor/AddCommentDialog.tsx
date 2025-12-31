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
  selection: { from: number; to: number; text: string } | null
  onClose: () => void
}

export function AddCommentDialog({ editor, isOpen, selection, onClose }: AddCommentDialogProps) {
  const [comment, setComment] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [isOpen])

  const handleSubmit = () => {
    if (!editor || !comment.trim() || !selection) return

    // Generate a unique ID for this comment
    const id = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Set the selection and add the comment mark
    editor.chain()
      .setTextSelection({ from: selection.from, to: selection.to })
      .setComment({ id, comment: comment.trim() })
      .run()

    // Reset and close
    setComment('')
    onClose()
  }

  const handleClose = () => {
    setComment('')
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
          {selection?.text && (
            <div className="text-sm">
              <span className="text-muted-foreground">Selected text: </span>
              <span className="italic">
                "{selection.text.length > 100 ? selection.text.slice(0, 100) + '...' : selection.text}"
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
