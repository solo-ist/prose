import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './components/layout/App'
import { initDB } from './lib/persistence'
import { useCommandHistoryStore } from './stores/commandHistoryStore'
import { seedEmojiCache } from './lib/emojiService'
import { ErrorBoundary } from './lib/sentry'
import './index.css'

function SentryFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-background text-foreground">
      <div className="text-center space-y-4 max-w-md px-4">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground">
          An unexpected error occurred. Try restarting Prose.
        </p>
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  )
}

// Initialize IndexedDB before React renders to ensure
// schema migrations complete before plugins access stores
initDB().then(async () => {
  // Load command history and emoji cache from IndexedDB
  await Promise.all([
    useCommandHistoryStore.getState().loadFromStorage(),
    seedEmojiCache()
  ])

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary fallback={SentryFallback}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
})
