/**
 * Re-anchor AI annotations by their text across a whole-document reload.
 *
 * Annotations are decorations over stored positions, kept current by mapping
 * them through each transaction. A `setContent` (leaving source mode) replaces
 * the whole document in one step, and mapping through that collapses every
 * range, so the store would detach them all — history-only, no highlight —
 * even where the annotated text is untouched. Instead: read each live
 * annotation's text before the reload, pause mapping across it, then put each
 * one back on the occurrence of its text nearest where it was. Only an
 * annotation whose text is gone detaches.
 */

import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useAnnotationStore } from './store'
import { aiAnnotationsPluginKey } from './plugin'

/** The doc's text with one '\n' between textblocks, and each char's doc position (-1 for separators). */
function textIndex(doc: PMNode): { text: string; pos: number[] } {
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

interface AnchorSnapshot {
  from: number
  to: number
  text: string
}

function snapshot(doc: PMNode): AnchorSnapshot[] {
  const index = textIndex(doc)
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
    result.push({ from: a.from, to: a.to, text: index.text.slice(start, end) })
  }
  return result
}

/** The occurrence of `text` whose start is nearest `near`, as doc positions. */
function nearestMatch(index: { text: string; pos: number[] }, text: string, near: number): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null
  for (let i = index.text.indexOf(text); i !== -1; i = index.text.indexOf(text, i + 1)) {
    const from = index.pos[i]
    const last = index.pos[i + text.length - 1]
    if (from === -1 || last === -1) continue
    if (!best || Math.abs(from - near) < Math.abs(best.from - near)) best = { from, to: last + 1 }
  }
  return best
}

/** Run `reload` (a whole-document replace) without losing annotations whose text survives it. */
export function reloadKeepingAnnotations(editor: Editor, reload: () => void): void {
  const store = useAnnotationStore.getState()
  const anchors = snapshot(editor.state.doc)
  const wasLoading = store.isLoadingDocument
  store.setLoadingDocument(true)
  try {
    reload()
  } finally {
    store.setLoadingDocument(wasLoading)
  }
  if (anchors.length === 0 || wasLoading) return

  const index = textIndex(editor.state.doc)
  const moved = new Map<string, { from: number; to: number } | null>()
  for (const a of anchors) {
    moved.set(`${a.from}:${a.to}`, nearestMatch(index, a.text, a.from))
  }
  // Anything not snapshotted (an out-of-bounds range) keeps its position;
  // null detaches, which updatePositions persists.
  useAnnotationStore.getState().updatePositions((from, to) => {
    const key = `${from}:${to}`
    return moved.has(key) ? moved.get(key)! : { from, to }
  })
  editor.view.dispatch(editor.state.tr.setMeta(aiAnnotationsPluginKey, { rebuildDecorations: true }))
}
