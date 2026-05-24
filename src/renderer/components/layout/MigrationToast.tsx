import { X } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { Button } from '../ui/button'

/**
 * One-time post-migration toast (#499 PR 4). Shown once to users upgraded from
 * v1.1 — `appearance.migrationToastShown` is `false` only after a legacy-theme
 * migration (fresh installs default it to `true`, so this never fires for them).
 * Dismissing or opening Settings flips the persisted sentinel via
 * `markMigrationToastShown()` so it never reappears.
 *
 * Bespoke (not a toast library) — the app has no toast system and this is the
 * only one-off notification, so introducing a dependency isn't warranted.
 */
export function MigrationToast() {
  const { settings, isLoaded, setDialogOpen, markMigrationToastShown } = useSettings()

  if (!isLoaded || settings.appearance.migrationToastShown) return null

  const dismiss = () => markMigrationToastShown()
  const openAppearance = () => {
    setDialogOpen(true, 'appearance')
    markMigrationToastShown()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-4 animate-in fade-in slide-in-from-bottom-2"
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-sm leading-relaxed pr-5 mb-3">
        You can now pick the new Prose theme and Pilcrow icon in Settings → Appearance.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
        <Button size="sm" onClick={openAppearance}>
          Open Settings
        </Button>
      </div>
    </div>
  )
}
