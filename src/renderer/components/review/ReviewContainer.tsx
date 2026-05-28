import { useEffect } from 'react'
import { useReviewStore, useReviewMode } from '../../stores/reviewStore'
import { QuickReviewPanel } from './QuickReviewPanel'
import { SideBySideDiffPanel } from './SideBySideDiffPanel'

/**
 * Container that owns the Escape handler and mode-switching context.
 * Rendered inside ChatPanel when reviewMode is non-null.
 *
 * In the Quick Review redesign (#385) the header (title, close button, mode
 * cross-link) now lives inside QuickReviewPanel so all controls are clustered
 * in one place. SideBySideDiffPanel retains its own header for its bulk
 * actions + cross-link. This container is intentionally thin.
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

  return (
    <div className="flex h-full flex-col">
      {reviewMode === 'quick' ? (
        <QuickReviewPanel />
      ) : (
        <SideBySideDiffPanel />
      )}
    </div>
  )
}
