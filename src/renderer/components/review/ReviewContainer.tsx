import { useEffect } from 'react'
import { X, ArrowLeftRight } from 'lucide-react'
import { useReviewStore, useReviewMode } from '../../stores/reviewStore'
import { QuickReviewPanel } from './QuickReviewPanel'
import { SideBySideDiffPanel } from './SideBySideDiffPanel'

/**
 * Container that owns the review header, Escape handler, cross-links,
 * and mode switching. Rendered inside ChatPanel when reviewMode is non-null.
 */
export function ReviewContainer() {
  const reviewMode = useReviewMode()
  const setReviewMode = useReviewStore((s) => s.setReviewMode)

  // Escape to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setReviewMode(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setReviewMode])

  if (!reviewMode) return null

  const isQuick = reviewMode === 'quick'
  const title = isQuick ? 'Quick Review' : 'Side-by-Side Diff'
  const crossLinkLabel = isQuick ? 'See entire diff' : 'Quick review'
  const crossLinkMode = isQuick ? 'side-by-side' : 'quick' as const

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pl-4 pr-3 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <button
            onClick={() => setReviewMode(crossLinkMode)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            <ArrowLeftRight className="h-3 w-3" />
            {crossLinkLabel}
          </button>
        </div>
        <button
          onClick={() => setReviewMode(null)}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close review"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isQuick ? <QuickReviewPanel /> : <SideBySideDiffPanel />}
      </div>
    </div>
  )
}
