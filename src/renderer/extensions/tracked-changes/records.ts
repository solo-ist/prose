/**
 * The `tracked` record kind (#891; design §5): what IndexedDB holds for a
 * document's pending tracked changes, and how they go back into a document
 * built from the file.
 *
 * The file holds the original, so the records are anchored in the original
 * text: one '\n' between textblocks, U+FFFC for an inline node that is not
 * text, inserted text left out and deleted text kept. Each record is one
 * contiguous range of one change, with up to 32 characters of original text on
 * each side (within its paragraph, the line breaks that bound it included) and
 * the offset where it sat (a hint).
 *
 * At load, a record goes back only where its context matches exactly (the
 * occurrence nearest the hint when there are several). A record whose context
 * is gone (the file changed outside Prose) is orphaned, never re-inserted
 * somewhere wrong; the caller keeps it in the review log.
 */

import { Fragment, type Mark, type Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Actor } from '../../../shared/review/actor'
import { inlineText, kindOf, trackedMarkOf, trackedMarkTypes, type TrackedKind } from './changes'

export interface TrackedChangeRecord {
  id: string
  kind: TrackedKind
  actor: Actor
  createdAt: number
  /** The range's text (U+FFFC for an inline node that is not text). */
  text: string
  /** The inserted content as inline nodes with their formatting (insert only). */
  content?: unknown[]
  /** Up to 32 characters of original text before the range. */
  before: string
  /** Up to 32 characters of original text after the range. */
  after: string
  /** Where the range starts in the original text (a hint). */
  at: number
}

export const CONTEXT_CHARS = 32

/** Marks a record's content keeps: formatting. The others are restored by their own plugins, or are the change itself. */
const NOT_CONTENT = new Set(['trackedInsert', 'trackedDelete', 'comment', 'aiSuggestion'])

function contentMarks(marks: readonly Mark[]): Mark[] {
  return marks.filter((m) => !NOT_CONTENT.has(m.type.name))
}

type Visit = (node: PMNode, pos: number, offset: number, tracked: Mark | null) => void

/** Walk the inline content of `doc` in order; returns its original text. */
function walkOriginal(doc: PMNode, visit?: Visit): string {
  let text = ''
  let first = true
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (!first) text += '\n'
    first = false
    node.forEach((child, offset) => {
      const tracked = trackedMarkOf(child.marks)
      visit?.(child, pos + 1 + offset, text.length, tracked)
      if (!tracked || kindOf(tracked) === 'delete') text += inlineText(child)
    })
    return false
  })
  return text
}

/** The original text of a node (insertions left out, deletions kept), as `textContent` would join it. */
export function originalTextOf(node: PMNode): string {
  if (node.isInline) {
    const tracked = trackedMarkOf(node.marks)
    return tracked && kindOf(tracked) === 'insert' ? '' : node.isText ? (node.text ?? '') : ''
  }
  let text = ''
  node.descendants((child) => {
    if (!child.isText) return true
    const tracked = trackedMarkOf(child.marks)
    if (!tracked || kindOf(tracked) === 'delete') text += child.text ?? ''
    return false
  })
  return text
}

/** The records for every pending change in `doc`, in document order. */
export function trackedRecordsOf(doc: PMNode): TrackedChangeRecord[] {
  const records: Array<TrackedChangeRecord & { end: number }> = []
  const original = walkOriginal(doc, (node, pos, offset, tracked) => {
    if (!tracked) return
    const id = tracked.attrs.id as string | null
    if (!id) return
    const kind = kindOf(tracked)
    const last = records[records.length - 1]
    const piece = node.mark(contentMarks(node.marks)).toJSON() as unknown
    if (last && last.id === id && last.kind === kind && last.end === pos) {
      last.text += inlineText(node)
      last.end = pos + node.nodeSize
      if (kind === 'insert') last.content!.push(piece)
      return
    }
    records.push({
      id,
      kind,
      actor: (tracked.attrs.actor as Actor | null) ?? { kind: 'human', self: true },
      createdAt: (tracked.attrs.createdAt as number) || 0,
      text: inlineText(node),
      ...(kind === 'insert' ? { content: [piece] } : {}),
      before: '',
      after: '',
      at: offset,
      end: pos + node.nodeSize,
    })
  })
  return records.map(({ end: _end, ...record }) => {
    const start = record.at
    const stop = record.kind === 'delete' ? start + record.text.length : start
    // The context stays in the range's own paragraph, up to and including the
    // line break that ends it: an edit to the next paragraph doesn't orphan
    // the change, and an insertion at a paragraph's end still knows it is one.
    const opens = original.lastIndexOf('\n', start - 1)
    const closes = original.indexOf('\n', stop)
    return {
      ...record,
      before: original.slice(Math.max(opens === -1 ? 0 : opens, start - CONTEXT_CHARS), start),
      after: original.slice(stop, Math.min(closes === -1 ? original.length : closes + 1, stop + CONTEXT_CHARS)),
    }
  })
}

interface OriginalIndex {
  text: string
  /** The document position of each character; -1 for the '\n' between textblocks. */
  pos: number[]
  /** Each textblock's first text offset and content start, in order. */
  blocks: Array<{ offset: number; start: number }>
}

function indexOriginal(doc: PMNode): OriginalIndex {
  const pos: number[] = []
  const blocks: OriginalIndex['blocks'] = []
  let text = ''
  doc.descendants((node, nodePos) => {
    if (!node.isTextblock) return true
    if (blocks.length > 0) {
      text += '\n'
      pos.push(-1)
    }
    blocks.push({ offset: text.length, start: nodePos + 1 })
    node.forEach((child, offset) => {
      const t = inlineText(child)
      for (let i = 0; i < t.length; i++) {
        text += t[i]
        pos.push(nodePos + 1 + offset + i)
      }
    })
    return false
  })
  return { text, pos, blocks }
}

/** The document position of the gap before text offset `k`. */
function insertionPoint(index: OriginalIndex, k: number): number | null {
  if (k < index.text.length && index.pos[k] >= 0) return index.pos[k]
  if (k > 0 && index.pos[k - 1] >= 0) return index.pos[k - 1] + 1
  const empty = index.blocks.find((b) => b.offset === k)
  return empty ? empty.start : null
}

/** The occurrence of `needle` in `text` nearest `hint`, or -1. */
function nearest(text: string, needle: string, hint: number): number {
  if (needle.length === 0) return Math.max(0, Math.min(hint, text.length))
  let best = -1
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (best === -1 || Math.abs(i - hint) < Math.abs(best - hint)) best = i
  }
  return best
}

interface Placement {
  index: number
  record: TrackedChangeRecord
  from: number
  to: number
}

/**
 * Put `records` back into the document `tr` holds (one built from the file:
 * no tracked marks yet), inside `tr`. Returns the records whose context is
 * gone: orphans, applied nowhere.
 */
export function applyTrackedRecords(tr: Transaction, records: readonly TrackedChangeRecord[]): TrackedChangeRecord[] {
  if (records.length === 0) return []
  const doc = tr.doc
  const schema = doc.type.schema
  const { insert, remove } = trackedMarkTypes(schema)
  const index = indexOriginal(doc)
  const orphans: TrackedChangeRecord[] = []
  const placed: Placement[] = []

  records.forEach((record, i) => {
    const needle = record.kind === 'delete' ? record.before + record.text + record.after : record.before + record.after
    const found = nearest(index.text, needle, record.at - record.before.length)
    if (found === -1) return orphans.push(record)
    const start = found + record.before.length
    if (record.kind === 'delete') {
      const end = start + record.text.length
      const slice = index.pos.slice(start, end)
      if (slice.length === 0 || slice.includes(-1)) return orphans.push(record)
      const from = slice[0]
      const to = slice[slice.length - 1] + 1
      const $from = doc.resolve(from)
      if (!$from.sameParent(doc.resolve(to)) || !$from.parent.type.allowsMarkType(remove)) return orphans.push(record)
      placed.push({ index: i, record, from, to })
    } else {
      const at = insertionPoint(index, start)
      if (at === null) return orphans.push(record)
      const $at = doc.resolve(at)
      if (!$at.parent.isTextblock || !$at.parent.type.allowsMarkType(insert)) return orphans.push(record)
      placed.push({ index: i, record, from: at, to: at })
    }
  })

  // A change goes back whole or not at all: one orphaned range orphans its
  // change (a replacement must not come back as a bare deletion).
  const orphanIds = new Set(orphans.map((r) => r.id))
  const kept = placed.filter((p) => {
    if (!orphanIds.has(p.record.id)) return true
    orphans.push(p.record)
    return false
  })

  // Last first, so earlier positions hold; at one position a deletion's mark
  // goes on before an insertion lands in front of it, and insertions keep
  // their record order.
  kept.sort((a, b) => {
    if (a.from !== b.from) return b.from - a.from
    if (a.record.kind !== b.record.kind) return a.record.kind === 'delete' ? -1 : 1
    return b.index - a.index
  })
  for (const p of kept) {
    const attrs = { id: p.record.id, actor: p.record.actor, createdAt: p.record.createdAt }
    if (p.record.kind === 'delete') {
      tr.addMark(p.from, p.to, remove.create(attrs))
      continue
    }
    let content: Fragment
    try {
      content = Fragment.fromJSON(schema, p.record.content ?? [])
    } catch {
      content = Fragment.empty
    }
    if (content.size === 0 && p.record.text) content = Fragment.from(schema.text(p.record.text.replace(/￼/g, '')))
    if (content.size === 0) {
      orphans.push(p.record)
      continue
    }
    const nodes: PMNode[] = []
    content.forEach((node) => nodes.push(node.mark(insert.create(attrs).addToSet(contentMarks(node.marks)))))
    const marked = Fragment.from(nodes)
    const $at = tr.doc.resolve(p.from)
    if (!$at.parent.canReplace($at.index(), $at.index(), marked)) {
      orphans.push(p.record)
      continue
    }
    tr.insert(p.from, marked)
  }
  return orphans
}
