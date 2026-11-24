import React from 'react'

type SentryModule = typeof import('@sentry/electron/renderer')

let sentryModule: SentryModule | null = null
let initialized = false
// What the writer last asked for. The SDK loads asynchronously, so an opt-out
// can arrive while `init` is still on its way.
let wanted = false

const SENTRY_DSN = 'https://fd14a3e064b942f9ec02734f7d26d541@o4511057861476352.ingest.us.sentry.io/4511057863311360'

/** Strip file paths from error messages and breadcrumbs to avoid leaking usernames */
function stripFilePaths(str: string): string {
  return str.replace(/\/Users\/[^\s:)"',]+/g, '/Users/[redacted]')
    .replace(/\/home\/[^\s:)"',]+/g, '/home/[redacted]')
    .replace(/[A-Z]:\\Users\\[^\s:)"',]+/g, '[redacted-path]')
}

async function loadSentry(): Promise<SentryModule> {
  if (!sentryModule) {
    sentryModule = await import('@sentry/electron/renderer')
  }
  return sentryModule
}

export async function initRendererSentry(enabled: boolean): Promise<void> {
  wanted = enabled
  if (!enabled || initialized) return

  try {
    const Sentry = await loadSentry()
    // Switched off, or started by another call, while the SDK loaded.
    if (!wanted || initialized) return
    Sentry.init({
      dsn: SENTRY_DSN,
      sampleRate: 0.5,
      maxBreadcrumbs: 30,
      beforeSend(event) {
        if (event.exception?.values) {
          for (const ex of event.exception.values) {
            if (ex.value) {
              ex.value = stripFilePaths(ex.value)
            }
          }
        }
        if (event.breadcrumbs) {
          for (const crumb of event.breadcrumbs) {
            if (crumb.message) {
              crumb.message = stripFilePaths(crumb.message)
            }
          }
        }
        return event
      }
    })
    initialized = true
    console.log('[Sentry] Renderer initialized')
  } catch (error) {
    console.warn('[Sentry] Failed to load renderer SDK:', error)
  }
}

export async function setRendererSentryEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await initRendererSentry(true)
    return
  }
  wanted = false
  if (initialized && sentryModule) {
    // Off at once (#1366): the SDK's global handlers stay installed, but they
    // report through the client, and a closed client sends nothing. Turning
    // reporting back on makes a new client with `init`.
    initialized = false
    try {
      await sentryModule.getClient()?.close()
    } catch (error) {
      console.warn('[Sentry] Failed to close renderer client:', error)
    }
    console.log('[Sentry] Renderer disabled')
  }
}

export function captureException(error: unknown): void {
  if (initialized && sentryModule) {
    sentryModule.captureException(error)
  }
}

interface ErrorBoundaryProps {
  fallback: React.ComponentType
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    captureException(error)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const Fallback = this.props.fallback
      return React.createElement(Fallback)
    }
    return this.props.children
  }
}
