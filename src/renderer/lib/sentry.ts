import * as Sentry from '@sentry/electron/renderer'
import React from 'react'

let initialized = false

const SENTRY_DSN = 'https://fd14a3e064b942f9ec02734f7d26d541@o4511057861476352.ingest.us.sentry.io/4511057863311360'

export function initRendererSentry(enabled: boolean): void {
  if (!enabled || initialized) return

  Sentry.init({ dsn: SENTRY_DSN })
  initialized = true
  console.log('[Sentry] Renderer initialized')
}

export function setRendererSentryEnabled(enabled: boolean): void {
  if (enabled) {
    initRendererSentry(true)
  } else if (initialized) {
    Sentry.close()
    initialized = false
    console.log('[Sentry] Renderer disabled')
  }
}

export function captureException(error: unknown): void {
  if (initialized) {
    Sentry.captureException(error)
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
