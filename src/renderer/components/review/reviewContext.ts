/**
 * The text around a change on a review card (#1295): what the writer reads
 * before and after the changed words, so an insertion, a deleted comma or a
 * retyped word shows where it sits. Pure functions over a ProseMirror
 * document.
 *
 * The context reads as the file holds it: other pending tracked insertions
 * left out, tracked deletions kept (as `originalOf` does), so each card shows
 * what accepting this one change gives.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { kindOf, trackedMarkOf } from '../../extensions/tracked-changes/changes'
import type { ReviewItem } from './reviewItems'

/** The most context shown on either side, in characters; a longer side is cut on a word. */
export const CONTEXT_MAX = 140

export interface ReviewContext {
  /** The original text before the change in its block, from the start of its sentence; '' at the block's start. */
  before: string
  /** The original text after the change in its block, to the end of its sentence; '' at the block's end. */
  after: string
  /** For a change that fills its whole block: the last sentence of the block before it. */
  above?: string
  /** For a change that fills its whole block: the first sentence of the block after it. */
  below?: string
}

/** A sentence's end: a terminator, any closing quotes or brackets, then whitespace. */
const SENTENCE_END = /[.!?…]["'”’)\]]*\s+/g
/** The first sentence's end in text that follows a change: whitespace or the end may follow. */
const FIRST_END = /[.!?…]["'”’)\]]*(?=\s|$)/

/** The original text of a textblock's inline content between `from` and `to` (document positions). */
function originalBetween(block: PMNode, contentStart: number, from: number, to: number): string {
  let text = ''
  block.forEach((child, offset) => {
    const start = contentStart + offset
    const end = start + child.nodeSize
    if (end <= from || start >= to) return
    const tracked = trackedMarkOf(child.marks)
    if (tracked && kindOf(tracked) === 'insert') return
    if (child.isText) text += child.text!.slice(Math.max(0, from - start), Math.min(child.nodeSize, to - start))
    else if (child.type.name === 'hardBreak') text += ' '
  })
  return text
}

/** The text before a change: its own sentence, at most `CONTEXT_MAX` characters, "… " where cut. */
export function clipBefore(text: string): string {
  let start = 0
  for (const match of text.matchAll(SENTENCE_END)) start = match.index! + match[0].length
  let kept = text.slice(start)
  let clipped = start > 0
  if (kept.length > CONTEXT_MAX) {
    const space = kept.indexOf(' ', kept.length - CONTEXT_MAX)
    kept = kept.slice(space === -1 ? kept.length - CONTEXT_MAX : space + 1)
    clipped = true
  }
  return clipped ? `… ${kept}` : kept
}

/** The text after a change: to its sentence's end, at most `CONTEXT_MAX` characters, " …" where cut. */
export function clipAfter(text: string): string {
  const match = FIRST_END.exec(text)
  let kept = match ? text.slice(0, match.index + match[0].length) : text
  let clipped = kept.length < text.trimEnd().length
  if (kept.length > CONTEXT_MAX) {
    const space = kept.lastIndexOf(' ', CONTEXT_MAX)
    kept = kept.slice(0, space > 0 ? space : CONTEXT_MAX)
    clipped = true
  }
  return clipped ? `${kept} …` : kept
}

/** The nearest sentences of the textblocks before `blockStart` and after `blockEnd`. */
function neighbours(doc: PMNode, blockStart: number, blockEnd: number): Pick<ReviewContext, 'above' | 'below'> {
  let above: string | undefined
  let below: string | undefined
  doc.descendants((node, pos) => {
    if (below !== undefined) return false
    if (!node.isTextblock) return true
    const end = pos + node.nodeSize
    const text = originalBetween(node, pos + 1, pos + 1, end - 1)
    if (text.trim() && end <= blockStart) above = text
    else if (text.trim() && pos >= blockEnd) below = text
    return false
  })
  return {
    ...(above !== undefined ? { above: clipBefore(above) } : {}),
    ...(below !== undefined ? { below: clipAfter(below) } : {}),
  }
}

/**
 * The context of the change at `from`..`to`. A change across blocks takes its
 * lead-in from the first block and its tail from the last. A change that
 * fills its whole block also gets the nearest sentence of the blocks around
 * it, shown on lines of their own.
 */
export function reviewContext(doc: PMNode, from: number, to: number): ReviewContext {
  const size = doc.content.size
  const a = Math.max(0, Math.min(from, size))
  const b = Math.max(a, Math.min(to, size))
  const $from = doc.resolve(a)
  const $to = doc.resolve(b)
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return { before: '', after: '' }
  const before = originalBetween($from.parent, $from.start(), $from.start(), a)
  const after = originalBetween($to.parent, $to.start(), b, $to.end())
  const context: ReviewContext = { before: clipBefore(before), after: clipAfter(after) }
  if (!before.trim() && !after.trim()) Object.assign(context, neighbours(doc, $from.before(), $to.after()))
  return context
}

/**
 * Where a review item sits. A tracked change's span is its own; an AI
 * suggestion's is its whole mark, since `getAISuggestions` reports the first
 * text node the mark covers.
 */
export function itemRange(doc: PMNode, item: Pick<ReviewItem, 'id' | 'from' | 'to' | 'tracked'>): { from: number; to: number } {
  if (item.tracked) return { from: item.from, to: item.to }
  let from = Infinity
  let to = -Infinity
  doc.descendants((node, pos) => {
    if (!node.isInline) return true
    if (node.marks.some((m) => m.type.name === 'aiSuggestion' && m.attrs.id === item.id)) {
      from = Math.min(from, pos)
      to = Math.max(to, pos + node.nodeSize)
    }
    return false
  })
  return from <= to ? { from, to } : { from: item.from, to: item.to }
}

/** The context a review card shows for `item`. */
export function reviewContextOf(doc: PMNode, item: ReviewItem): ReviewContext {
  const { from, to } = itemRange(doc, item)
  return reviewContext(doc, from, to)
}
