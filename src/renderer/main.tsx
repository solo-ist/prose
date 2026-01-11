import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './components/layout/App'
import { initDB } from './lib/persistence'
import './index.css'

// Initialize IndexedDB before React renders to ensure
// schema migrations complete before plugins access stores
initDB().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
