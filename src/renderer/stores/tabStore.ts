import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { generateId, saveSession, loadSession, clearSession } from '../lib/persistence'
import type { SessionState, TabDraft } from '../lib/persistence'
import { useChatStore } from './chatStore'

export interface Tab {
  id: string              // Unique tab ID
  documentId: string      // Links to chat/annotations
  path: string | null     // File path (null = untitled)
  title: string           // Display name (may be H1 text for untitled docs)
  baseTitle?: string      // Original 'Untitled N' title for untitled docs (for H1 revert)
  isDirty: boolean        // Unsaved changes
  isPreview?: boolean     // Preview tab (transient, replaced on next single-click)
  // Cached state for when tab is not active
  content?: string
  frontmatter?: Record<string, unknown>
  cursorPosition?: { line: number; column: number }
}

interface TabState {
  tabs: Tab[]
  activeTabId: string | null

  // Tab actions
  addTab: (tab: Omit<Tab, 'id'> & { id?: string }) => string
  removeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, updates: Partial<Tab>) => void
  getActiveTab: () => Tab | null
  getTabByPath: (path: string) => Tab | null
  getTabById: (tabId: string) => Tab | null
  getPreviewTab: () => Tab | null
  promotePreviewTab: (tabId: string) => void

  // Utility
  getNextUntitledNumber: () => number
  reorderTabs: (fromIndex: number, toIndex: number) => void
  setTabOrder: (tabs: Tab[]) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
}

// Counter for untitled documents
let untitledCounter = 1

export const useTabStore = create<TabState>()(
  subscribeWithSelector((set, get) => ({
    tabs: [],
    activeTabId: null,

    addTab: (tabData) => {
      const id = tabData.id ?? generateId()
      const tab: Tab = {
        ...tabData,
        id
      }

      set((state) => ({
        tabs: [...state.tabs, tab],
        activeTabId: id
      }))

      return id
    },

    removeTab: (tabId) => {
      set((state) => {
        const tabIndex = state.tabs.findIndex(t => t.id === tabId)
        if (tabIndex === -1) return state

        const newTabs = state.tabs.filter(t => t.id !== tabId)

        // If removing the active tab, select an adjacent one
        let newActiveTabId = state.activeTabId
        if (state.activeTabId === tabId) {
          if (newTabs.length === 0) {
            newActiveTabId = null
          } else if (tabIndex < newTabs.length) {
            // Select tab at same index (the one that moved up)
            newActiveTabId = newTabs[tabIndex].id
          } else {
            // Select the last tab
            newActiveTabId = newTabs[newTabs.length - 1].id
          }
        }

        return {
          tabs: newTabs,
          activeTabId: newActiveTabId
        }
      })
    },

    setActiveTab: (tabId) => {
      const state = get()
      const tab = state.tabs.find(t => t.id === tabId)
      if (tab) {
        set({ activeTabId: tabId })
      }
    },

    updateTab: (tabId, updates) => {
      set((state) => ({
        tabs: state.tabs.map(t =>
          t.id === tabId ? { ...t, ...updates } : t
        )
      }))
    },

    getActiveTab: () => {
      const state = get()
      return state.tabs.find(t => t.id === state.activeTabId) ?? null
    },

    getTabByPath: (path) => {
      const state = get()
      return state.tabs.find(t => t.path === path) ?? null
    },

    getTabById: (tabId) => {
      const state = get()
      return state.tabs.find(t => t.id === tabId) ?? null
    },

    getPreviewTab: () => {
      const state = get()
      return state.tabs.find(t => t.isPreview) ?? null
    },

    promotePreviewTab: (tabId) => {
      set((state) => ({
        tabs: state.tabs.map(t =>
          t.id === tabId ? { ...t, isPreview: false } : t
        )
      }))
    },

    getNextUntitledNumber: () => {
      const state = get()
      // Include tabs whose baseTitle starts with 'Untitled' (even if title was set to H1 text)
      const untitledTabs = state.tabs.filter(t => {
        if (t.path) return false
        const checkTitle = t.baseTitle ?? t.title
        return checkTitle.startsWith('Untitled')
      })

      if (untitledTabs.length === 0) {
        return 1
      }

      // Find the next available number using baseTitle (original 'Untitled N') when present
      const usedNumbers = new Set<number>()
      for (const tab of untitledTabs) {
        const checkTitle = tab.baseTitle ?? tab.title
        if (checkTitle === 'Untitled') {
          usedNumbers.add(1)
        } else {
          const match = checkTitle.match(/^Untitled (\d+)$/)
          if (match) {
            usedNumbers.add(parseInt(match[1], 10))
          }
        }
      }

      let num = 1
      while (usedNumbers.has(num)) {
        num++
      }
      return num
    },

    reorderTabs: (fromIndex, toIndex) => {
      set((state) => {
        const newTabs = [...state.tabs]
        const [removed] = newTabs.splice(fromIndex, 1)
        newTabs.splice(toIndex, 0, removed)
        return { tabs: newTabs }
      })
    },

    setTabOrder: (tabs) => {
      set({ tabs })
    },

    closeOtherTabs: (tabId) => {
      set((state) => ({
        tabs: state.tabs.filter(t => t.id === tabId),
        activeTabId: tabId
      }))
    },

    closeAllTabs: () => {
      set({
        tabs: [],
        activeTabId: null
      })
    }
  }))
)

// Helper to generate untitled tab title
export function generateUntitledTitle(): string {
  const num = useTabStore.getState().getNextUntitledNumber()
  return num === 1 ? 'Untitled' : `Untitled ${num}`
}

// Helper to create a new tab with default values
export function createTab(overrides: Partial<Tab> = {}): Omit<Tab, 'id'> {
  const documentId = overrides.documentId ?? generateId()
  const title = overrides.title ?? generateUntitledTitle()

  return {
    documentId,
    path: overrides.path ?? null,
    title,
    isDirty: overrides.isDirty ?? false,
    content: overrides.content,
    frontmatter: overrides.frontmatter,
    cursorPosition: overrides.cursorPosition
  }
}

// Session persistence helpers

/**
 * Save the current session state to IndexedDB
 */
export async function persistSession(): Promise<void> {
  const state = useTabStore.getState()
  const chatState = useChatStore.getState()

  const tabs: TabDraft[] = state.tabs.map(tab => ({
    tabId: tab.id,
    documentId: tab.documentId,
    path: tab.path,
    title: tab.title,
    baseTitle: tab.baseTitle,
    content: tab.content ?? '',
    isDirty: tab.isDirty,
    frontmatter: tab.frontmatter,
    cursorPosition: tab.cursorPosition,
    activeChatId: tab.documentId === chatState.currentDocumentId
      ? chatState.activeConversationId
      : null
  }))

  const session: SessionState = {
    tabs,
    activeTabId: state.activeTabId,
    savedAt: Date.now()
  }

  await saveSession(session)
}

/**
 * Load session state from IndexedDB
 */
export async function restoreSession(): Promise<SessionState | null> {
  return loadSession()
}

/**
 * Clear saved session
 */
export async function clearSavedSession(): Promise<void> {
  await clearSession()
}

/**
 * Check if there are any unsaved tabs in the session
 */
export function hasUnsavedTabs(session: SessionState): boolean {
  return session.tabs.some(tab => tab.isDirty)
}

// Auto-save session on tab changes (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | null = null

export function scheduleSaveSession(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  saveTimeout = setTimeout(() => {
    persistSession()
    saveTimeout = null
  }, 1000)
}

// Subscribe to tab changes and auto-save
useTabStore.subscribe(
  (state) => ({ tabs: state.tabs, activeTabId: state.activeTabId }),
  () => {
    // Only schedule save if we have tabs (don't save empty sessions)
    if (useTabStore.getState().tabs.length > 0) {
      scheduleSaveSession()
    }
  },
  { equalityFn: (a, b) => a.tabs === b.tabs && a.activeTabId === b.activeTabId }
)
