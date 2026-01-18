import React, { useEffect, useState } from 'react'
import {
  getLastRecoveryResult,
  clearRecoveryResult,
  type RecoveryResult
} from '../lib/persistence'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react'

/**
 * Modal that appears when database recovery has occurred.
 * Shows user what data was recovered vs. lost.
 */
export function RecoveryModal() {
  const [recovery, setRecovery] = useState<RecoveryResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    // Check for recovery result on mount
    const result = getLastRecoveryResult()
    if (result) {
      setRecovery(result)
    }
  }, [])

  const handleDismiss = () => {
    clearRecoveryResult()
    setRecovery(null)
  }

  const handleReportIssue = () => {
    // Pre-fill GitHub issue with recovery details
    const title = encodeURIComponent('Database recovery occurred')
    const body = encodeURIComponent(`
## Recovery Details

- **Timestamp**: ${new Date(recovery!.timestamp).toISOString()}
- **Error**: ${recovery!.error || 'None'}
- **Recovered**: ${recovery!.recoveredStores.join(', ') || 'None'}
- **Lost**: ${recovery!.lostStores.join(', ') || 'None'}

## Steps to Reproduce

[Please describe what you were doing when this occurred]

## Additional Context

[Any other relevant information]
    `.trim())

    const issueUrl = `https://github.com/solo-ist/prose/issues/new?title=${title}&body=${body}&labels=bug,database`
    window.open(issueUrl, '_blank')
  }

  if (!recovery) return null

  const hasRecoveredData = recovery.recoveredStores.length > 0
  const hasLostData = recovery.lostStores.length > 0

  return (
    <Dialog open={true} onOpenChange={handleDismiss}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            Database Recovery Occurred
          </DialogTitle>
          <DialogDescription>
            The database encountered an issue and was automatically recovered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
            {hasRecoveredData ? (
              <p>
                Your data was backed up and restored. The app should work
                normally.
              </p>
            ) : (
              <p className="text-yellow-600 dark:text-yellow-500">
                Unfortunately, data could not be recovered. You&apos;re starting
                with a clean state.
              </p>
            )}
          </div>

          {/* Show Details Toggle */}
          {!showDetails && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(true)}
              className="w-full"
            >
              View Details
            </Button>
          )}

          {/* Details */}
          {showDetails && (
            <div className="space-y-2 text-sm">
              {hasRecoveredData && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-medium text-green-600 dark:text-green-500">
                    <CheckCircle className="h-4 w-4" />
                    Recovered:
                  </div>
                  <ul className="ml-6 list-disc space-y-0.5 text-muted-foreground">
                    {recovery.recoveredStores.map((store) => (
                      <li key={store}>{formatStoreName(store)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {hasLostData && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-medium text-red-600 dark:text-red-500">
                    <XCircle className="h-4 w-4" />
                    Lost:
                  </div>
                  <ul className="ml-6 list-disc space-y-0.5 text-muted-foreground">
                    {recovery.lostStores.map((store) => (
                      <li key={store}>{formatStoreName(store)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {recovery.error && (
                <div className="space-y-1">
                  <div className="font-medium text-muted-foreground">
                    Error:
                  </div>
                  <div className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                    {recovery.error}
                  </div>
                </div>
              )}

              <div className="pt-2 text-xs text-muted-foreground">
                Recovery timestamp:{' '}
                {new Date(recovery.timestamp).toLocaleString()}
              </div>
            </div>
          )}

          {/* Help Text */}
          <div className="text-xs text-muted-foreground">
            <p>
              Note: Saved files are stored on disk and are unaffected by
              database issues. This only impacts drafts, chat history, and
              annotations.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={handleReportIssue}
            className="w-full sm:w-auto"
          >
            Report Issue
          </Button>
          <Button onClick={handleDismiss} className="w-full sm:w-auto">
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Convert store name to human-readable label
 */
function formatStoreName(store: string): string {
  const labels: Record<string, string> = {
    drafts: 'Drafts',
    conversations: 'Chat History',
    annotations: 'AI Annotations',
    command_history: 'Command History'
  }
  return labels[store] || store
}
