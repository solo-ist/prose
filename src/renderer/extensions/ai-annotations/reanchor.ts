/**
 * Re-anchor AI annotations by their text across a whole-document reload.
 *
 * Annotations are decorations over stored positions, kept current by mapping
 * them through each transaction. A whole-document replace (leaving source
 * mode) would collapse every range under that mapping, so the session layer
 * skips the mapping for that one transaction (RELOAD_META) and carries each
 * live annotation over with the helpers here instead: index the doc's text
 * before and after, then map each range the way a single replace step would.
 * The text before and after differ in one region: a range outside it shifts,
 * one spanning it grows around the edit, exactly as typing inside a highlight
 * does in the editor. A range the region cuts through goes back on the
 * nearest occurrence of its old text, and only an annotation with no such
 * occurrence detaches.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import type { AIAnnotation } from '../../types/annotations'

/** The doc's text with one '\n' between textblocks, and each char's doc position (-1 for separators). */
export function textIndex(doc: PMNode): { text: string; pos: number[] } {
  let text = ''
  const pos: number[] = []
  doc.descendants((node, nodePos) => {
    if (node.isTextblock && text.length > 0) {
      text += '\n'
      pos.push(-1)
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        text += node.text[i]
        pos.push(nodePos + i)
      }
    }
  })
  return { text, pos }
}

export type TextIndex = ReturnType<typeof textIndex>
export type DocRange = { from: number; to: number }

export interface AnchorSnapshot {
  from: number
  to: number
  /** Half-open offsets into the pre-reload index text. */
  start: number
  end: number
  text: string
}

/** Where each live annotation sits in `index` (taken before the reload). */
export function snapshotAnchors(index: TextIndex, annotations: AIAnnotation[]): AnchorSnapshot[] {
  const result: AnchorSnapshot[] = []
  for (const a of annotations) {
    if (a.detached) continue
    const start = index.pos.findIndex((p) => p >= a.from)
    let end = -1
    for (let i = index.pos.length - 1; i >= 0; i--) {
      if (index.pos[i] !== -1 && index.pos[i] < a.to) {
        end = i + 1
        break
      }
    }
    if (start === -1 || end <= start) continue
    result.push({ from: a.from, to: a.to, start, end, text: index.text.slice(start, end) })
  }
  return result
}

/** Half-open index offsets → doc positions, trimming block separators at either end. */
export function toDocRange(index: TextIndex, start: number, end: number): DocRange | null {
  while (start < end && index.pos[start] === -1) start++
  while (end > start && index.pos[end - 1] === -1) end--
  if (start >= end) return null
  return { from: index.pos[start], to: index.pos[end - 1] + 1 }
}

/**
 * Map a half-open range of `before` through the single region where `before`
 * and `after` differ, with ProseMirror's replace-step rules: a range clear of
 * the region shifts, a range enclosing it grows around it, and a range the
 * region cuts through has no mapping (null).
 */
export function mapThroughDiff(before: string, after: string): (start: number, end: number) => [number, number] | null {
  const shortest = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shortest && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < shortest - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const changedEnd = before.length - suffix
  const delta = after.length - before.length
  return (start, end) => {
    if (end <= prefix) return [start, end]
    if (start >= changedEnd) return [start + delta, end + delta]
    if (start <= prefix && end >= changedEnd && end + delta > start) return [start, end + delta]
    return null
  }
}

/** The occurrence of `text` whose start is nearest `near`, as doc positions. */
export function nearestMatch(index: TextIndex, text: string, near: number): DocRange | null {
  let best: DocRange | null = null
  for (let i = index.text.indexOf(text); i !== -1; i = index.text.indexOf(text, i + 1)) {
    const from = index.pos[i]
    const last = index.pos[i + text.length - 1]
    if (from === -1 || last === -1) continue
    if (!best || Math.abs(from - near) < Math.abs(best.from - near)) best = { from, to: last + 1 }
  }
  return best
}

/**
 * The position mapping that carries `anchors` (snapshotted from `before`)
 * onto the reloaded document `after`. A range not in the snapshot (an
 * out-of-bounds one) keeps its position; null detaches.
 */
export function reanchorMapping(
  before: TextIndex,
  after: TextIndex,
  anchors: AnchorSnapshot[]
): (from: number, to: number) => DocRange | null {
  const mapped = mapThroughDiff(before.text, after.text)
  const moved = new Map<string, DocRange | null>()
  for (const a of anchors) {
    const offsets = mapped(a.start, a.end)
    const range = (offsets && toDocRange(after, offsets[0], offsets[1])) ?? nearestMatch(after, a.text, a.from)
    moved.set(`${a.from}:${a.to}`, range)
  }
  return (from, to) => {
    const key = `${from}:${to}`
    return moved.has(key) ? moved.get(key)! : { from, to }
  }
}
