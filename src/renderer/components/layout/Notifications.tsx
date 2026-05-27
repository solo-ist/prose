import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '../ui/button'
import { useNotificationStore, type AppNotification } from '../../stores/notificationStore'

/**
 * Renders the bespoke toast stack (see notificationStore). Mounted once near
 * the app root. Matches MigrationToast's visual language; auto-dismiss timers
 * live here so they tie to the mounted toast and clean up on unmount.
 */
function Toast({ notification }: { notification: AppNotification }) {
  const dismiss = useNotificationStore((s) => s.dismiss)
  const { id, message, actionLabel, onAction, durationMs, triggeredAt } = notification

  // `triggeredAt` changes when an existing toast (same id) is re-triggered, so
  // the timer restarts from the latest trigger instead of the first.
  useEffect(() => {
    if (!durationMs) return
    const timer = setTimeout(() => dismiss(id), durationMs)
    return () => clearTimeout(timer)
  }, [id, durationMs, triggeredAt, dismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto relative w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-4 animate-in fade-in slide-in-from-bottom-2"
    >
      <button
        onClick={() => dismiss(id)}
        aria-label="Dismiss"
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-sm leading-relaxed pr-5">{message}</p>
      {actionLabel && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => dismiss(id)}>
            Dismiss
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onAction?.()
              dismiss(id)
            }}
          >
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

export function Notifications() {
  const notifications = useNotificationStore((s) => s.notifications)
  if (notifications.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {notifications.map((notification) => (
        <Toast key={notification.id} notification={notification} />
      ))}
    </div>
  )
}
