/**
 * Review tools (#890): the suggestion lifecycle over the review log (#1233).
 * Agents read, give feedback, revise and follow the events; the writer decides
 * in Prose (#607). Every actor is reported by label: the writer is "the
 * writer", never their name or email.
 */

import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { ToolContext } from '../context'
import type { DocumentHandle } from '../../../document/handle'
import { findNodeById } from '../../../extensions/node-ids'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { reviewLogOf, eventsSince, type SuggestionHistory } from '../../../extensions/review-log'
import { threadsOf } from '../../../extensions/comments/transactions'
import { actorLabel, actorOfProvenance, type Actor } from '../../../../shared/review/actor'
import { executeSuggestEdit, isEditorReadOnly } from './editor'
import { trackedChangesIn } from '../../../extensions/tracked-changes/changes'

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

/** The pending tracked changes of a document (#891), in document order. */
function pendingTracked(state: Parameters<typeof getAISuggestions>[0]['state']) {
  return trackedChangesIn(state.doc)
}

export function executeListSuggestions(args: { include?: 'pending' | 'all' }, ctx: ToolContext): ToolResult {
  const { handle } = ctx
  if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  const log = reviewLogOf(handle.state)
  const rows = new Map(log.suggestions.map((s) => [s.id, s]))
  const pending = pendingSuggestions(handle.state)
  const tracked = pendingTracked(handle.state)
  const suggestions: Array<Record<string, unknown>> = pending.map((s) => {
    const row = rows.get(s.id)
    return {
      id: s.id,
      type: s.type,
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
  // Tracked changes (#891): text marks, the deleted text as original and the
  // inserted text as suggested.
  for (const change of tracked) {
    const row = rows.get(change.id)
    suggestions.push({
      id: change.id,
      type: change.type,
      tracked: true,
      status: 'pending',
      originalText: change.deletedText,
      suggestedText: change.insertedText,
      explanation: '',
      createdAt: change.createdAt,
      ...by(row?.actor ?? change.actor),
      feedback: feedbackOf(row),
    })
  }
  if (args.include === 'all') {
    const live = new Set([...pending.map((s) => s.id), ...tracked.map((c) => c.id)])
    for (const row of log.suggestions) {
      if (live.has(row.id) || row.status === 'pending') continue
      suggestions.push({
        id: row.id,
        type: row.type,
        ...(row.tracked ? { tracked: true } : {}),
        ...(row.orphaned ? { orphaned: true } : {}),
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
  if (pendingTracked(handle.state).some((c) => c.id === args.id)) {
    handle.commands.replyToTrackedChange(args.id, text, ctx.provenance?.actor ?? AGENT_FALLBACK)
    return toolSuccess({ suggestionId: args.id })
  }
  if (!pendingSuggestions(handle.state).some((s) => s.id === args.id)) {
    return toolError(`No pending suggestion "${args.id}". Call list_suggestions for the pending ones.`, 'SUGGESTION_NOT_FOUND')
  }
  handle.commands.setAISuggestionReply(args.id, text, ctx.provenance?.actor ?? AGENT_FALLBACK)
  return toolSuccess({ suggestionId: args.id })
}

const NODE_HINT = 'Call read_document, then pass nodeId: the node the revision belongs on.'

/** The ids of the innermost nodes whose text is exactly `text` (a list item and its paragraph count once). */
function nodesWithText(doc: PMNode, text: string): string[] {
  const found: Array<{ id: string; from: number; to: number }> = []
  doc.descendants((node, pos) => {
    const id = node.attrs?.nodeId
    if (typeof id === 'string' && id && node.textContent === text) found.push({ id, from: pos, to: pos + node.nodeSize })
    return true
  })
  return found
    .filter((outer) => !found.some((inner) => inner !== outer && inner.from > outer.from && inner.to < outer.to))
    .map((n) => n.id)
}

/**
 * The node a revision of the rejected suggestion `row` goes on (#1266): the
 * node the caller names, else the one the log saw it on if it still exists,
 * else the one node whose text is still the suggestion's original text.
 */
function revisionNode(row: SuggestionHistory, explicit: string | undefined, doc: PMNode): { nodeId: string } | { error: ToolResult } {
  if (explicit) {
    if (findNodeById(doc, explicit)) return { nodeId: explicit }
    return { error: toolError(`Node "${explicit}" is not in the document. ${NODE_HINT}`, 'NODE_NOT_FOUND') }
  }
  if (row.nodeId && findNodeById(doc, row.nodeId)) return { nodeId: row.nodeId }
  const matches = row.originalText ? nodesWithText(doc, row.originalText) : []
  if (matches.length === 1) return { nodeId: matches[0] }
  if (matches.length > 1) {
    return { error: toolError(`The text suggestion "${row.id}" was on appears in ${matches.length} places. ${NODE_HINT}`, 'AMBIGUOUS_MATCH') }
  }
  return { error: toolError(`The text suggestion "${row.id}" was on has changed or is gone. ${NODE_HINT}`, 'NODE_NOT_FOUND') }
}

/**
 * Revise a suggestion that has left the document (#1266). A rejected one gets
 * a new pending suggestion on its node, linked to it; the rejection stands.
 * An accepted one is in the text now, and a superseded one already has a
 * revision, so both are refused with what to do instead.
 */
function reviseDecided(args: { id: string; content: string; comment?: string; nodeId?: string }, ctx: ToolContext, handle: DocumentHandle): ToolResult {
  const row = reviewLogOf(handle.state).suggestions.find((s) => s.id === args.id)
  if (!row || row.status === 'pending') {
    return toolError(`No suggestion "${args.id}" in this document. Call list_suggestions with include: "all" for every suggestion and its status.`, 'SUGGESTION_NOT_FOUND')
  }
  if (row.status === 'accepted') {
    return toolError(
      `Suggestion "${args.id}" was accepted, so its text is in the document now. To change it further, call suggest_edit on that node.`,
      'SUGGESTION_ACCEPTED'
    )
  }
  if (row.status === 'superseded' || row.supersededBy) {
    const next = row.supersededBy ? `"${row.supersededBy}"` : 'a newer suggestion'
    return toolError(
      `Suggestion "${args.id}" was already revised as ${next}. Revise that one instead; list_suggestions with include: "all" shows its status.`,
      'SUGGESTION_SUPERSEDED'
    )
  }
  if (isEditorReadOnly(handle)) return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  const node = revisionNode(row, args.nodeId, handle.state.doc)
  if ('error' in node) return node.error
  const result = executeSuggestEdit(
    { nodeId: node.nodeId, content: args.content, comment: args.comment ?? row.explanation },
    ctx,
    { follows: args.id }
  )
  if (!result.success) return result
  return toolSuccess({ suggestionId: result.data.suggestionId, revises: args.id })
}

export function executeReviseSuggestion(args: { id: string; content: string; comment?: string; nodeId?: string }, ctx: ToolContext): ToolResult {
  const { handle } = ctx
  if (!handle) return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  if (pendingTracked(handle.state).some((c) => c.id === args.id) || reviewLogOf(handle.state).suggestions.some((s) => s.id === args.id && s.tracked)) {
    return toolError(
      `"${args.id}" is a tracked change, which revise_suggestion doesn't revise. Propose again with suggest_insert or suggest_delete (or suggest_edit for the node), and give feedback with reply_to_suggestion.`,
      'TRACKED_CHANGE'
    )
  }
  const target = pendingSuggestions(handle.state).find((s) => s.id === args.id)
  // No mark: the writer decided it, or a revision replaced it.
  if (!target) return reviseDecided(args, ctx, handle)
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
  return toolSuccess({ suggestionId: result.data.suggestionId, revises: args.id })
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
    pending: [...pendingSuggestions(handle.state).map((s) => s.id), ...pendingTracked(handle.state).map((c) => c.id)],
    ...counts,
    openComments: threadsOf(handle.state).filter((t) => !t.resolved).length,
    lastSeq: Math.max(0, log.nextSeq - 1),
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
