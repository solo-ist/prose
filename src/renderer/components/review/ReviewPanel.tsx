import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ReviewPanelProps {
  open: boolean
  onClose: () => void
  width?: string
  children: ReactNode
}

/**
 * Thin wrapper that handles slide-in/out animation, dismiss logic,
 * and absolute positioning on the right edge of the viewport.
 * Content is delegated entirely to the mode-specific child component.
 */
export function ReviewPanel({ open, onClose, width = 'w-80', children }: ReviewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed top-0 right-0 h-full z-50 flex flex-col',
        'border-l border-border bg-background shadow-xl',
        'animate-in slide-in-from-right duration-200',
        width
      )}
    >
      {/* Header with close button */}
      <div className="flex items-center justify-end px-3 py-2 border-b border-border shrink-0">
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close review panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
