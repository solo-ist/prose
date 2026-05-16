import { app } from 'electron'

// Tracks whether the app is in the middle of a real quit (vs. macOS Cmd+W,
// which we intercept and turn into a window hide). The main window's close
// handler checks `isQuitting()` to decide whether to honor or swallow the
// close. Kept in its own module to avoid circular imports between `index.ts`
// and modules like `updater.ts` that need to flip the flag.
//
// Main-process only — the module-level `app.on('before-quit', ...)` below
// runs on import. Importing from a renderer/test context would fail.

let quitting = false

app.on('before-quit', () => {
  quitting = true
})

export function isQuitting(): boolean {
  return quitting
}

// For paths that bypass `app.quit()` and therefore won't fire `before-quit`
// in time — notably electron-updater's `quitAndInstall`, which closes all
// windows first and only then calls `app.quit()`.
export function markQuitting(): void {
  quitting = true
}
