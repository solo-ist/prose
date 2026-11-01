/**
 * Text anchoring for AI annotations.
 *
 * Annotations are stored as positions. Two paths need to find a range by its
 * text instead: a whole-document reload on source exit (`reanchor.ts`), and a
 * document that comes back re-parsed from markdown on a tab switch or a
 * relaunch, where the serializer has tidied text above the range and the saved
 * positions are a character or two off (#1138, handled in `plugin.ts`). Both
 * read the document through the same index, so an annotation's `anchorText`
 * means the same thing wherever it is compared.
 */

import type { Node as PMNode } from '@tiptap/pm/model'

/** The doc's text with one '\n' between textblocks, and each char's doc position (-1 for separators). */
export function textIndex(doc: PMNode): TextIndex {
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

export interface TextIndex {
  text: string
  pos: number[]
}

export interface DocRange {
  from: number
  to: number
}

/** The text a range covers, in the same form `textIndex` produces. */
export function anchorTextAt(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, '\n')
}

/** The occurrence of `text` whose start is nearest `near`, as doc positions. */
export function nearestMatch(index: TextIndex, text: string, near: number): DocRange | null {
  if (!text) return null
  let best: DocRange | null = null
  for (let i = index.text.indexOf(text); i !== -1; i = index.text.indexOf(text, i + 1)) {
    const from = index.pos[i]
    const last = index.pos[i + text.length - 1]
    if (from === -1 || last === -1) continue
    if (!best || Math.abs(from - near) < Math.abs(best.from - near)) best = { from, to: last + 1 }
  }
  return best
}
