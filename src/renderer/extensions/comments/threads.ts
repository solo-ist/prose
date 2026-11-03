/**
 * Pure transitions of the comment thread set (#1147): what the plugin's
 * `apply` does with the metas a transaction carries and with the marks of
 * the document being applied. No DOM, no store, no logging; `plugin.ts`
 * calls these and `threads.test.ts` pins them.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { AddMarkStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import type { CommentData } from './types'
import { EMPTY_MARKS, type MarkSpan, type SharePush, type ThreadMeta } from './transactions'

const COMMENT_MARK = 'comment'

/**
 * Every comment mark in `doc`, by thread id: the text nodes carrying it (the
 * decorations paint each one) and the aggregate range. One walk; the
 * attributes come along so an orphan mark can be adopted as a thread.
 */
export function scanMarks(doc: PMNode): ReadonlyMap<string, MarkSpan> {
  const marks = new Map<string, MarkSpan & { spans: Array<{ from: number; to: number }> }>()
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name !== COMMENT_MARK || !mark.attrs.id) continue
      const id = mark.attrs.id as string
      const to = pos + node.nodeSize
      const existing = marks.get(id)
      if (existing) {
        existing.spans.push({ from: pos, to })
        existing.to = to
      } else {
        marks.set(id, {
          id,
          from: pos,
          to,
          spans: [{ from: pos, to }],
          comment: (mark.attrs.comment as string) || '',
          createdAt: (mark.attrs.createdAt as number) || Date.now(),
          occurrenceIndex: (mark.attrs.occurrenceIndex as number) ?? 0
        })
      }
    }
  })
  return marks.size === 0 ? EMPTY_MARKS : marks
}

/** True when the two scans paint the same ids over the same spans. */
export function marksEqual(a: ReadonlyMap<string, MarkSpan>, b: ReadonlyMap<string, MarkSpan>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [id, span] of a) {
    const other = b.get(id)
    if (!other || other.spans.length !== span.spans.length) return false
    for (let i = 0; i < span.spans.length; i++) {
      if (span.spans[i].from !== other.spans[i].from || span.spans[i].to !== other.spans[i].to) return false
    }
  }
  return true
}

/**
 * Whether a transaction's steps can bring a comment mark into the document
 * on their own (pasted commented text, a restore's addMark). A document
 * without threads or marks skips the scan unless this says otherwise.
 */
export function transactionInsertsCommentMarks(tr: Transaction): boolean {
  for (const step of tr.steps) {
    if (step instanceof AddMarkStep) {
      if (step.mark.type.name === COMMENT_MARK) return true
      continue
    }
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) continue
    let found = false
    step.slice.content.descendants((node) => {
      if (found) return false
      if (node.marks.some((m) => m.type.name === COMMENT_MARK)) found = true
      return !found
    })
    if (found) return true
  }
  return false
}

/** The metas, in order: load / merge replace the set, add appends (superseding ids), update patches, remove drops. */
export function applyThreadMetas(threads: readonly CommentData[], meta: ThreadMeta): readonly CommentData[] {
  let next = threads
  if (meta.load) next = meta.load
  if (meta.merge) next = meta.merge
  if (meta.add && meta.add.length > 0) {
    const ids = new Set(meta.add.map((c) => c.id))
    const kept = next.some((c) => ids.has(c.id)) ? next.filter((c) => !ids.has(c.id)) : next
    next = [...kept, ...meta.add]
  }
  for (const { id, patch } of meta.update ?? []) {
    const i = next.findIndex((c) => c.id === id)
    if (i === -1) continue
    const current = next[i]
    let changed = false
    for (const key of Object.keys(patch) as Array<keyof CommentData>) {
      if (current[key] !== patch[key]) {
        changed = true
        break
      }
    }
    if (!changed) continue
    const copy = next.slice()
    copy[i] = { ...current, ...patch }
    next = copy
  }
  if (meta.remove && meta.remove.length > 0) {
    const ids = new Set(meta.remove)
    if (next.some((c) => ids.has(c.id))) next = next.filter((c) => !ids.has(c.id))
  }
  return next
}

/**
 * How the marks are read against the threads:
 * - `edit`: a user's or the model's change to the document. An open thread
 *   whose mark was there and is gone resolves (#928), or goes anchor-lost
 *   under an AI replacement (#1099); a mark that is back reopens its thread.
 * - `reconcile`: the seed, a reload, a merge, a re-open. Open threads with a
 *   mark are anchored, without one anchor-lost; nothing resolves.
 */
export type ReconcileMode = 'edit' | 'reconcile'

export interface ReconcileOutcome {
  threads: readonly CommentData[]
  resolved: string[]
  lost: string[]
  regained: string[]
  adopted: string[]
}

export function reconcileThreads(
  threads: readonly CommentData[],
  prevMarks: ReadonlyMap<string, MarkSpan>,
  marks: ReadonlyMap<string, MarkSpan>,
  mode: ReconcileMode,
  aiReplacement: boolean,
  doc: PMNode
): ReconcileOutcome {
  const resolved: string[] = []
  const lost: string[] = []
  const regained: string[] = []
  const adopted: string[] = []
  let changed = false
  const next: CommentData[] = threads.map((c) => {
    const present = marks.has(c.id)
    if (present) {
      if (c.resolved) {
        // A resolved thread never has a mark of its own; one that appears
        // (an undo of the resolve) reopens the thread.
        if (mode === 'edit' && !prevMarks.has(c.id)) {
          regained.push(c.id)
          changed = true
          return { ...c, resolved: false, anchorLost: false }
        }
        return c
      }
      if (c.anchorLost) {
        regained.push(c.id)
        changed = true
        return { ...c, anchorLost: false }
      }
      return c
    }
    if (c.resolved) return c
    if (mode === 'edit' && prevMarks.has(c.id)) {
      changed = true
      if (aiReplacement) {
        lost.push(c.id)
        return { ...c, anchorLost: true }
      }
      resolved.push(c.id)
      return { ...c, resolved: true }
    }
    if (c.anchorLost !== true) {
      lost.push(c.id)
      changed = true
      return { ...c, anchorLost: true }
    }
    return c
  })
  // A mark with no thread (pasted commented text, a mark the store never
  // mirrored) becomes a thread from its attributes, as the persistence merge
  // used to make at the next leave.
  if (marks.size > 0) {
    const known = new Set(next.map((c) => c.id))
    for (const span of marks.values()) {
      if (known.has(span.id)) continue
      adopted.push(span.id)
      changed = true
      next.push(adoptMark(span, doc))
    }
  }
  return { threads: changed ? next : threads, resolved, lost, regained, adopted }
}

function adoptMark(span: MarkSpan, doc: PMNode): CommentData {
  const markedText = doc.textBetween(span.from, span.to, ' ')
  return {
    id: span.id,
    markedText,
    comment: span.comment,
    createdAt: span.createdAt,
    author: 'user',
    occurrenceIndex: occurrenceIndexOf(doc, markedText, span.from),
    from: span.from,
    to: span.to,
    replies: [],
    resolved: false
  }
}

/**
 * How many non-overlapping occurrences of `markedText` the document holds
 * before position `from`, the way `setComment` and `getComments` count it.
 */
export function occurrenceIndexOf(doc: PMNode, markedText: string, from: number): number {
  if (!markedText) return 0
  const docText = doc.textContent
  const charsBefore = doc.textBetween(0, from, '').length
  let occurrenceIndex = 0
  let searchOffset = 0
  while (true) {
    const matchIdx = docText.indexOf(markedText, searchOffset)
    if (matchIdx === -1 || matchIdx >= charsBefore) break
    occurrenceIndex++
    searchOffset = matchIdx + markedText.length
  }
  return occurrenceIndex
}

/**
 * The share pushes a transition asks for, by diff: a new local thread, a
 * resolve toggle, a new local reply, a removed thread. The share module
 * decides what to send (a thread without a server row queues its replies,
 * a local-only thread's resolve is a no-op).
 */
export function diffPushes(prev: readonly CommentData[], next: readonly CommentData[]): SharePush[] {
  if (prev === next) return []
  const pushes: SharePush[] = []
  const before = new Map(prev.map((c) => [c.id, c]))
  const after = new Set<string>()
  for (const c of next) {
    after.add(c.id)
    const p = before.get(c.id)
    if (!p) {
      if (!c.shareId && c.markedText) pushes.push({ kind: 'thread', threadId: c.id })
      for (const r of c.replies ?? []) if (!r.shareId) pushes.push({ kind: 'reply', threadId: c.id, replyId: r.id })
      continue
    }
    if (p === c) continue
    if ((p.resolved === true) !== (c.resolved === true)) pushes.push({ kind: 'resolve', threadId: c.id })
    if (c.replies !== p.replies) {
      const had = new Set((p.replies ?? []).map((r) => r.id))
      for (const r of c.replies ?? []) {
        if (!had.has(r.id) && !r.shareId) pushes.push({ kind: 'reply', threadId: c.id, replyId: r.id })
      }
    }
  }
  for (const p of prev) if (!after.has(p.id)) pushes.push({ kind: 'remove', thread: p })
  return pushes
}
