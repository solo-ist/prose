import * as Sentry from '@sentry/electron/main'
import { IPCMode } from '@sentry/electron/main'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

let initialized = false

const SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://fd14a3e064b942f9ec02734f7d26d541@o4511057861476352.ingest.us.sentry.io/4511057863311360'

/** Strip file paths from error messages and breadcrumbs to avoid leaking usernames */
function stripFilePaths(str: string): string {
  return str.replace(/\/Users\/[^\s:)"',]+/g, '/Users/[redacted]')
    .replace(/\/home\/[^\s:)"',]+/g, '/home/[redacted]')
    .replace(/[A-Z]:\\Users\\[^\s:)"',]+/g, '[redacted-path]')
}

function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Strip file paths from exception messages
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) {
        ex.value = stripFilePaths(ex.value)
      }
    }
  }

  // Strip file paths from breadcrumb messages
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) {
        crumb.message = stripFilePaths(crumb.message)
      }
    }
  }

  return event
}

export function initSentry(enabled: boolean): void {
  if (!enabled || initialized) return

  // The default IPC mode (Protocol + Classic) registers a privileged `sentry-ipc:`
  // scheme, which @sentry/electron requires to happen BEFORE the app 'ready' event
  // and otherwise throws "Sentry SDK should be initialized before the Electron app
  // 'ready' event is fired". The launch-time path (src/main/index.ts) inits before
  // whenReady so the default is fine there, but the runtime opt-in path (Settings
  // toggle → sentry:setEnabled) runs after 'ready'. In that case fall back to Classic
  // IPC, which needs no pre-ready scheme registration. Renderer→main envelope
  // forwarding is unaffected: the renderer prefers the preload-injected Classic IPC
  // (window.__SENTRY_IPC__) and only uses the sentry-ipc: protocol as a fallback.
  const ipcMode = app.isReady() ? IPCMode.Classic : IPCMode.Both

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: is.dev ? 'development' : 'production',
    release: app.getVersion(),
    sampleRate: 0.5,
    maxBreadcrumbs: 30,
    ipcMode,
    beforeSend
  })
  initialized = true
  console.log('[Sentry] Main process initialized')
}

export function setSentryEnabled(enabled: boolean): void {
  if (enabled) {
    initSentry(true)
  } else if (initialized) {
    Sentry.close()
    initialized = false
    console.log('[Sentry] Main process disabled')
  }
}
