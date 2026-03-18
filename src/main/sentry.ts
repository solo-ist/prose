import * as Sentry from '@sentry/electron/main'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

let initialized = false

const SENTRY_DSN = 'https://fd14a3e064b942f9ec02734f7d26d541@o4511057861476352.ingest.us.sentry.io/4511057863311360'

export function initSentry(enabled: boolean): void {
  if (!enabled || initialized) return

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: is.dev ? 'development' : 'production',
    release: app.getVersion()
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
