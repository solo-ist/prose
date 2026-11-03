/**
 * AI annotation records as pure functions over a document (#1146).
 *
 * The annotations plugin (`plugin.ts`) owns one record set per editor state
 * and applies these in its `apply`: map the records through a transaction,
 * re-anchor them by text across a whole-document replace, seed them from
 * IndexedDB onto a freshly parsed document, add, remove, restamp. Nothing
 * here touches the DOM, a store or the log; each function reports what it
 * moved or detached so the caller can log it.
 *
 * Invariants (#674): a record is never deleted by mapping; a range that
 * collapses, or whose text is gone, is marked `detached` and keeps its last
 * positions. A zero-width record (an AI deletion marker, `from === to`) has
 * no text to anchor by: it follows its position and never detaches.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transform } from '@tiptap/pm/transform'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { AIAnnotation } from '../../types/annotations'
import { generateId } from '../../lib/persistence'
import { textIndex, snapshotAnchors, reanchorMapping, nearestMatch, type TextIndex } from './reanchor'

export interface RecordChanges {
  records: readonly AIAnnotation[]
  /** Records whose range changed (new objects). */
  moved: AIAnnotation[]
  /** Records that became detached in this pass (new objects). */
  detached: AIAnnotation[]
}

export interface MapResult extends RecordChanges {
  /** Records split around an insertion typed inside them. */
  split: number
}

export interface LoadResult extends RecordChanges {
  /** Rows written before `anchorText` existed, filled from the document. */
  filled: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi))
}

/**
 * The text a range covers, with one '\n' between textblocks: the same rule as
 * `textIndex`, limited to `[from, to)`, so that for any live range
 * `anchorTextAt(doc, from, to) === textIndex(doc).text.slice(start, end)`
 * where `start`/`end` are the range's offsets in the index.
 */
export function anchorTextAt(doc: PMNode, from: number, to: number): string {
  const size = doc.content.size
  const start = clamp(from, 0, size)
  const end = clamp(to, start, size)
  if (start >= end) return ''
  let text = ''
  doc.nodesBetween(start, end, (node, pos) => {
    if (node.isTextblock && text.length > 0) text += '\n'
    if (node.isText && node.text) {
      const s = Math.max(start, pos) - pos
      const e = Math.min(end, pos + node.nodeSize) - pos
      if (e > s) text += node.text.slice(s, e)
    }
    return true
  })
  return text
}

/**
 * A transaction that replaces the whole document: the source-mode exit
 * (which also carries `RELOAD_META`), its undo and redo (prosemirror-history's
 * inverse step, which carries no meta of ours), a select-all paste. Mapping
 * records through such a step collapses every range; they are re-anchored by
 * text instead.
 */
export function isWholeDocumentReplace(tr: Transform): boolean {
  return tr.steps.some(
    (step, i) => step instanceof ReplaceStep && step.from === 0 && step.to === tr.docs[i].content.size
  )
}

/**
 * Map the records through `tr` the way the store's `updatePositions` and
 * `updatePositionsWithSplitting` did: `from` with bias 1, `to` with bias -1;
 * an insertion strictly inside a record splits it into remnants with new ids
 * and sliced `content` (the AI-authored parts), and when both remnants
 * collapse one detached copy under the original id survives; a collapsed
 * range detaches. Returns the same array when nothing changed.
 */
export function mapRecords(records: readonly AIAnnotation[], tr: Transform): MapResult {
  if (records.length === 0 || tr.steps.length === 0) return { records, moved: [], detached: [], split: 0 }

  const insertions: Array<{ pos: number; length: number }> = []
  for (const step of tr.steps) {
    if (step instanceof ReplaceStep && step.from === step.to && step.slice.content.size > 0) {
      insertions.push({ pos: step.from, length: step.slice.content.size })
    }
  }
  const map = (pos: number, bias: number) => tr.mapping.map(pos, bias)

  const out: AIAnnotation[] = []
  const moved: AIAnnotation[] = []
  const detached: AIAnnotation[] = []
  let split = 0
  let changed = false

  for (const a of records) {
    if (a.detached) {
      out.push(a)
      continue
    }
    if (a.from === a.to) {
      const pos = map(a.from, -1)
      if (pos === a.from) {
        out.push(a)
      } else {
        const m = { ...a, from: pos, to: pos }
        out.push(m)
        moved.push(m)
        changed = true
      }
      continue
    }

    const inside = insertions.find((ins) => ins.pos > a.from && ins.pos < a.to)
    if (inside) {
      changed = true
      const beforeFrom = map(a.from, 1)
      const beforeTo = map(inside.pos, -1)
      const afterFrom = map(inside.pos, 1)
      const afterTo = map(a.to, -1)
      let remnants = 0
      if (beforeFrom < beforeTo) {
        const r = {
          ...a,
          id: generateId(),
          from: beforeFrom,
          to: beforeTo,
          content: a.content.slice(0, inside.pos - a.from)
        }
        out.push(r)
        moved.push(r)
        remnants++
      }
      if (afterFrom < afterTo) {
        const r = {
          ...a,
          id: generateId(),
          from: afterFrom,
          to: afterTo,
          content: a.content.slice(inside.pos - a.from)
        }
        out.push(r)
        moved.push(r)
        remnants++
      }
      if (remnants > 0) {
        split++
      } else {
        const d = { ...a, detached: true }
        out.push(d)
        detached.push(d)
      }
      continue
    }

    const from = map(a.from, 1)
    const to = map(a.to, -1)
    if (from < to) {
      if (from === a.from && to === a.to) {
        out.push(a)
      } else {
        const m = { ...a, from, to }
        out.push(m)
        moved.push(m)
        changed = true
      }
    } else {
      const d = { ...a, detached: true }
      out.push(d)
      detached.push(d)
      changed = true
    }
  }

  return { records: changed ? out : records, moved, detached, split }
}

/**
 * Carry the records from `before` onto `after`, a whole-document replace:
 * each live range is mapped through the one region where the two texts
 * differ (a range clear of it shifts, one enclosing it grows), a range the
 * region cuts through goes back on the nearest occurrence of its old text,
 * and only a range with no such occurrence detaches. Zero-width records are
 * clamped into the new document. Returns the same array when nothing changed.
 */
export function reanchorRecords(records: readonly AIAnnotation[], before: PMNode, after: PMNode): RecordChanges {
  if (records.length === 0) return { records, moved: [], detached: [] }
  const size = after.content.size
  const live = records.filter((a) => !a.detached && a.from < a.to)
  let mapping: ((from: number, to: number) => { from: number; to: number } | null) | null = null
  if (live.length > 0) {
    const beforeIndex = textIndex(before)
    const anchors = snapshotAnchors(beforeIndex, live)
    mapping = reanchorMapping(beforeIndex, textIndex(after), anchors)
  }

  const out: AIAnnotation[] = []
  const moved: AIAnnotation[] = []
  const detached: AIAnnotation[] = []
  let changed = false

  for (const a of records) {
    if (a.detached) {
      out.push(a)
      continue
    }
    if (a.from === a.to) {
      const pos = clamp(a.from, 0, size)
      if (pos === a.from) {
        out.push(a)
      } else {
        const m = { ...a, from: pos, to: pos }
        out.push(m)
        moved.push(m)
        changed = true
      }
      continue
    }
    const range = mapping!(a.from, a.to)
    if (!range || range.from < 0 || range.to > size || range.from >= range.to) {
      const d = { ...a, detached: true }
      out.push(d)
      detached.push(d)
      changed = true
    } else if (range.from === a.from && range.to === a.to) {
      out.push(a)
    } else {
      const m = { ...a, from: range.from, to: range.to }
      out.push(m)
      moved.push(m)
      changed = true
    }
  }

  return { records: changed ? out : records, moved, detached }
}

/**
 * Seed stored rows onto a freshly parsed document (a session open, a
 * relaunch, a disk reload, a conversion, a dev remount). A row whose
 * `anchorText` still sits at its stored range is kept; one whose text moved
 * (the markdown round trip normalised something above it, #1138) goes to the
 * nearest occurrence of that text; one whose text is gone detaches. Rows
 * written before `anchorText` existed are kept by position and filled in.
 * Every row is restamped to `documentId`.
 */
export function loadRecords(stored: readonly AIAnnotation[], doc: PMNode, documentId: string): LoadResult {
  const size = doc.content.size
  const out: AIAnnotation[] = []
  const moved: AIAnnotation[] = []
  const detached: AIAnnotation[] = []
  let filled = 0
  let index: TextIndex | null = null

  const detach = (a: AIAnnotation) => {
    const d = { ...a, documentId, detached: true }
    out.push(d)
    detached.push(d)
  }

  for (const row of stored) {
    const a = row.documentId === documentId ? row : { ...row, documentId }
    if (a.detached) {
      out.push(a)
      continue
    }
    if (a.from === a.to) {
      if (a.type !== 'deletion') {
        detach(a)
        continue
      }
      const pos = clamp(a.from, 0, size)
      if (pos === a.from) {
        out.push(a)
      } else {
        const m = { ...a, from: pos, to: pos }
        out.push(m)
        moved.push(m)
      }
      continue
    }
    if (a.from < 0 || a.from > a.to) {
      detach(a)
      continue
    }
    const inBounds = a.to <= size
    if (!a.anchorText) {
      if (!inBounds) {
        detach(a)
        continue
      }
      out.push({ ...a, anchorText: anchorTextAt(doc, a.from, a.to) })
      filled++
      continue
    }
    if (inBounds && anchorTextAt(doc, a.from, a.to) === a.anchorText) {
      out.push(a)
      continue
    }
    index ??= textIndex(doc)
    const match = nearestMatch(index, a.anchorText, a.from)
    if (match) {
      const m = { ...a, from: match.from, to: match.to }
      out.push(m)
      moved.push(m)
    } else {
      detach(a)
    }
  }

  return { records: out, moved, detached, filled }
}

/**
 * Recompute `anchorText` for the live in-bounds records from `doc`. Returns
 * the same array when every anchor is already current.
 */
export function refreshAnchors(records: readonly AIAnnotation[], doc: PMNode): readonly AIAnnotation[] {
  const size = doc.content.size
  let out: AIAnnotation[] | null = null
  records.forEach((a, i) => {
    if (a.detached || a.from < 0 || a.from >= a.to || a.to > size) return
    const text = anchorTextAt(doc, a.from, a.to)
    if (text === a.anchorText) return
    out ??= records.slice()
    out[i] = { ...a, anchorText: text }
  })
  return out ?? records
}

/**
 * Remove every record overlapping `[from, to)`; a record that straddles an
 * edge keeps its outside part as a remnant with a new id and sliced
 * `content`, as the store's `removeAnnotationsInRange` did. Returns the same
 * array when nothing overlapped.
 */
export function removeRecordsInRange(
  records: readonly AIAnnotation[],
  from: number,
  to: number
): readonly AIAnnotation[] {
  if (from >= to) return records
  let changed = false
  const out: AIAnnotation[] = []
  for (const a of records) {
    if (a.to <= from || a.from >= to) {
      out.push(a)
      continue
    }
    changed = true
    if (a.from < from) {
      out.push({ ...a, id: generateId(), to: from, content: a.content.slice(0, from - a.from) })
    }
    if (a.to > to) {
      out.push({ ...a, id: generateId(), from: to, content: a.content.slice(to - a.from) })
    }
  }
  return changed ? out : records
}

/** Restamp every record to `documentId` (a rename, Save As, first save or conversion). */
export function restampRecords(records: readonly AIAnnotation[], documentId: string): readonly AIAnnotation[] {
  if (records.every((a) => a.documentId === documentId)) return records
  return records.map((a) => (a.documentId === documentId ? a : { ...a, documentId }))
}

/**
 * Records entering a document's state: stamped with that document's id and
 * the text they cover, clamped into the document. The caller minted `id` and
 * `createdAt`.
 */
export function stampAdded(inputs: readonly AIAnnotation[], doc: PMNode, documentId: string): AIAnnotation[] {
  const size = doc.content.size
  return inputs.map((a) => {
    const from = clamp(a.from, 0, size)
    const to = clamp(Math.max(a.to, from), 0, size)
    const base: AIAnnotation = { ...a, documentId, from, to }
    return from < to ? { ...base, anchorText: anchorTextAt(doc, from, to) } : base
  })
}
