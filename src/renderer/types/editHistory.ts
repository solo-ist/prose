/**
 * AI Edit History Types
 *
 * Persists a permanent log of AI-applied edits keyed by documentId.
 * Annotations fade visually over 7 days; the history ledger is permanent.
 *
 * Design intent: Each `EditHistoryEntry` is an immutable record snapshotted
 * at the moment an AI edit is applied. It captures the content that was
 * changed, where in the document it appeared (character offset at time of
 * application), and full provenance from the annotation. The history store
 * reads from the annotation store to get live position data, but also owns a
 * separate IndexedDB store so entries survive past the annotation fade window.
 */

import type { AIProvenance, AnnotationType } from './annotations'

/**
 * A single entry in the AI edit history log.
 * Immutable once created — we snapshot the content at the time of the edit.
 */
export interface EditHistoryEntry {
  /** Unique ID for this history entry */
  id: string
  /** The document this edit was applied to */
  documentId: string
  /** Matching annotation ID (may no longer be live) */
  annotationId: string
  /** Type of edit: insertion or replacement */
  type: AnnotationType
  /** When the edit was applied (ms timestamp) */
  appliedAt: number
  /** The text that was inserted or the new replacement text */
  content: string
  /** The original text that was replaced (only meaningful for 'replacement' type) */
  originalContent?: string
  /** Character offset in the document at time of application (for display only — not reliably trackable long-term) */
  charOffset?: number
  /** Provenance information about the AI that generated the edit */
  provenance: AIProvenance
  /** Model-supplied reason for the edit */
  explanation?: string
  /**
   * Whether this edit has been "dismissed" from the visible history log.
   * Dismissed entries are retained in storage for audit purposes but hidden
   * from the default view. This avoids permanent data loss from a simple dismiss.
   */
  dismissed: boolean
}

/**
 * State type for the edit history store.
 */
export interface EditHistoryState {
  /** All history entries for the current document, newest first */
  entries: EditHistoryEntry[]
  /** The document ID these entries belong to */
  documentId: string | null
  /** Whether entries are loading from IndexedDB */
  isLoading: boolean
  /** Whether to show dismissed entries in the panel */
  showDismissed: boolean
}

/**
 * Actions for the edit history store.
 */
export interface EditHistoryActions {
  /** Record a new AI edit (called when an annotation is added) */
  recordEdit: (entry: Omit<EditHistoryEntry, 'dismissed'>) => Promise<void>
  /** Dismiss (hide, not delete) a history entry */
  dismissEntry: (id: string) => Promise<void>
  /** Restore a dismissed entry */
  restoreEntry: (id: string) => Promise<void>
  /** Load history for a document from IndexedDB */
  loadHistory: (documentId: string) => Promise<void>
  /** Toggle showing dismissed entries */
  setShowDismissed: (show: boolean) => void
  /** Clear all history for the current document (destructive — use with caution) */
  clearHistory: () => Promise<void>
}

/**
 * Groups entries by date for display.
 */
export interface EditHistoryGroup {
  /** Display label for the group (e.g. "Today", "Yesterday", "May 26") */
  label: string
  /** Entries in this group, newest first */
  entries: EditHistoryEntry[]
}
