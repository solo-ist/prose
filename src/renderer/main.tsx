import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './components/layout/App'
import { initDB } from './lib/persistence'
import { useCommandHistoryStore } from './stores/commandHistoryStore'
import './index.css'

// Initialize IndexedDB before React renders to ensure
// schema migrations complete before plugins access stores
initDB().then(async () => {
  // Load command history from IndexedDB
  await useCommandHistoryStore.getState().loadFromStorage()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
