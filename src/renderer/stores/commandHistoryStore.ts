/**
 * Command history store for terminal-like memory of slash command arguments.
 * Persists to IndexedDB for cross-session retention.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  loadCommandHistory,
  saveCommandHistory
} from '../lib/persistence'

const MAX_HISTORY_PER_TOOL = 10

interface CommandHistoryState {
  history: Record<string, string[]>
  isLoaded: boolean
  addArg: (toolName: string, arg: string) => void
  clearHistory: (toolName?: string) => void
  getRecentArgs: (toolName: string, limit?: number) => string[]
  loadFromStorage: () => Promise<void>
}

export const useCommandHistoryStore = create<CommandHistoryState>()(
  subscribeWithSelector((set, get) => ({
    history: {},
    isLoaded: false,

    addArg: (toolName: string, arg: string) => {
      if (!arg.trim()) return

      set((state) => {
        const existing = state.history[toolName] || []
        // Remove duplicates and add to front
        const filtered = existing.filter((a) => a !== arg)
        const updated = [arg, ...filtered].slice(0, MAX_HISTORY_PER_TOOL)

        return {
          history: {
            ...state.history,
            [toolName]: updated
          }
        }
      })
    },

    clearHistory: (toolName?: string) => {
      if (toolName) {
        set((state) => {
          const { [toolName]: _, ...rest } = state.history
          return { history: rest }
        })
      } else {
        set({ history: {} })
      }
    },

    getRecentArgs: (toolName: string, limit = 5) => {
      const args = get().history[toolName] || []
      return args.slice(0, limit)
    },

    loadFromStorage: async () => {
      const history = await loadCommandHistory()
      set({ history, isLoaded: true })
    }
  }))
)

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T {
  let timeoutId: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T
}

// Subscribe to changes and persist (debounced)
const debouncedSave = debounce(async (history: Record<string, string[]>) => {
  await saveCommandHistory(history)
}, 500)

useCommandHistoryStore.subscribe(
  (state) => state.history,
  (history) => {
    // Only save if loaded (avoid overwriting on initial load)
    if (useCommandHistoryStore.getState().isLoaded) {
      debouncedSave(history)
    }
  }
)
