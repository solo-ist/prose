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
  /** New-comment mode: selection range + text */
  selection: { from: number; to: number; text: string } | null
  /** View-existing mode: the comment ID to display/remove */
  existingCommentId?: string | null
  /** View-existing mode: the comment instruction text to display */
  existingCommentText?: string | null
  onClose: () => void
}

export function AddCommentDialog({
  editor,
  isOpen,
  selection,
  existingCommentId,
  existingCommentText,
  onClose,
}: AddCommentDialogProps) {
  const isViewMode = !!existingCommentId
  const [comment, setComment] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Populate comment text when viewing an existing comment
  useEffect(() => {
    if (isOpen && isViewMode && existingCommentText) {
      setComment(existingCommentText)
    } else if (isOpen && !isViewMode) {
      setComment('')
    }
  }, [isOpen, isViewMode, existingCommentText])

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

  const handleRemove = () => {
    if (!editor || !existingCommentId) return
    editor.commands.unsetComment(existingCommentId)
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
      if (!isViewMode) handleSubmit()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isViewMode ? 'Comment' : 'Add Comment'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isViewMode && selection?.text && (
            <div className="text-sm">
              <span className="text-muted-foreground">Selected text: </span>
              <span className="italic">
                "{selection.text.length > 100 ? selection.text.slice(0, 100) + '...' : selection.text}"
              </span>
            </div>
          )}
          <Textarea
            ref={textareaRef}
            placeholder={isViewMode ? '' : "Enter your instruction for the AI (e.g., 'make this more concise')"}
            value={comment}
            onChange={(e) => !isViewMode && setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="resize-none"
            readOnly={isViewMode}
          />
          {!isViewMode && (
            <p className="text-xs text-muted-foreground">
              Tip: Press Cmd+Enter to submit
            </p>
          )}
        </div>
        <DialogFooter>
          {isViewMode ? (
            <>
              <Button variant="destructive" onClick={handleRemove}>
                Remove Comment
              </Button>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!comment.trim()}>
                Add Comment
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
