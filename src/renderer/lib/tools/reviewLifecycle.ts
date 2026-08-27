/**
 * MCP-facing adapter for the durable review lifecycle stores.
 *
 * The suggestion extension owns canonical suggestion history and the review
 * event extension owns append-only events. This module translates their
 * renderer-facing actor/event shapes into the stable MCP result shape while
 * keeping comment and suggestion status domains separate.
 */

import type {
  AISuggestionData,
  SuggestionRecord,
  SuggestionFeedback as StoredSuggestionFeedback,
} from '../../extensions/ai-suggestions/types'
import type { CommentData, CommentReply } from '../../extensions/comments/types'
import {
  useSuggestionStore,
} from '../../extensions/ai-suggestions/store'
import {
  createReviewEvent,
  useReviewEventStore,
  type ReviewActor as StoredReviewActor,
  type ReviewEvent as StoredReviewEvent,
} from '../../extensions/review-events'
import { toolError } from '../../../shared/tools/types'
import type {
  ReviewAttribution,
  ToolExecutionContext,
  ToolResult,
} from '../../../shared/tools/types'

export type ReviewTargetType = 'comment' | 'suggestion'

export type ReviewEventType =
  | 'comment_created'
  | 'comment_replied'
  | 'comment_resolved'
  | 'comment_reopened'
  | 'suggestion_created'
  | 'suggestion_feedback'
  | 'suggestion_revised'
  | 'suggestion_decided'

export type SuggestionLifecycleStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'superseded'

export interface ReviewEvent {
  id: string
  documentId: string
  targetType: ReviewTargetType
  targetId: string
  eventType: ReviewEventType
  createdAt: number
  attribution: ReviewAttribution
  metadata?: Record<string, unknown>
}

export interface SuggestionFeedback {
  id: string
  text: string
  createdAt: number
  author: 'user' | 'ai'
  attribution: ReviewAttribution
}

export interface SuggestionLifecycleRecord {
  suggestion: AISuggestionData
  status: SuggestionLifecycleStatus
  feedback: SuggestionFeedback[]
  attribution: ReviewAttribution
  supersedesId?: string
  supersededById?: string
}

interface ToolProvenanceLike {
  model: string
  conversationId: string
  messageId: string
  documentId: string
}

interface CommentAttributionRecord {
  attribution: ReviewAttribution
  replies: Map<string, ReviewAttribution>
}

const commentAttributions = new Map<string, Map<string, CommentAttributionRecord>>()

/** Translate the trusted host context into the extension actor shape. */
export function toReviewActor(attribution: ReviewAttribution): StoredReviewActor {
  return {
    kind: attribution.actor === 'human' ? 'user' : attribution.actor === 'system' ? 'system' : 'agent',
    source: attribution.origin,
    model: attribution.model,
    conversationId: attribution.conversationId,
    messageId: attribution.messageId,
    invocationId: attribution.requestId,
  }
}

function fromReviewActor(actor: StoredReviewActor): ReviewAttribution {
  return {
    actor: actor.kind === 'user' ? 'human' : actor.kind === 'system' ? 'system' : 'assistant',
    origin: actor.source === 'ui' || actor.source === 'chat' || actor.source === 'mcp'
      ? actor.source
      : 'ui',
    ...(actor.model ? { model: actor.model } : {}),
    ...(actor.conversationId ? { conversationId: actor.conversationId } : {}),
    ...(actor.messageId ? { messageId: actor.messageId } : {}),
    ...(actor.invocationId ? { requestId: actor.invocationId } : {}),
  }
}

/** Resolve attribution from trusted execution context or legacy chat provenance. */
export function attributionForTool(
  context?: ToolExecutionContext,
  provenance?: ToolProvenanceLike
): ReviewAttribution {
  if (context?.attribution) return context.attribution
  if (provenance) {
    return {
      actor: 'assistant',
      origin: 'chat',
      label: provenance.model,
      model: provenance.model,
      conversationId: provenance.conversationId,
      messageId: provenance.messageId,
    }
  }
  return { actor: 'assistant', origin: 'chat', label: 'Prose assistant' }
}

/**
 * Check the document captured by the trusted MCP host against the live editor
 * identity. Non-MCP callers retain the existing behaviour; MCP callers must
 * provide an expected identity and are rejected when a tab switch races a
 * mutation.
 */
export function verifyExpectedDocumentId(
  context: ToolExecutionContext | undefined,
  currentDocumentId: string,
): ToolResult<never> | null {
  if (context?.origin !== 'mcp') return null

  if (!context.expectedDocumentId) {
    return toolError(
      'MCP tool execution is missing its expected document identity',
      'MCP_DOCUMENT_ID_MISSING',
    )
  }

  if (context.expectedDocumentId !== currentDocumentId) {
    return toolError(
      `MCP tool execution targeted document "${context.expectedDocumentId}", but the active document is "${currentDocumentId}"`,
      'MCP_DOCUMENT_CHANGED',
    )
  }

  return null
}

function eventKindFor(args: {
  targetType: ReviewTargetType
  eventType: ReviewEventType
  metadata?: Record<string, unknown>
}): StoredReviewEvent['kind'] {
  if (args.targetType === 'comment') {
    if (args.eventType === 'comment_created') return 'created'
    if (args.eventType === 'comment_replied') return 'replied'
    return 'resolved'
  }
  if (args.eventType === 'suggestion_created') return 'created'
  if (args.eventType === 'suggestion_feedback') return 'feedback'
  if (args.eventType === 'suggestion_revised') return 'superseded'
  return args.metadata?.decision === 'accept' ? 'accepted' : 'rejected'
}

function externalEvent(event: StoredReviewEvent): ReviewEvent {
  const payload = event.payload ?? {}
  let eventType: ReviewEventType
  if (event.target === 'comment') {
    if (event.kind === 'replied') eventType = 'comment_replied'
    else if (payload.reopened === true) eventType = 'comment_reopened'
    else if (event.kind === 'created') eventType = 'comment_created'
    else eventType = 'comment_resolved'
  } else if (event.kind === 'created') {
    eventType = 'suggestion_created'
  } else if (event.kind === 'feedback') {
    eventType = 'suggestion_feedback'
  } else if (event.kind === 'superseded') {
    eventType = 'suggestion_revised'
  } else {
    eventType = 'suggestion_decided'
  }

  return {
    id: event.id,
    documentId: event.documentId,
    targetType: event.target,
    targetId: event.targetId,
    eventType,
    createdAt: event.createdAt,
    attribution: fromReviewActor(event.actor),
    ...(Object.keys(payload).length > 0 ? { metadata: payload } : {}),
  }
}

/**
 * Update a callback-created event with trusted tool attribution and persist the
 * canonical event. This keeps the single callback writer while ensuring the
 * attribution survives reloads instead of living only in renderer memory.
 */
export function rememberReviewEventAttribution(eventId: string, attribution: ReviewAttribution): void {
  const store = useReviewEventStore.getState()
  const event = store.events.find((candidate) => candidate.id === eventId)
  if (!event) return

  const events = store.events.map((candidate) =>
    candidate.id === eventId
      ? { ...candidate, actor: toReviewActor(attribution) }
      : candidate,
  )
  useReviewEventStore.setState({ events })
  void useReviewEventStore.getState().saveEvents(event.documentId, events)
}

/** Append exactly one event for an executor-owned comment mutation. */
export function appendReviewEvent(args: {
  documentId: string
  targetType: ReviewTargetType
  targetId: string
  eventType: ReviewEventType
  attribution: ReviewAttribution
  metadata?: Record<string, unknown>
}): ReviewEvent {
  const expectedKind = eventKindFor(args)
  const event = createReviewEvent({
    documentId: args.documentId,
    target: args.targetType,
    targetId: args.targetId,
    kind: expectedKind,
    actor: toReviewActor(args.attribution),
    payload: args.metadata,
  })
  useReviewEventStore.getState().appendEvent(event)
  return externalEvent(event)
}

export function listReviewEvents(
  documentId: string,
  filter: {
    targetType?: ReviewTargetType
    targetId?: string
    eventType?: string
    after?: number
    limit?: number
  } = {}
): ReviewEvent[] {
  const limit = filter.limit ?? 100
  return useReviewEventStore.getState().events
    .filter((event) => event.documentId === documentId)
    .map(externalEvent)
    .filter((event) => {
      if (filter.targetType && event.targetType !== filter.targetType) return false
      if (filter.targetId && event.targetId !== filter.targetId) return false
      if (filter.eventType && event.eventType !== filter.eventType) return false
      if (filter.after !== undefined && event.createdAt <= filter.after) return false
      return true
    })
    .slice(-limit)
    .reverse()
}

/** Return the newest canonical event for one review target and event type. */
export function latestReviewEvent(
  documentId: string,
  targetType: ReviewTargetType,
  targetId: string,
  eventType?: ReviewEventType,
): ReviewEvent | undefined {
  return listReviewEvents(documentId, {
    targetType,
    targetId,
    ...(eventType ? { eventType } : {}),
    limit: 1,
  })[0]
}

/** Await the persistence promises exposed by the canonical lifecycle stores. */
export async function awaitReviewDurability(): Promise<void> {
  const pending = [
    useSuggestionStore.getState().pendingSave,
    useReviewEventStore.getState().pendingSave,
  ].filter((promise): promise is Promise<void> => promise !== null)
  if (pending.length > 0) await Promise.all(pending)
}

function feedbackId(suggestionId: string, feedback: StoredSuggestionFeedback, index: number): string {
  return `feedback-${suggestionId}-${feedback.createdAt}-${index}`
}

function externalFeedback(
  suggestionId: string,
  feedback: StoredSuggestionFeedback,
  index: number
): SuggestionFeedback {
  const attribution = fromReviewActor(feedback.actor)
  return {
    id: feedbackId(suggestionId, feedback, index),
    text: feedback.text,
    createdAt: feedback.createdAt,
    author: feedback.actor.kind === 'user' ? 'user' : 'ai',
    attribution,
  }
}

function externalSuggestion(record: SuggestionRecord): SuggestionLifecycleRecord {
  const attribution = record.createdBy ? fromReviewActor(record.createdBy) : attributionForTool()
  return {
    suggestion: record,
    status: record.status,
    feedback: record.feedback.map((feedback, index) => externalFeedback(record.id, feedback, index)),
    attribution,
    ...(record.supersedes?.[0] ? { supersedesId: record.supersedes[0] } : {}),
    ...(record.supersededBy?.[0] ? { supersededById: record.supersededBy[0] } : {}),
  }
}

/** Link a replacement suggestion to its predecessor exactly once. */
export function supersedeSuggestion(
  predecessorId: string,
  replacementId: string,
  attribution: ReviewAttribution,
): void {
  useSuggestionStore.getState().supersedeSuggestions(
    [predecessorId],
    replacementId,
    toReviewActor(attribution),
  )
}

export function getSuggestionRecord(documentId: string, id: string): SuggestionLifecycleRecord | undefined {
  const record = useSuggestionStore.getState().history.find(
    (candidate) => candidate.documentId === documentId && candidate.id === id
  )
  return record ? externalSuggestion(record) : undefined
}

export function getSuggestionRecords(documentId: string): SuggestionLifecycleRecord[] {
  return useSuggestionStore.getState().history
    .filter((record) => record.documentId === documentId)
    .map(externalSuggestion)
}

export function rememberCommentAttribution(
  documentId: string,
  commentId: string,
  attribution: ReviewAttribution
): void {
  const map = commentAttributions.get(documentId) ?? new Map<string, CommentAttributionRecord>()
  const existing = map.get(commentId)
  map.set(commentId, {
    attribution: existing?.attribution ?? attribution,
    replies: existing?.replies ?? new Map(),
  })
  commentAttributions.set(documentId, map)
}

export function rememberCommentReplyAttribution(
  documentId: string,
  commentId: string,
  replyId: string,
  attribution: ReviewAttribution
): void {
  const map = commentAttributions.get(documentId) ?? new Map<string, CommentAttributionRecord>()
  const existing = map.get(commentId) ?? { attribution, replies: new Map<string, ReviewAttribution>() }
  existing.replies.set(replyId, attribution)
  map.set(commentId, existing)
  commentAttributions.set(documentId, map)
}

export function getCommentAttribution(documentId: string, comment: CommentData): ReviewAttribution {
  const stored = commentAttributions.get(documentId)?.get(comment.id)?.attribution
  if (stored) return stored
  const event = [...useReviewEventStore.getState().events].reverse().find((candidate) =>
    candidate.documentId === documentId && candidate.target === 'comment' && candidate.targetId === comment.id
  )
  if (event) return fromReviewActor(event.actor)
  return comment.author === 'ai'
    ? { actor: 'assistant', origin: 'chat', label: 'Prose assistant' }
    : { actor: 'human', origin: 'ui', label: 'User' }
}

export function getReplyAttribution(
  documentId: string,
  commentId: string,
  reply: CommentReply
): ReviewAttribution {
  const stored = commentAttributions.get(documentId)?.get(commentId)?.replies.get(reply.id)
  if (stored) return stored
  const event = [...useReviewEventStore.getState().events].reverse().find((candidate) =>
    candidate.documentId === documentId &&
    candidate.target === 'comment' &&
    candidate.targetId === commentId &&
    candidate.kind === 'replied' &&
    candidate.payload?.replyId === reply.id
  )
  if (event) return fromReviewActor(event.actor)
  return reply.author === 'ai'
    ? { actor: 'assistant', origin: 'chat', label: 'Prose assistant' }
    : { actor: 'human', origin: 'ui', label: 'User' }
}
