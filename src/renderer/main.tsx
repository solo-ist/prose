import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './components/layout/App'
import { initDB, loadAnnotations as loadAnnotationsFromDB } from './lib/persistence'
import { useCommandHistoryStore } from './stores/commandHistoryStore'
import { seedEmojiCache } from './lib/emojiService'
import { ErrorBoundary } from './lib/sentry'
import { dumpPipelineLog, clearPipelineLog } from './lib/aiPipelineLog'
import { executeTool } from './lib/tools'
import { useAnnotationStore } from './extensions/ai-annotations'
import { useTabStore } from './stores/tabStore'
import { getApi } from './lib/browserApi'
import './lib/remarkableBridge'
import './index.css'

// Debug + test seams — same always-on tier as window.__prose_editor
// (editorInstanceStore.ts). __prose_debug is the bug-report workflow for the
// AI pipeline log (#672); __prose_tools lets Playwright drive the real tool
// pipeline (executors, mode checks, schema validation) with zero LLM
// involvement and inspect annotation state live and from IndexedDB.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_debug = {
  exportLog: dumpPipelineLog,
  clearLog: clearPipelineLog,
  copyLog: async () => {
    await getApi().copyToClipboard(dumpPipelineLog())
  },
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_tools = {
  executeTool,
  getAnnotations: () => useAnnotationStore.getState().annotations,
  getAnnotationDocId: () => useAnnotationStore.getState().documentId,
  // True while the annotation store suppresses position mapping (the ~100ms
  // window after tab/document switches). Tests poll this before dispatching
  // edits whose annotation mapping they assert on — an edit landing inside
  // the window is excluded from mapping (#674 known limitation).
  isAnnotationMappingPaused: () => useAnnotationStore.getState().isLoadingDocument,
  getActiveTabId: () => useTabStore.getState().activeTabId,
  loadAnnotationsFromDB,
}

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
