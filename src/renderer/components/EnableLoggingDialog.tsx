import { create } from 'zustand'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { useSettingsStore } from '../stores/settingsStore'

interface BugReportPromptState {
  pendingUrl: string | null
  dismissedThisSession: boolean
  request: (url: string) => void
  close: () => void
}

const useBugReportPromptStore = create<BugReportPromptState>((set, get) => ({
  pendingUrl: null,
  dismissedThisSession: false,
  request: (url) => {
    const enabled = useSettingsStore.getState().settings.errorTracking?.enabled === true
    if (enabled || get().dismissedThisSession) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    set({ pendingUrl: url })
  },
  close: () => set({ pendingUrl: null })
}))

// Re-prompt next time if the user turns Error Reporting off again — the
// dismissal only applied to the previous off→stay-off decision.
useSettingsStore.subscribe(
  (state) => state.settings.errorTracking?.enabled === true,
  (isEnabled, wasEnabled) => {
    if (wasEnabled && !isEnabled) {
      useBugReportPromptStore.setState({ dismissedThisSession: false })
    }
  }
)

export function requestBugReport(url: string): void {
  useBugReportPromptStore.getState().request(url)
}

export function EnableLoggingDialog() {
  const pendingUrl = useBugReportPromptStore((s) => s.pendingUrl)
  const close = useBugReportPromptStore((s) => s.close)

  const openPending = () => {
    const url = pendingUrl
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleEnableAndContinue = () => {
    useSettingsStore.getState().setErrorTracking(true)
    openPending()
    close()
  }

  const handleContinueOnly = () => {
    useBugReportPromptStore.setState({ dismissedThisSession: true })
    openPending()
    close()
  }

  const handleOpenSettings = () => {
    useSettingsStore.getState().setDialogOpen(true, 'general')
    close()
  }

  return (
    <AlertDialog open={pendingUrl !== null} onOpenChange={(open) => { if (!open) close() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Help us fix what you&rsquo;re reporting</AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Error Reporting sends anonymous crash reports — stack traces, the
            action you took just before the crash, and basic environment info.
            <strong className="text-foreground"> No document content is ever included.</strong>
          </p>
          <p>
            Enabling it now means the bug you&rsquo;re about to file will arrive
            with the context we need to actually fix it. You can turn it off
            again any time in{' '}
            <button
              type="button"
              onClick={handleOpenSettings}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Settings &rarr; General
            </button>
            .
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleContinueOnly}>
            Continue Without Enabling
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleEnableAndContinue}>
            Enable &amp; Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
