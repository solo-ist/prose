/**
 * AI suggestion persistence store.
 *
 * Pending suggestions are still kept as editor-restoration data. The history
 * collection is the durable lifecycle source of truth and survives mark
 * removal after acceptance, rejection, or supersession.
 */

import { create } from 'zustand'
import type {
  AISuggestionData,
  SuggestionFeedback,
  SuggestionRecord,
  SuggestionStatus,
} from './types'
import {
  deleteSuggestionHistory,
  deleteSuggestions as removeSuggestions,
  loadSuggestionHistory,
  loadSuggestions as fetchSuggestions,
  removeSuggestionsById,
  saveSuggestionHistory,
  saveSuggestions as persistSuggestions,
} from '../../lib/persistence'
import {
  createReviewEvent,
  useReviewEventStore,
  type ReviewActor,
} from '../review-events'
import { isMcpAttributionLabel } from '../../../shared/tools/mcpClientIdentity'

interface SuggestionPersistenceState {
  /** Current document ID being tracked. */
  documentId: string | null

  /** Pending suggestions used to restore active TipTap marks. */
  pendingSuggestions: AISuggestionData[]

  /** Canonical lifecycle records, including terminal decisions. */
  history: SuggestionRecord[]

  /** In-flight history persistence, awaited by tab/file switches. */
  pendingSave: Promise<void> | null

  /** Set the current document ID and clear in-memory document state. */
  setDocumentId: (documentId: string) => void

  /** Save current active marks to the legacy pending-suggestions store. */
  saveSuggestions: (documentId: string, suggestions: AISuggestionData[]) => Promise<void>

  /** Load active marks, lifecycle records, and review events for a document. */
  loadSuggestions: (documentId: string) => Promise<void>

  /** Save the canonical history, serialising writes to avoid stale snapshots. */
  saveHistory: (
    documentId: string,
    records?: SuggestionRecord[],
    removePendingIds?: readonly string[],
  ) => Promise<void>

  /** Record a newly-created suggestion. Idempotent by suggestion ID. */
  recordSuggestionAdded: (suggestion: AISuggestionData, actor?: ReviewActor) => void

  /** Record or update user/agent feedback on a suggestion. */
  recordSuggestionFeedback: (
    suggestion: AISuggestionData,
    feedback: SuggestionFeedback,
  ) => void

  /** Record an accept/reject decision after the mark transaction succeeds. */
  recordSuggestionDecision: (
    suggestion: AISuggestionData,
    status: Extract<SuggestionStatus, 'accepted' | 'rejected'>,
    actor: ReviewActor,
  ) => void

  /** Link one or more prior suggestions to a replacement suggestion. */
  supersedeSuggestions: (
    suggestionIds: string[],
    replacementId: string,
    actor: ReviewActor,
  ) => void

  /** Clear pending marks from memory (not from IndexedDB). */
  clearSuggestions: () => void

  /** Delete pending marks from IndexedDB for a document. */
  deleteSuggestions: (documentId: string) => Promise<void>

  /** Delete lifecycle history from IndexedDB for a document. */
  deleteHistory: (documentId: string) => Promise<void>

  /** Snapshot live marks for HMR replay. */
  snapshotSuggestions: (documentId: string, suggestions: AISuggestionData[]) => void
}

let historySaveQueue: Promise<void> = Promise.resolve()
let latestLoadGeneration = 0

function suggestionActor(suggestion: AISuggestionData): ReviewActor {
  const source = suggestion.provenanceSource ?? (
    isMcpAttributionLabel(suggestion.provenanceModel) ? 'mcp' :
      suggestion.provenanceModel ? 'chat' : 'system'
  )

  return {
    kind: 'agent',
    source,
    model: suggestion.provenanceModel || undefined,
    conversationId: suggestion.provenanceConversationId || undefined,
    messageId: suggestion.provenanceMessageId || undefined,
    invocationId: suggestion.provenanceInvocationId || undefined,
  }
}

function makeRecord(
  suggestion: AISuggestionData,
  documentId: string,
  actor?: ReviewActor,
): SuggestionRecord {
  const createdBy = actor ?? suggestionActor(suggestion)
  const feedback = suggestion.userReply?.trim()
    ? [{
        text: suggestion.userReply,
        createdAt: suggestion.createdAt,
        actor: { kind: 'user', source: 'ui' } as ReviewActor,
      }]
    : []

  return {
    ...suggestion,
    documentId,
    status: 'pending',
    feedback,
    createdBy,
  }
}

function normaliseRecord(record: SuggestionRecord, documentId: string): SuggestionRecord {
  const status: SuggestionStatus =
    record.status === 'accepted' ||
    record.status === 'rejected' ||
    record.status === 'superseded'
      ? record.status
      : 'pending'

  return {
    ...record,
    documentId,
    status,
    feedback: Array.isArray(record.feedback) ? record.feedback : [],
  }
}

function queueHistorySave(
  documentId: string,
  records: SuggestionRecord[],
  removePendingIds: readonly string[],
  setPendingSave: (pendingSave: Promise<void> | null) => void,
  getPendingSave: () => Promise<void> | null,
): Promise<void> {
  // A single renderer can receive feedback and a decision within one event
  // loop. Serialising snapshots prevents an older write winning in IndexedDB.
  historySaveQueue = historySaveQueue.catch(() => undefined).then(async () => {
    await saveSuggestionHistory(documentId, records)
    await removeSuggestionsById(documentId, removePendingIds)
  })
  const pendingSave = historySaveQueue
  setPendingSave(pendingSave)
  // Attach a rejection handler to the observer promise as well as to the
  // caller-facing promise. `finally()` would create a second rejected promise
  // when the transaction fails, producing an unhandled rejection.
  void pendingSave.then(() => {
    if (getPendingSave() === pendingSave) setPendingSave(null)
  }, () => {
    if (getPendingSave() === pendingSave) setPendingSave(null)
  })
  return pendingSave
}

function appendSuggestionEvent(
  record: SuggestionRecord,
  kind: 'created' | 'feedback' | 'accepted' | 'rejected' | 'superseded',
  actor: ReviewActor,
  payload?: Record<string, unknown>,
): void {
  useReviewEventStore.getState().appendEvent(createReviewEvent({
    documentId: record.documentId,
    target: 'suggestion',
    targetId: record.id,
    kind,
    actor,
    payload,
  }))
}

export const useSuggestionStore = create<SuggestionPersistenceState>((set, get) => ({
  documentId: null,
  pendingSuggestions: [],
  history: [],
  pendingSave: null,

  setDocumentId: (documentId: string) => {
    latestLoadGeneration += 1
    set({ documentId, pendingSuggestions: [], history: [], pendingSave: null })
    useReviewEventStore.getState().setDocumentId(documentId)
  },

  saveSuggestions: async (documentId: string, suggestions: AISuggestionData[]) => {
    if (!documentId) {
      console.warn('[SuggestionStore] No documentId provided, skipping save')
      return
    }

    await persistSuggestions(documentId, suggestions)
  },

  loadSuggestions: async (documentId: string) => {
    const generation = ++latestLoadGeneration

    // Clear the previous document's review records before awaiting IndexedDB.
    // Activity renders from these stores, so leaving them populated during a
    // tab handoff makes the feed appear to belong to the wrong document.
    if (get().documentId !== documentId) {
      set({ documentId, pendingSuggestions: [], history: [], pendingSave: null })
      useReviewEventStore.getState().setDocumentId(documentId)
    }

    const [loadedSuggestions, loadedHistory] = await Promise.all([
      fetchSuggestions(documentId),
      loadSuggestionHistory(documentId),
      useReviewEventStore.getState().loadEvents(documentId),
    ])

    if (generation !== latestLoadGeneration || get().documentId !== documentId) return

    const history = loadedHistory.map((record) => normaliseRecord(record, documentId))
    const terminalIds = new Set(
      history
        .filter((record) => record.status !== 'pending')
        .map((record) => record.id),
    )
    const suggestions = loadedSuggestions.filter((suggestion) => !terminalIds.has(suggestion.id))
    const pendingStoreChanged = suggestions.length !== loadedSuggestions.length
    const knownIds = new Set(history.map((record) => record.id))
    let backfilled = false

    // v9 only knew about active marks. Seed those records into the canonical
    // history without inventing terminal decisions or review events.
    for (const suggestion of suggestions) {
      if (!knownIds.has(suggestion.id)) {
        history.push(makeRecord(suggestion, documentId))
        backfilled = true
      }
    }

    set({ documentId, pendingSuggestions: suggestions, history })

    const saves: Promise<void>[] = []
    if (pendingStoreChanged) {
      // Remove stale active anchors left by older versions or a decision that
      // was interrupted after history persistence but before mark persistence.
      saves.push(persistSuggestions(documentId, suggestions))
    }
    if (backfilled) {
      saves.push(get().saveHistory(documentId, history))
    }
    await Promise.all(saves)
  },

  saveHistory: async (
    documentId: string,
    records = get().history,
    removePendingIds: readonly string[] = [],
  ) => {
    if (!documentId) return
    const pendingSave = queueHistorySave(
      documentId,
      records,
      removePendingIds,
      (next) => set({ pendingSave: next }),
      () => get().pendingSave,
    )
    await pendingSave
  },

  recordSuggestionAdded: (suggestion, actor) => {
    const current = get()
    const documentId = current.documentId || suggestion.documentId
    if (!documentId || !suggestion.id) return

    if (current.history.some((record) => record.id === suggestion.id)) return

    const record = makeRecord(suggestion, documentId, actor)
    const history = [...current.history, record]
    set({ history })
    appendSuggestionEvent(record, 'created', record.createdBy ?? suggestionActor(suggestion))
    void get().saveHistory(documentId, history).catch((error) => {
      console.error('[SuggestionStore] Failed to persist history:', error)
    })
  },

  recordSuggestionFeedback: (suggestion, feedback) => {
    const current = get()
    const documentId = current.documentId || suggestion.documentId
    if (!documentId || !suggestion.id || !feedback.text.trim()) return

    const existing = current.history.find((record) => record.id === suggestion.id)
    const base = existing ?? makeRecord(suggestion, documentId)
    const updated: SuggestionRecord = {
      ...base,
      userReply: feedback.text,
      feedback: [...base.feedback, feedback],
    }
    const history = existing
      ? current.history.map((record) => (record.id === suggestion.id ? updated : record))
      : [...current.history, updated]

    set({ history })
    appendSuggestionEvent(updated, 'feedback', feedback.actor, {
      feedback: feedback.text,
      feedbackAt: feedback.createdAt,
    })
    void get().saveHistory(documentId, history).catch((error) => {
      console.error('[SuggestionStore] Failed to persist history:', error)
    })
  },

  recordSuggestionDecision: (suggestion, status, actor) => {
    const current = get()
    const documentId = current.documentId || suggestion.documentId
    if (!documentId || !suggestion.id) return

    const existing = current.history.find((record) => record.id === suggestion.id)
    const base = existing ?? makeRecord(suggestion, documentId)
    const decidedAt = Date.now()
    const updated: SuggestionRecord = {
      ...base,
      status,
      decidedAt,
      decisionActor: actor,
      userReply: suggestion.userReply ?? base.userReply,
    }
    const history = existing
      ? current.history.map((record) => (record.id === suggestion.id ? updated : record))
      : [...current.history, updated]

    set({
      history,
      pendingSuggestions: current.pendingSuggestions.filter((candidate) => candidate.id !== suggestion.id),
    })
    appendSuggestionEvent(updated, status, actor, { decidedAt })
    void get().saveHistory(documentId, history, [suggestion.id]).catch((error) => {
      console.error('[SuggestionStore] Failed to persist decision:', error)
    })
  },

  supersedeSuggestions: (suggestionIds, replacementId, actor) => {
    const current = get()
    if (!replacementId || suggestionIds.length === 0) return

    const ids = new Set(suggestionIds)
    const now = Date.now()
    const history = current.history.map((record) => {
      if (!ids.has(record.id)) return record
      const supersededBy = Array.from(new Set([...(record.supersededBy ?? []), replacementId]))
      const updated = {
        ...record,
        status: 'superseded' as const,
        supersededBy,
        decidedAt: now,
        decisionActor: actor,
      }
      appendSuggestionEvent(updated, 'superseded', actor, { replacementId, decidedAt: now })
      return updated
    })

    const replacement = history.find((record) => record.id === replacementId)
    const linkedHistory = replacement
      ? history.map((record) => record.id === replacementId
        ? { ...record, supersedes: Array.from(new Set([...(record.supersedes ?? []), ...suggestionIds])) }
        : record)
      : history

    set({
      history: linkedHistory,
      pendingSuggestions: current.pendingSuggestions.filter((candidate) => !ids.has(candidate.id)),
    })
    const documentId = current.documentId || replacement?.documentId
    if (documentId) {
      void get().saveHistory(documentId, linkedHistory, Array.from(ids)).catch((error) => {
        console.error('[SuggestionStore] Failed to persist supersession:', error)
      })
    }
  },

  clearSuggestions: () => {
    set({ pendingSuggestions: [] })
  },

  deleteSuggestions: async (documentId: string) => {
    await removeSuggestions(documentId)

    if (get().documentId === documentId) {
      set({ pendingSuggestions: [] })
    }
  },

  deleteHistory: async (documentId: string) => {
    const pendingSave = get().pendingSave
    if (pendingSave) await pendingSave
    await deleteSuggestionHistory(documentId)

    if (get().documentId === documentId) {
      set({ history: [], pendingSave: null })
    }
  },

  snapshotSuggestions: (documentId: string, suggestions: AISuggestionData[]) => {
    if (suggestions.length === 0) return
    set({ documentId, pendingSuggestions: suggestions })
  },
}))
