/**
 * Review tools (#890): the suggestion lifecycle over the review log (#1233).
 * Agents read, give feedback, revise and follow the events; the writer decides
 * in Prose (#607). Every actor is reported by label: the writer is "the
 * writer", never their name or email.
 */

import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import type { ToolContext } from '../context'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { reviewLogOf, eventsSince, type SuggestionHistory } from '../../../extensions/review-log'
import { threadsOf } from '../../../extensions/comments/transactions'
import { actorLabel, actorOfProvenance, type Actor } from '../../../../shared/review/actor'
import { executeSuggestEdit, isEditorReadOnly } from './editor'

function by(actor: Actor): { by: string; byKind: Actor['kind'] } {
  return { by: actorLabel(actor, { selfName: null }), byKind: actor.kind }
}

const AGENT_FALLBACK: Actor = { kind: 'unattributed', label: 'AI' }

/** The pending suggestions of a document, one per id, in document order. */
function pendingSuggestions(state: Parameters<typeof getAISuggestions>[0]['state']) {
  const seen = new Set<string>()
  return getAISuggestions({ state }).filter((s) => !seen.has(s.id) && (seen.add(s.id), true))
}

function feedbackOf(row: SuggestionHistory | undefined) {
  return (row?.feedback ?? []).map((f) => ({ text: f.text, createdAt: f.createdAt, ...by(f.actor) }))
}

export function executeListSuggestions(args: { include?: 'pending' | 'all' }, ctx: ToolContext): ToolResult {
  const { handle } = ctx
  if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  const log = reviewLogOf(handle.state)
  const rows = new Map(log.suggestions.map((s) => [s.id, s]))
  const pending = pendingSuggestions(handle.state)
  const suggestions: Array<Record<string, unknown>> = pending.map((s) => {
    const row = rows.get(s.id)
    return {
      id: s.id,
      status: 'pending',
      originalText: s.originalText,
      suggestedText: s.suggestedText,
      explanation: s.explanation,
      createdAt: s.createdAt,
      ...by(row?.actor ?? actorOfProvenance(s.provenanceModel, s.actor)),
      feedback: feedbackOf(row),
      ...(row?.supersedes ? { revises: row.supersedes } : {}),
    }
  })
  if (args.include === 'all') {
    const live = new Set(pending.map((s) => s.id))
    for (const row of log.suggestions) {
      if (live.has(row.id) || row.status === 'pending') continue
      suggestions.push({
        id: row.id,
        status: row.status,
        originalText: row.originalText,
        suggestedText: row.suggestedText,
        explanation: row.explanation,
        createdAt: row.createdAt,
        ...by(row.actor),
        feedback: feedbackOf(row),
        ...(row.decidedBy ? { decidedBy: actorLabel(row.decidedBy, { selfName: null }), decidedAt: row.decidedAt } : {}),
        ...(row.supersedes ? { revises: row.supersedes } : {}),
        ...(row.supersededBy ? { supersededBy: row.supersededBy } : {}),
      })
    }
  }
  return toolSuccess({ suggestions })
}

export function executeReplyToSuggestion(args: { id: string; text: string }, ctx: ToolContext): ToolResult {
  const { handle } = ctx
  if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  if (isEditorReadOnly(handle)) return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  const text = args.text?.trim()
  if (!text) return toolError('Feedback text is required', 'INVALID_INPUT')
  if (!pendingSuggestions(handle.state).some((s) => s.id === args.id)) {
    return toolError(`No pending suggestion "${args.id}". Call list_suggestions for the pending ones.`, 'SUGGESTION_NOT_FOUND')
  }
  handle.commands.setAISuggestionReply(args.id, text, ctx.provenance?.actor ?? AGENT_FALLBACK)
  return toolSuccess({ suggestionId: args.id })
}

export function executeReviseSuggestion(args: { id: string; content: string; comment?: string }, ctx: ToolContext): ToolResult {
  const { handle } = ctx
  if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  const target = pendingSuggestions(handle.state).find((s) => s.id === args.id)
  if (!target) {
    return toolError(`No pending suggestion "${args.id}". Call list_suggestions for the pending ones.`, 'SUGGESTION_NOT_FOUND')
  }
  // The node the suggestion covers: the nearest ancestor of its start with an id.
  const $from = handle.state.doc.resolve(target.from)
  let nodeId: string | null = null
  for (let depth = $from.depth; depth >= 0 && !nodeId; depth--) {
    const id = $from.node(depth).attrs?.nodeId
    if (typeof id === 'string' && id) nodeId = id
  }
  if (!nodeId) return toolError(`Suggestion "${args.id}" is not on an addressable node`, 'SUGGESTION_NOT_FOUND')
  const result = executeSuggestEdit(
    { nodeId, content: args.content, comment: args.comment ?? target.explanation },
    ctx,
    { revises: args.id }
  )
  if (!result.success) return result
  return toolSuccess({ suggestionId: result.data.suggestionId, supersedes: args.id })
}

export function executeGetReviewStatus(ctx: ToolContext): ToolResult {
  const { handle } = ctx
  if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  const log = reviewLogOf(handle.state)
  const counts = { accepted: 0, rejected: 0, superseded: 0 }
  for (const row of log.suggestions) {
    if (row.status === 'accepted' || row.status === 'rejected' || row.status === 'superseded') counts[row.status]++
  }
  return toolSuccess({
    pending: pendingSuggestions(handle.state).map((s) => s.id),
    ...counts,
    openComments: threadsOf(handle.state).filter((t) => !t.resolved).length,
    lastSeq: log.nextSeq - 1,
  })
}

export function executeListReviewEvents(args: { since?: number; limit?: number }, ctx: ToolContext): ToolResult {
  const { handle } = ctx
  if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  const log = reviewLogOf(handle.state)
  const all = eventsSince(log, args.since ?? 0)
  const page = all.slice(0, args.limit ?? 100)
  return toolSuccess({
    events: page.map((e) => ({
      seq: e.seq,
      at: e.at,
      kind: e.kind,
      ...by(e.actor),
      ...(e.suggestionId ? { suggestionId: e.suggestionId } : {}),
      ...(e.previousId ? { previousId: e.previousId } : {}),
      ...(e.threadId ? { threadId: e.threadId } : {}),
      ...(e.replyId ? { replyId: e.replyId } : {}),
    })),
    nextSeq: log.nextSeq,
    more: all.length > page.length,
  })
}
