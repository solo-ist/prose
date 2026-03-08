import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './components/layout/App'
import { initDB } from './lib/persistence'
import { useCommandHistoryStore } from './stores/commandHistoryStore'
import { seedEmojiCache } from './lib/emojiService'
import { createMockApi } from './mocks/webApi'
import './index.css'

// Mark as web mode so components can distinguish from Electron
;(window as Window & { __webMode?: boolean }).__webMode = true

// Inject mock API before anything accesses window.api
window.api = createMockApi()

initDB().then(async () => {
  await Promise.all([
    useCommandHistoryStore.getState().loadFromStorage(),
    seedEmojiCache(),
  ])

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
