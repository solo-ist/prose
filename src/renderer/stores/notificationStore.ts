import { create } from 'zustand'

export interface AppNotification {
  id: string
  message: string
  /** Optional action button label (e.g. "Open Settings"). */
  actionLabel?: string
  /** Invoked when the action button is clicked. The toast dismisses after. */
  onAction?: () => void
  /** ms before auto-dismiss. 0 / undefined keeps it until dismissed. */
  durationMs?: number
  /** Stamp set on every show/refresh so the renderer can reset its dismiss
   *  timer when an existing toast (same id) is re-triggered. Set internally. */
  triggeredAt: number
}

interface NotificationState {
  notifications: AppNotification[]
  /** Show a toast. Returns its id. Passing an existing id refreshes that toast
   *  in place (and resets its timer) instead of stacking a duplicate. */
  notify: (n: Omit<AppNotification, 'id' | 'triggeredAt'> & { id?: string }) => string
  dismiss: (id: string) => void
}

const DEFAULT_DURATION_MS = 6000

/**
 * Minimal in-app toast store. The app intentionally has no toast library
 * (see MigrationToast); this is the bespoke equivalent for recurring,
 * programmatic notifications — e.g. "AI not configured" feedback fired from
 * any entry point regardless of chat-panel visibility.
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  notify: ({ id, durationMs, ...rest }) => {
    const notifId = id ?? `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const next: AppNotification = {
      id: notifId,
      durationMs: durationMs ?? DEFAULT_DURATION_MS,
      triggeredAt: Date.now(),
      ...rest
    }
    const exists = get().notifications.some((n) => n.id === notifId)
    set((s) => ({
      notifications: exists
        ? s.notifications.map((n) => (n.id === notifId ? next : n))
        : [...s.notifications, next]
    }))
    return notifId
  },
  dismiss: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }))
}))
