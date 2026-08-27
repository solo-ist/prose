/**
 * MCP-facing review collaboration executors.
 *
 * Comments and suggestions intentionally use separate code paths and status
 * domains. The shared lifecycle adapter only records which review object an
 * event belongs to; it never merges comment state with suggestion state.
 */

import type { ToolResult, ToolExecutionContext } from '../../../../shared/tools/types'
import { toolError, toolSuccess } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useCommentStore } from '../../../extensions/comments/store'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import type { AISuggestionData } from '../../../extensions/ai-suggestions/types'
import { isEditorReadOnly, persistActiveSuggestions } from './editor'
import { generateId } from '../../persistence'
import {
  awaitReviewDurability,
  attributionForTool,
  getSuggestionRecords,
  latestReviewEvent,
  listReviewEvents,
  supersedeSuggestion,
  toReviewActor,
  verifyExpectedDocumentId,
  type SuggestionFeedback,
  type SuggestionLifecycleRecord,
  type SuggestionLifecycleStatus,
  type ReviewEvent,
} from '../reviewLifecycle'

function getDocumentId(): string {
  return useEditorStore.getState().document.documentId
}

function getEditor() {
  if (useEditorStore.getState().sourceMode) return null
  return useEditorInstanceStore.getState().editor
}

function suggestionRange(editor: ReturnType<typeof getEditor>, id: string): { from: number; to: number } | null {
  if (!editor) return null
  let from: number | null = null
  let to: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (!node.marks.some((mark) => mark.type.name === 'aiSuggestion' && mark.attrs.id === id)) return
    from = from === null ? pos : Math.min(from, pos)
    to = Math.max(to ?? pos + node.nodeSize, pos + node.nodeSize)
  })
  return from === null || to === null ? null : { from, to }
}

function formatFeedback(record: SuggestionLifecycleRecord): SuggestionFeedback[] {
  return record.feedback.map((feedback) => ({ ...feedback }))
}

function formatSuggestion(record: SuggestionLifecycleRecord, includeFeedback: boolean) {
  const suggestion = record.suggestion
  return {
    id: suggestion.id,
    type: suggestion.type,
    originalText: suggestion.originalText,
    suggestedText: suggestion.suggestedText,
    explanation: suggestion.explanation || undefined,
    createdAt: suggestion.createdAt,
    from: suggestion.from,
    to: suggestion.to,
    status: record.status,
    userReply: suggestion.userReply,
    ...(suggestion.insertionAnchorNodeId ? { insertionAnchorNodeId: suggestion.insertionAnchorNodeId } : {}),
    ...(suggestion.insertionAnchorText ? { insertionAnchorText: suggestion.insertionAnchorText } : {}),
    ...(suggestion.deletionNodeId ? { deletionNodeId: suggestion.deletionNodeId } : {}),
    ...(includeFeedback ? { feedback: formatFeedback(record) } : { feedback: [] }),
    ...(record.supersedesId ? { supersedesId: record.supersedesId } : {}),
    ...(record.supersededById ? { supersededById: record.supersededById } : {}),
    attribution: record.attribution,
    documentId: suggestion.documentId,
  }
}

function statusMatches(status: SuggestionLifecycleStatus, filter: string): boolean {
  return filter === 'all' || status === filter
}

export interface ListSuggestionsResult {
  documentId: string
  suggestions: ReturnType<typeof formatSuggestion>[]
}

export function executeListSuggestions(args: {
  status?: 'pending' | 'accepted' | 'rejected' | 'superseded' | 'all'
  includeFeedback?: boolean
  limit?: number
}, context?: ToolExecutionContext): ToolResult<ListSuggestionsResult> {
  const editor = getEditor()
  if (!editor) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')

  const documentId = getDocumentId()
  const identityError = verifyExpectedDocumentId(context, documentId)
  if (identityError) return identityError
  const liveSuggestions = getAISuggestions(editor)

  const status = args.status ?? 'pending'
  const includeFeedback = args.includeFeedback ?? true
  const limit = args.limit ?? 50
  const liveIds = new Set(liveSuggestions.map((suggestion) => suggestion.id))
  const records = getSuggestionRecords(documentId)
  const knownIds = new Set(records.map((record) => record.suggestion.id))
  const transientRecords: SuggestionLifecycleRecord[] = liveSuggestions
    .filter((suggestion) => !knownIds.has(suggestion.id))
    .map((suggestion) => ({
      suggestion: { ...suggestion, documentId: suggestion.documentId || documentId },
      status: 'pending',
      feedback: [],
      attribution: attributionForTool(context),
    }))

  const currentRecords = [...records, ...transientRecords]
    .filter((record) => statusMatches(record.status, status))
    .filter((record) => status === 'pending' ? liveIds.has(record.suggestion.id) : true)
    .sort((a, b) => b.suggestion.createdAt - a.suggestion.createdAt)
    .slice(0, limit)

  return toolSuccess({
    documentId,
    suggestions: currentRecords.map((record) => formatSuggestion(record, includeFeedback)),
  })
}

export async function executeAddSuggestionFeedback(
  args: { id: string; text: string },
  context?: ToolExecutionContext
): Promise<ToolResult<{
  documentId: string
  suggestionId: string
  feedbackId: string
  eventId: string
  status: 'pending'
}>> {
  const editor = getEditor()
  if (!editor) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  if (isEditorReadOnly()) return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')

  const text = args.text.trim()
  if (!text) return toolError('Feedback text is required', 'INVALID_INPUT')

  const documentId = getDocumentId()
  const identityError = verifyExpectedDocumentId(context, documentId)
  if (identityError) return identityError
  const live = getAISuggestions(editor).find((suggestion) => suggestion.id === args.id)
  if (!live) return toolError(`Suggestion with id "${args.id}" not found`, 'SUGGESTION_NOT_FOUND')

  const attribution = attributionForTool(context)
  const success = editor.commands.setAISuggestionReply(args.id, text, toReviewActor(attribution))
  if (!success) return toolError('Failed to attach feedback to suggestion', 'FEEDBACK_FAILED')

  // Feedback is part of the active mark while the suggestion remains
  // reviewable. Persist the updated snapshot before the MCP call returns so a
  // reload preserves the feedback on the inline mark as well as in history.
  await persistActiveSuggestions(editor, documentId)

  const event = latestReviewEvent(documentId, 'suggestion', args.id, 'suggestion_feedback')
  if (!event) {
    return toolError('Suggestion feedback was applied but its lifecycle event was not recorded', 'LIFECYCLE_EVENT_MISSING')
  }
  await awaitReviewDurability()
  const afterDurabilityError = verifyExpectedDocumentId(context, documentId)
  if (afterDurabilityError) return afterDurabilityError
  const feedbackAt = typeof event.metadata?.feedbackAt === 'number'
    ? event.metadata.feedbackAt
    : event.createdAt
  const feedbackId = `feedback-${args.id}-${feedbackAt}`

  return toolSuccess({
    documentId,
    suggestionId: args.id,
    feedbackId,
    eventId: event.id,
    status: 'pending',
  })
}

export async function executeReviseSuggestion(
  args: { id: string; content: string; comment?: string },
  context?: ToolExecutionContext
): Promise<ToolResult<{
  documentId: string
  suggested: true
  suggestionId: string
  supersedesId: string
  eventId: string
  status: 'pending'
}>> {
  const editor = getEditor()
  if (!editor) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  if (isEditorReadOnly()) return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')

  const documentId = getDocumentId()
  const identityError = verifyExpectedDocumentId(context, documentId)
  if (identityError) return identityError
  const current = getAISuggestions(editor).find((suggestion) => suggestion.id === args.id)
  if (!current) return toolError(`Suggestion with id "${args.id}" not found`, 'SUGGESTION_NOT_FOUND')

  const range = suggestionRange(editor, args.id)
  if (!range || range.from >= range.to) {
    return toolError(`Suggestion with id "${args.id}" has no editable range`, 'SUGGESTION_NOT_FOUND')
  }

  const attribution = attributionForTool(context)
  const suggestionId = generateId()
  const revisedAttrs = {
    id: suggestionId,
    type: current.type,
    originalText: current.originalText,
    suggestedText: args.content,
    explanation: args.comment ?? current.explanation,
    provenanceModel: attribution.model ?? current.provenanceModel ?? '',
    provenanceConversationId: attribution.conversationId ?? current.provenanceConversationId ?? '',
    provenanceMessageId: attribution.messageId ?? current.provenanceMessageId ?? '',
    provenanceSource: attribution.origin,
    provenanceInvocationId: attribution.requestId,
    documentId,
    insertionAnchorNodeId: current.insertionAnchorNodeId,
    insertionAnchorText: current.insertionAnchorText,
    deletionNodeId: current.deletionNodeId,
    supersedes: [args.id],
    blockConversionIntent: current.blockConversionIntent ?? null,
  }
  // Block insertions already contain their candidate paragraphs in the live
  // document. Their revision must replace those blocks before applying the
  // new mark; merely changing the mark metadata leaves the old wording on
  // screen and in the serialized markdown.
  const success = current.type === 'insertion'
    ? editor.commands.reviseAISuggestion(args.id, revisedAttrs)
    : editor
      .chain()
      .focus()
      .setTextSelection({ from: range.from, to: range.to })
      // Remove the predecessor mark without invoking rejectAISuggestion: the
      // editor callback would record a rejected decision before supersession.
      .unsetMark('aiSuggestion')
      .setAISuggestion(revisedAttrs)
      .run()

  if (!success) return toolError('Failed to create revised suggestion', 'REVISION_FAILED')

  const revised = getAISuggestions(editor).find((suggestion) => suggestion.id === suggestionId)
  if (!revised) return toolError('Revised suggestion was not created', 'REVISION_FAILED')

  await persistActiveSuggestions(editor, documentId)

  // The new mark's callback owns its created record/event. This single store
  // call owns the predecessor's superseded record/event and links both IDs.
  supersedeSuggestion(args.id, suggestionId, attribution)
  const event = latestReviewEvent(documentId, 'suggestion', args.id, 'suggestion_revised')
  if (!event) {
    return toolError('Suggestion revision was applied but its lifecycle event was not recorded', 'LIFECYCLE_EVENT_MISSING')
  }
  await awaitReviewDurability()
  const afterDurabilityError = verifyExpectedDocumentId(context, documentId)
  if (afterDurabilityError) return afterDurabilityError

  return toolSuccess({
    documentId,
    suggested: true,
    suggestionId,
    supersedesId: args.id,
    eventId: event.id,
    status: 'pending',
  })
}

export async function executeDecideSuggestion(
  args: { id: string; decision: 'accept' | 'reject' },
  context?: ToolExecutionContext
): Promise<ToolResult<{
  documentId: string
  suggestionId: string
  status: 'accepted' | 'rejected'
  eventId: string
}>> {
  const editor = getEditor()
  if (!editor) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  if (isEditorReadOnly()) return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')

  const documentId = getDocumentId()
  const identityError = verifyExpectedDocumentId(context, documentId)
  if (identityError) return identityError
  const target = getAISuggestions(editor).find((suggestion) => suggestion.id === args.id)
  if (!target) return toolError(`Suggestion with id "${args.id}" not found`, 'SUGGESTION_NOT_FOUND')

  const attribution = attributionForTool(context)
  const success = args.decision === 'accept'
    ? editor.commands.acceptAISuggestion(args.id, toReviewActor(attribution))
    : editor.commands.rejectAISuggestion(args.id, toReviewActor(attribution))
  if (!success) return toolError(`Failed to ${args.decision} suggestion`, 'DECISION_FAILED')

  // Accept/reject removes the live mark (and, for insertion/deletion, changes
  // the document structure). Persist that post-decision snapshot immediately
  // so a reload cannot resurrect a decided suggestion.
  await persistActiveSuggestions(editor, documentId)

  const status = args.decision === 'accept' ? 'accepted' : 'rejected'
  const event = latestReviewEvent(documentId, 'suggestion', args.id, 'suggestion_decided')
  if (!event) {
    return toolError('Suggestion decision was applied but its lifecycle event was not recorded', 'LIFECYCLE_EVENT_MISSING')
  }
  await awaitReviewDurability()
  const afterDurabilityError = verifyExpectedDocumentId(context, documentId)
  if (afterDurabilityError) return afterDurabilityError

  return toolSuccess({ documentId, suggestionId: args.id, status, eventId: event.id })
}

export function executeListReviewEvents(args: {
  targetType?: 'comment' | 'suggestion'
  targetId?: string
  eventType?: string
  after?: number
  limit?: number
}, context?: ToolExecutionContext): ToolResult<{ documentId: string; events: ReviewEvent[] }> {
  const editor = getEditor()
  if (!editor) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  const documentId = getDocumentId()
  const identityError = verifyExpectedDocumentId(context, documentId)
  if (identityError) return identityError
  return toolSuccess({
    documentId,
    events: listReviewEvents(documentId, args),
  })
}

export function executeGetReviewStatus(context?: ToolExecutionContext): ToolResult<{
  documentId: string
  comments: { total: number; open: number; resolved: number; withReplies: number }
  suggestions: { pending: number; withFeedback: number; accepted: number; rejected: number; superseded: number }
  latestEventAt?: number
}> {
  const editor = getEditor()
  if (!editor) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')

  // The comment store remains the sole source of truth for comment status.
  const comments = useCommentStore.getState().pendingComments
  const documentId = getDocumentId()
  const identityError = verifyExpectedDocumentId(context, documentId)
  if (identityError) return identityError
  const records = getSuggestionRecords(documentId)
  const liveIds = new Set(getAISuggestions(editor).map((suggestion) => suggestion.id))
  const pending = records.filter((record) => record.status === 'pending' && liveIds.has(record.suggestion.id))
  const countByStatus = (status: Exclude<SuggestionLifecycleStatus, 'pending' | 'superseded'>) => records.filter((record) => record.status === status).length
  const events = listReviewEvents(documentId, { limit: 1 })

  return toolSuccess({
    documentId,
    comments: {
      total: comments.length,
      open: comments.filter((comment) => !comment.resolved).length,
      resolved: comments.filter((comment) => comment.resolved === true).length,
      withReplies: comments.filter((comment) => (comment.replies?.length ?? 0) > 0).length,
    },
    suggestions: {
      pending: pending.length,
      withFeedback: pending.filter((record) => record.feedback.length > 0 || !!record.suggestion.userReply?.trim()).length,
      accepted: countByStatus('accepted'),
      rejected: countByStatus('rejected'),
      superseded: records.filter((record) => record.status === 'superseded').length,
    },
    ...(events[0] ? { latestEventAt: events[0].createdAt } : {}),
  })
}
