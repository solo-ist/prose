/**
 * The review log (#1233; design: docs/architecture/review-provenance.md §5):
 * every suggestion a document has seen and what became of it, and an
 * append-only list of review events MCP agents read instead of waiting on a
 * human. Pure: no DOM, no store, no persistence. The plugin feeds it the marks
 * and threads before and after a transaction, and what the transaction says
 * it did.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { AddMarkStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import { SELF, actorOfComment, actorOfProvenance, type Actor } from '../../../shared/review/actor'
import type { CommentData } from '../comments/types'

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

export interface FeedbackEntry {
  id: string
  actor: Actor
  text: string
  createdAt: number
}

export interface SuggestionHistory {
  id: string
  type: 'edit' | 'insertion' | 'deletion'
  originalText: string
  suggestedText: string
  explanation: string
  actor: Actor
  createdAt: number
  status: SuggestionStatus
  decidedAt?: number
  decidedBy?: Actor
  /** The suggestion this one revised. */
  supersedes?: string
  /**
   * The revision that followed this one: it replaced it (`superseded`), or the
   * agent revised it after the writer rejected it (`rejected` stays, #1266).
   */
  supersededBy?: string
  feedback: FeedbackEntry[]
  /**
   * The node the suggestion was on when the log first saw it (#1266), so a
   * rejected suggestion, which has no mark, can still be revised in place.
   * Node ids are regenerated when a document is reopened: a stale one is a
   * hint, not an address. Absent on rows from before 1.9.1.
   */
  nodeId?: string
}

export type ReviewEventKind =
  | 'suggestion:proposed'
  | 'suggestion:revised'
  | 'suggestion:accepted'
  | 'suggestion:rejected'
  | 'suggestion:reopened'
  | 'suggestion:feedback'
  | 'comment:added'
  | 'comment:replied'
  | 'comment:resolved'
  | 'comment:reopened'

export interface ReviewEvent {
  seq: number
  at: number
  kind: ReviewEventKind
  actor: Actor
  suggestionId?: string
  /** For `suggestion:revised`: the suggestion it replaced. */
  previousId?: string
  threadId?: string
  replyId?: string
}

/** What IndexedDB holds per document. */
export interface StoredReviewLog {
  suggestions: SuggestionHistory[]
  events: ReviewEvent[]
  nextSeq: number
}

/** The live suggestion marks of a document, by id: what a proposal snapshots. */
export interface SuggestionMarkInfo {
  id: string
  type: 'edit' | 'insertion' | 'deletion'
  originalText: string
  suggestedText: string
  explanation: string
  createdAt: number
  provenanceModel: string
  actor: Actor | null
  /** The id of the node the mark is in (its nearest ancestor with one). */
  nodeId: string | null
}

/**
 * What a transaction says it did, beyond what its document shows: who decided,
 * which suggestion a revision replaced, a feedback entry, who resolved or
 * reopened a thread.
 */
export interface ReviewIntent {
  decided?: Array<{ ids: string[]; status: 'accepted' | 'rejected'; by: Actor }>
  revised?: Array<{ from: string; to: string; by: Actor }>
  feedback?: Array<{ suggestionId: string; entry: FeedbackEntry }>
  threadBy?: Actor
  /** Replace the log with stored rows (a seed, a dev remount); derives no events. */
  load?: StoredReviewLog
}

export const MAX_EVENTS = 5_000
export const MAX_FEEDBACK = 200

export const EMPTY_STORED: StoredReviewLog = Object.freeze({ suggestions: [], events: [], nextSeq: 1 }) as StoredReviewLog

export const SUGGESTION_MARK = 'aiSuggestion'

/** The id of the nearest node at or above `parent` that has one. */
function hostNodeId(doc: PMNode, pos: number, parent: PMNode | null): string | null {
  const direct = parent?.attrs?.nodeId
  if (typeof direct === 'string' && direct) return direct
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const id = $pos.node(depth).attrs?.nodeId
    if (typeof id === 'string' && id) return id
  }
  return null
}

/** Every suggestion mark in `doc`, by id (the first occurrence's attributes). */
export function scanSuggestionMarks(doc: PMNode): Map<string, SuggestionMarkInfo> {
  const found = new Map<string, SuggestionMarkInfo>()
  doc.descendants((node, pos, parent) => {
    for (const mark of node.marks) {
      if (mark.type.name !== SUGGESTION_MARK) continue
      const id = mark.attrs.id as string | null
      if (!id || found.has(id)) continue
      found.set(id, {
        id,
        type: (mark.attrs.type as SuggestionMarkInfo['type']) || 'edit',
        originalText: (mark.attrs.originalText as string) || '',
        suggestedText: (mark.attrs.suggestedText as string) || '',
        explanation: (mark.attrs.explanation as string) || '',
        createdAt: (mark.attrs.createdAt as number) || Date.now(),
        provenanceModel: (mark.attrs.provenanceModel as string) || '',
        actor: (mark.attrs.actor as Actor | null) ?? null,
        nodeId: hostNodeId(doc, pos, parent),
      })
    }
    return true
  })
  return found
}

/** Could this transaction have put a suggestion mark into the document? */
export function stepsMayAddSuggestion(tr: Transaction): boolean {
  for (const step of tr.steps) {
    if (step instanceof AddMarkStep) {
      if (step.mark.type.name === SUGGESTION_MARK) return true
      continue
    }
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      let carries = false
      step.slice.content.descendants((node) => {
        if (carries) return false
        if (node.marks.some((m) => m.type.name === SUGGESTION_MARK)) carries = true
        return !carries
      })
      if (carries) return true
    }
  }
  return false
}

function historyFromMark(info: SuggestionMarkInfo): SuggestionHistory {
  return {
    id: info.id,
    type: info.type,
    originalText: info.originalText,
    suggestedText: info.suggestedText,
    explanation: info.explanation,
    actor: actorOfProvenance(info.provenanceModel, info.actor),
    createdAt: info.createdAt,
    status: 'pending',
    feedback: [],
    ...(info.nodeId ? { nodeId: info.nodeId } : {}),
  }
}

export interface LogInput {
  stored: StoredReviewLog
  /** Suggestion marks before and after; equal references when the scan was skipped. */
  marksBefore: ReadonlyMap<string, SuggestionMarkInfo>
  marksAfter: ReadonlyMap<string, SuggestionMarkInfo>
  /** Threads before and after; equal references when the thread set did not change. */
  threadsBefore: readonly CommentData[]
  threadsAfter: readonly CommentData[]
  intent: ReviewIntent | undefined
  /** A seed or a stored-thread load: backfill silently, derive no events. */
  quiet: boolean
  now: number
}

/**
 * The next log. Returns `input.stored` itself when nothing changed, so a
 * caller can compare references.
 */
export function nextLog(input: LogInput): StoredReviewLog {
  const { intent, now } = input
  let suggestions: Map<string, SuggestionHistory> | null = null
  const events: ReviewEvent[] = []
  let nextSeq = input.stored.nextSeq

  const base = intent?.load ?? input.stored
  let index: Map<string, SuggestionHistory> | null = null
  // Reads never copy; the first write copies the history once.
  const get = (id: string): SuggestionHistory | undefined => {
    if (suggestions) return suggestions.get(id)
    if (!index) index = new Map(base.suggestions.map((s) => [s.id, s]))
    return index.get(id)
  }
  const rows = () => {
    if (!suggestions) suggestions = new Map(base.suggestions.map((s) => [s.id, s]))
    return suggestions
  }
  const emit = (event: Omit<ReviewEvent, 'seq' | 'at'>) => {
    if (input.quiet) return
    events.push({ ...event, seq: nextSeq++, at: now })
  }
  if (intent?.load) nextSeq = intent.load.nextSeq

  // Suggestions: marks that appeared and disappeared.
  if (input.marksBefore !== input.marksAfter) {
    const decidedBy = new Map<string, { status: 'accepted' | 'rejected'; by: Actor }>()
    for (const d of intent?.decided ?? []) for (const id of d.ids) decidedBy.set(id, { status: d.status, by: d.by })
    const revisedFrom = new Map((intent?.revised ?? []).map((r) => [r.from, r]))
    const revisedTo = new Map((intent?.revised ?? []).map((r) => [r.to, r]))

    for (const [id, info] of input.marksAfter) {
      if (input.marksBefore.has(id)) continue
      const existing = get(id)
      const revision = revisedTo.get(id)
      if (!existing) {
        const row = historyFromMark(info)
        if (revision) {
          rows().set(id, { ...row, actor: revision.by, supersedes: revision.from })
          emit({ kind: 'suggestion:revised', actor: revision.by, suggestionId: id, previousId: revision.from })
        } else {
          rows().set(id, row)
          emit({ kind: 'suggestion:proposed', actor: row.actor, suggestionId: id })
        }
      } else if (existing.status !== 'pending') {
        rows().set(id, { ...existing, status: 'pending', decidedAt: undefined, decidedBy: undefined })
        emit({ kind: 'suggestion:reopened', actor: SELF, suggestionId: id })
      }
    }

    for (const id of input.marksBefore.keys()) {
      if (input.marksAfter.has(id)) continue
      const existing = get(id) ?? historyFromMark(input.marksBefore.get(id)!)
      if (existing.status !== 'pending') continue
      const revision = revisedFrom.get(id)
      if (revision) {
        rows().set(id, { ...existing, status: 'superseded', supersededBy: revision.to, decidedAt: now, decidedBy: revision.by })
        continue
      }
      const decision = decidedBy.get(id) ?? { status: 'rejected' as const, by: SELF }
      rows().set(id, { ...existing, status: decision.status, decidedAt: now, decidedBy: decision.by })
      emit({ kind: decision.status === 'accepted' ? 'suggestion:accepted' : 'suggestion:rejected', actor: decision.by, suggestionId: id })
    }

    // A revision of a suggestion the writer rejected (#1266): it has no mark,
    // so nothing above touched its row. The rejection stands (status, when and
    // by whom); the row only gains the forward link. The new row's backward
    // link and its `suggestion:revised` event came from the loop above.
    for (const r of intent?.revised ?? []) {
      if (input.marksBefore.has(r.from) || input.marksBefore.has(r.to) || !input.marksAfter.has(r.to)) continue
      const existing = get(r.from)
      if (!existing || existing.status !== 'rejected' || existing.supersededBy) continue
      rows().set(r.from, { ...existing, supersededBy: r.to })
    }
  }

  // Feedback on a suggestion.
  for (const { suggestionId, entry } of intent?.feedback ?? []) {
    const existing = get(suggestionId)
    if (!existing) continue
    rows().set(suggestionId, { ...existing, feedback: [...existing.feedback, entry].slice(-MAX_FEEDBACK) })
    emit({ kind: 'suggestion:feedback', actor: entry.actor, suggestionId })
  }

  // Threads: new threads, new replies, resolve toggles.
  if (input.threadsBefore !== input.threadsAfter && !input.quiet) {
    const before = new Map(input.threadsBefore.map((t) => [t.id, t]))
    for (const thread of input.threadsAfter) {
      const prev = before.get(thread.id)
      if (!prev) {
        emit({ kind: 'comment:added', actor: actorOfComment(thread), threadId: thread.id })
        for (const reply of thread.replies ?? []) emit({ kind: 'comment:replied', actor: actorOfComment(reply), threadId: thread.id, replyId: reply.id })
        continue
      }
      const seen = new Set((prev.replies ?? []).map((r) => r.id))
      for (const reply of thread.replies ?? []) {
        if (!seen.has(reply.id)) emit({ kind: 'comment:replied', actor: actorOfComment(reply), threadId: thread.id, replyId: reply.id })
      }
      if ((prev.resolved === true) !== (thread.resolved === true)) {
        emit({ kind: thread.resolved ? 'comment:resolved' : 'comment:reopened', actor: intent?.threadBy ?? SELF, threadId: thread.id })
      }
    }
  }

  if (!suggestions && events.length === 0 && !intent?.load) return input.stored
  const allEvents = events.length > 0 ? [...base.events, ...events] : base.events
  return {
    suggestions: suggestions ? [...(suggestions as Map<string, SuggestionHistory>).values()] : base.suggestions,
    events: allEvents.length > MAX_EVENTS ? allEvents.slice(-MAX_EVENTS) : allEvents,
    nextSeq,
  }
}

/** Events with `seq > since`, oldest first. */
export function eventsSince(log: StoredReviewLog, since = 0): ReviewEvent[] {
  return log.events.filter((e) => e.seq > since)
}
