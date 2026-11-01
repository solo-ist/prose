/**
 * Re-anchor AI annotations by their text across a whole-document reload.
 *
 * Annotations are decorations over stored positions, kept current by mapping
 * them through each transaction. A `setContent` (leaving source mode) replaces
 * the whole document in one step, and mapping through that collapses every
 * range, so the store would detach them all — history-only, no highlight —
 * even where the annotated text is untouched. Instead: index the doc's text
 * before and after the reload, pause mapping across it, then carry each live
 * annotation over the way a single replace step would — the text before and
 * after the reload differ in one region, and a range outside it shifts, while
 * one spanning it grows around the edit, exactly as typing inside a highlight
 * does in the editor. A range the region cuts through goes back on the nearest
 * occurrence of its old text, and only an annotation with no such occurrence
 * detaches.
 */

import type { Editor } from '@tiptap/core'
import { useAnnotationStore } from './store'
import { aiAnnotationsPluginKey } from './plugin'
import { textIndex, nearestMatch, type TextIndex, type DocRange } from './anchors'

interface AnchorSnapshot {
  from: number
  to: number
  /** Half-open offsets into the pre-reload index text. */
  start: number
  end: number
  text: string
}

function snapshot(index: TextIndex): AnchorSnapshot[] {
  const result: AnchorSnapshot[] = []
  for (const a of useAnnotationStore.getState().annotations) {
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
function toDocRange(index: TextIndex, start: number, end: number): DocRange | null {
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
function mapThroughDiff(before: string, after: string): (start: number, end: number) => [number, number] | null {
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

/** Run `reload` (a whole-document replace) without losing annotations whose text survives it. */
export function reloadKeepingAnnotations(editor: Editor, reload: () => void): void {
  const store = useAnnotationStore.getState()
  const before = textIndex(editor.state.doc)
  const anchors = snapshot(before)
  const wasLoading = store.isLoadingDocument
  store.setLoadingDocument(true)
  try {
    reload()
  } finally {
    store.setLoadingDocument(wasLoading)
  }
  if (anchors.length === 0 || wasLoading) return

  const index = textIndex(editor.state.doc)
  const mapped = mapThroughDiff(before.text, index.text)
  const moved = new Map<string, DocRange | null>()
  for (const a of anchors) {
    const offsets = mapped(a.start, a.end)
    const range = (offsets && toDocRange(index, offsets[0], offsets[1])) ?? nearestMatch(index, a.text, a.from)
    moved.set(`${a.from}:${a.to}`, range)
  }
  // Anything not snapshotted (an out-of-bounds range) keeps its position;
  // null detaches, which updatePositions persists.
  useAnnotationStore.getState().updatePositions((from, to) => {
    const key = `${from}:${to}`
    return moved.has(key) ? moved.get(key)! : { from, to }
  })
  editor.view.dispatch(editor.state.tr.setMeta(aiAnnotationsPluginKey, { rebuildDecorations: true }))
}
