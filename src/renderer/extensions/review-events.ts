/**
 * Durable review events shared by AI suggestions and comment threads.
 *
 * Review marks are deliberately short-lived editor anchors. This store keeps
 * the append-only activity that an MCP worker (and future review surfaces) can
 * inspect after a mark has been accepted, rejected, resolved, or replaced.
 */

import { create } from 'zustand'
import {
  deleteReviewEvents,
  loadReviewEvents,
  saveReviewEvents,
} from '../lib/persistence'

export type ReviewEventTarget = 'suggestion' | 'comment'

export type ReviewEventKind =
  | 'created'
  | 'feedback'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'replied'
  | 'resolved'

export type ReviewActorKind = 'user' | 'agent' | 'system'

export interface ReviewActor {
  kind: ReviewActorKind
  source?: 'ui' | 'chat' | 'mcp' | 'system' | 'unknown'
  model?: string
  conversationId?: string
  messageId?: string
  invocationId?: string
}

export interface ReviewEvent {
  id: string
  documentId: string
  target: ReviewEventTarget
  targetId: string
  kind: ReviewEventKind
  createdAt: number
  actor: ReviewActor
  /** Event-specific data kept for MCP and future review UIs. */
  payload?: Record<string, unknown>
}

interface ReviewEventPersistenceState {
  documentId: string | null
  events: ReviewEvent[]
  pendingSave: Promise<void> | null
  setDocumentId: (documentId: string) => void
  loadEvents: (documentId: string) => Promise<void>
  saveEvents: (documentId: string, events?: ReviewEvent[]) => Promise<void>
  appendEvent: (event: ReviewEvent) => void
  deleteEvents: (documentId: string) => Promise<void>
}

let saveQueue: Promise<void> = Promise.resolve()
let latestLoadGeneration = 0

function queueSave(
  documentId: string,
  events: ReviewEvent[],
  setPendingSave: (pendingSave: Promise<void> | null) => void,
  getPendingSave: () => Promise<void> | null,
): Promise<void> {
  // Serialising writes prevents a rapid sequence such as feedback → reject
  // from allowing an older snapshot to overwrite the newer event list.
  saveQueue = saveQueue.catch(() => undefined).then(() => saveReviewEvents(documentId, events))
  const pendingSave = saveQueue
  setPendingSave(pendingSave)
  // Observe completion without creating a second rejected promise. A bare
  // `void pendingSave.finally(...)` would surface an unhandled rejection when
  // the IndexedDB transaction fails.
  void pendingSave.then(() => {
    if (getPendingSave() === pendingSave) setPendingSave(null)
  }, () => {
    if (getPendingSave() === pendingSave) setPendingSave(null)
  })
  return pendingSave
}

export function createReviewEvent(args: {
  documentId: string
  target: ReviewEventTarget
  targetId: string
  kind: ReviewEventKind
  actor: ReviewActor
  payload?: Record<string, unknown>
  createdAt?: number
}): ReviewEvent {
  return {
    id: crypto.randomUUID(),
    documentId: args.documentId,
    target: args.target,
    targetId: args.targetId,
    kind: args.kind,
    createdAt: args.createdAt ?? Date.now(),
    actor: args.actor,
    ...(args.payload ? { payload: args.payload } : {}),
  }
}

export const useReviewEventStore = create<ReviewEventPersistenceState>((set, get) => ({
  documentId: null,
  events: [],
  pendingSave: null,

  setDocumentId: (documentId: string) => {
    latestLoadGeneration += 1
    set({ documentId, events: [], pendingSave: null })
  },

  loadEvents: async (documentId: string) => {
    const generation = ++latestLoadGeneration
    const events = await loadReviewEvents(documentId)
    if (generation !== latestLoadGeneration || get().documentId !== documentId) return
    set({ documentId, events })
  },

  saveEvents: async (documentId: string, events = get().events) => {
    if (!documentId) return
    const pendingSave = queueSave(
      documentId,
      events,
      (next) => set({ pendingSave: next }),
      () => get().pendingSave,
    )
    await pendingSave
  },

  appendEvent: (event: ReviewEvent) => {
    if (!event.documentId || !event.targetId) return

    const current = get()
    const currentEvents = current.documentId === event.documentId ? current.events : []
    if (currentEvents.some((existing) => existing.id === event.id)) return

    const events = [...currentEvents, event]
    set({ documentId: event.documentId, events })
    void queueSave(
      event.documentId,
      events,
      (next) => set({ pendingSave: next }),
      () => get().pendingSave,
    ).catch((error) => {
      console.error('[ReviewEventStore] Failed to persist event:', error)
    })
  },

  deleteEvents: async (documentId: string) => {
    await deleteReviewEvents(documentId)
    if (get().documentId === documentId) {
      set({ events: [], pendingSave: null })
    }
  },
}))
