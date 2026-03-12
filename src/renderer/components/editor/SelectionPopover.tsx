import { useEffect, useState, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { MessageSquarePlus, Bot, Bold, Italic, Link, Code } from 'lucide-react'
import { Button } from '../ui/button'
import { useAnnotationStore, getAnnotationsInRange } from '../../extensions/ai-annotations'
import { useEditorStore } from '../../stores/editorStore'

interface SelectionPopoverProps {
  editor: Editor | null
  onAddComment: () => void
  onToggleLink: () => void
}

export function SelectionPopover({ editor, onAddComment, onToggleLink }: SelectionPopoverProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null)
  const [isNodeSelection, setIsNodeSelection] = useState(false)
  const documentId = useEditorStore((state) => state.document.documentId)
  const annotations = useAnnotationStore((state) => state.annotations)

  // Check if current selection has an AI annotation
  const hasAIAnnotation = selectionRange
    ? getAnnotationsInRange(annotations, selectionRange.from, selectionRange.to).length > 0
    : false

  const updatePosition = useCallback(() => {
    if (!editor) {
      setIsVisible(false)
      return
    }

    // Don't show toolbar when editor is not editable (e.g. reMarkable read-only, preview tab)
    if (!editor.isEditable) {
      setIsVisible(false)
      return
    }

    const { from, to } = editor.state.selection

    // Only show if there's a text selection (not just cursor)
    if (from === to) {
      setIsVisible(false)
      setSelectionRange(null)
      return
    }

    // Check if selection already has a comment mark
    const hasComment = editor.state.doc.rangeHasMark(from, to, editor.schema.marks.comment)
    if (hasComment) {
      setIsVisible(false)
      setSelectionRange(null)
      return
    }

    // Store selection range for annotation check
    setSelectionRange({ from, to })
    setIsNodeSelection(editor.state.selection instanceof NodeSelection)

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

  const handleToggleAIAnnotation = useCallback(() => {
    if (!editor || !selectionRange || !documentId) return

    const { from, to } = selectionRange

    if (hasAIAnnotation) {
      // Remove annotation
      useAnnotationStore.getState().removeAnnotationsInRange(from, to)
    } else {
      // Add annotation
      const selectedText = editor.state.doc.textBetween(from, to, '\n')
      useAnnotationStore.getState().addAnnotation({
        documentId,
        type: 'insertion',
        from,
        to,
        content: selectedText,
        provenance: {
          model: 'Imported',
          conversationId: '',
          messageId: '',
        },
      })
    }
  }, [editor, selectionRange, documentId, hasAIAnnotation])

  const handleToggleLink = useCallback(() => {
    if (!editor) return
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run()
    } else {
      onToggleLink()
    }
  }, [editor, onToggleLink])

  if (!isVisible || !position) return null

  return (
    <div
      className="fixed z-50 animate-in fade-in-0 zoom-in-95 flex gap-1 items-center"
      style={{
        top: position.top,
        left: position.left
      }}
    >
      {!isNodeSelection && (
        <>
          <Button
            size="sm"
            variant={editor?.isActive('bold') ? 'default' : 'secondary'}
            className="h-8 px-2 shadow-md border"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              editor?.chain().focus().toggleBold().run()
            }}
            title="Bold (Cmd+B)"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant={editor?.isActive('italic') ? 'default' : 'secondary'}
            className="h-8 px-2 shadow-md border"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              editor?.chain().focus().toggleItalic().run()
            }}
            title="Italic (Cmd+I)"
          >
            <Italic className="h-4 w-4" />
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant={editor?.isActive('link') ? 'default' : 'secondary'}
        className="h-8 px-2 shadow-md border"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          handleToggleLink()
        }}
        title="Link (Cmd+K)"
      >
        <Link className="h-4 w-4" />
      </Button>
      {!isNodeSelection && (
        <>
          <Button
            size="sm"
            variant={editor?.isActive('code') ? 'default' : 'secondary'}
            className="h-8 px-2 shadow-md border"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              editor?.chain().focus().toggleCode().run()
            }}
            title="Code"
          >
            <Code className="h-4 w-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
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
            title="Add comment (Cmd+Shift+A)"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant={hasAIAnnotation ? "default" : "secondary"}
            className="h-8 px-2 shadow-md border"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleToggleAIAnnotation()
            }}
            title={hasAIAnnotation ? "Remove AI authorship" : "Mark as AI authored"}
          >
            <Bot className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  )
}
