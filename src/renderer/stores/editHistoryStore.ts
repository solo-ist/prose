/**
 * AI Edit History Store
 *
 * Zustand store for the permanent AI edit history log.
 *
 * Architecture:
 * - `annotations` store: live, position-tracked, fade over 7 days, per-document
 * - `editHistoryStore` (this): permanent ledger of applied AI edits, IndexedDB-backed
 *
 * The annotation store calls `recordEdit()` when a new annotation is created.
 * This store persists the immutable snapshot independently so the history survives
 * past the annotation fade window and across document opens.
 *
 * Design intent:
 * - History is keyed by documentId (same key space as annotations)
 * - Entries are appended and never mutated (dismissed flag is the only exception)
 * - Loading is triggered by the same document-load pathway as annotations
 */

import { create } from 'zustand'
import type {
  EditHistoryEntry,
  EditHistoryState,
  EditHistoryActions,
  EditHistoryGroup,
} from '../types/editHistory'
import { loadEditHistory, saveEditHistory, deleteEditHistory } from '../lib/persistence'

type EditHistoryStore = EditHistoryState & EditHistoryActions

// Per-document promise chain used to serialize concurrent saveEditHistory calls.
// Rapid successive recordEdit calls each write the full entries blob; without
// serialization an out-of-order async completion can clobber a newer write with
// an older snapshot. Chaining on a per-document tail ensures each save starts
// only after the previous one for that document has settled.
const saveQueues = new Map<string, Promise<void>>()

function enqueueSave(docId: string, entries: EditHistoryEntry[]): void {
  const prev = saveQueues.get(docId) ?? Promise.resolve()
  const next = prev.then(() => saveEditHistory(docId, entries)).catch(() => {/* swallow – store already updated */})
  saveQueues.set(docId, next)
}

export const useEditHistoryStore = create<EditHistoryStore>((set, get) => ({
  entries: [],
  documentId: null,
  isLoading: false,
  showDismissed: false,

  recordEdit: async (entryData) => {
    const entry: EditHistoryEntry = { ...entryData, dismissed: false }

    // Optimistic update: prepend (newest first)
    set((state) => ({ entries: [entry, ...state.entries] }))

    // Persist using the entry's own documentId so the first edit(s) of a
    // session are not silently dropped while loadHistory is still resolving
    // (during which get().documentId is null).
    const persistDocId = entryData.documentId || get().documentId
    if (persistDocId) {
      // Snapshot the up-to-date entries array *after* the optimistic set above.
      const { entries } = get()
      enqueueSave(persistDocId, entries)
    }
    // Also seed the store's documentId if it hasn't been set yet.
    if (!get().documentId && entryData.documentId) {
      set({ documentId: entryData.documentId })
    }
  },

  dismissEntry: async (id) => {
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, dismissed: true } : e
      ),
    }))
    const { documentId, entries } = get()
    if (documentId) {
      enqueueSave(documentId, entries)
    }
  },

  restoreEntry: async (id) => {
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, dismissed: false } : e
      ),
    }))
    const { documentId, entries } = get()
    if (documentId) {
      enqueueSave(documentId, entries)
    }
  },

  loadHistory: async (documentId) => {
    set({ isLoading: true, documentId })
    try {
      const entries = await loadEditHistory(documentId)
      set({ entries, isLoading: false })
    } catch {
      set({ entries: [], isLoading: false })
    }
  },

  setShowDismissed: (show) => set({ showDismissed: show }),

  clearHistory: async () => {
    const { documentId } = get()
    set({ entries: [] })
    if (documentId) {
      await deleteEditHistory(documentId)
    }
  },
}))

// ─── Derived helpers ──────────────────────────────────────────────────────────

/**
 * Group entries by calendar day for display.
 * Newest-first entries → newest-first groups.
 */
export function groupEntriesByDate(entries: EditHistoryEntry[]): EditHistoryGroup[] {
  const groups: Map<string, EditHistoryGroup> = new Map()

  for (const entry of entries) {
    const label = formatGroupLabel(entry.appliedAt)
    if (!groups.has(label)) {
      groups.set(label, { label, entries: [] })
    }
    groups.get(label)!.entries.push(entry)
  }

  return Array.from(groups.values())
}

function formatGroupLabel(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)

  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((nowMidnight.getTime() - dateMidnight.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined })
}

/**
 * Compact display name for a model string.
 * e.g. "claude-sonnet-4-6" → "Sonnet 4.6"
 * e.g. "external" → "External"
 */
export function formatModelName(model: string): string {
  if (!model || model === 'external') return 'External'
  // Strip "claude-" prefix, title-case the rest, convert hyphens to spaces + dots for version numbers
  const cleaned = model
    .replace(/^claude[-/]?/, '')
    .replace(/-(\d)/g, '.$1')   // -4-6 → .4.6
    .replace(/-/g, ' ')
    .trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}
