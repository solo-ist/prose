import { useEffect, useRef, useCallback } from 'react'
import { Editor } from '@tiptap/react'
import { Input } from '../ui/input'

interface LinkPopoverProps {
  editor: Editor
  isOpen: boolean
  onClose: () => void
  position: { top: number; left: number }
  initialUrl?: string
}

export function LinkPopover({ editor, isOpen, onClose, position, initialUrl }: LinkPopoverProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      // Focus after render
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  const handleSubmit = useCallback((value: string) => {
    const trimmed = value.trim()
    if (trimmed === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      let href = trimmed
      // Auto-prepend https:// if no protocol but has a dot (looks like a URL)
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && href.includes('.')) {
        href = `https://${href}`
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    onClose()
  }, [editor, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(e.currentTarget.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      editor.commands.focus()
    }
  }, [handleSubmit, onClose, editor])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      const el = (e.target as Element).closest('.link-popover')
      if (!el) {
        onClose()
        editor.commands.focus()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  }, [isOpen, onClose, editor])

  if (!isOpen) return null

  return (
    <div
      className="link-popover fixed z-50 animate-in fade-in-0 zoom-in-95"
      style={{ top: position.top, left: position.left }}
    >
      <Input
        ref={inputRef}
        defaultValue={initialUrl || ''}
        placeholder="Enter URL..."
        className="h-8 w-64 text-sm shadow-md border"
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
