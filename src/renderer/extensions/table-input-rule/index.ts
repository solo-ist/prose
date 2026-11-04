/**
 * Type a GFM pipe table (#1108).
 *
 * A header row (`| a | b |`) followed by a completed delimiter row
 * (`| --- | --- |`) becomes a table the moment the delimiter row's closing
 * pipe is typed: the header cells come from the typed row's inline content
 * (marks survive, cell edges are trimmed), the first row is all header cells
 * (the shape the pipe serializer needs), and one empty body row follows with
 * the caret in its first cell. Backspace right after undoes it, as with any
 * input rule. Alignment colons are accepted and dropped: the serializer never
 * writes them, so keeping them would only lose them on the next save.
 */

import { Extension, InputRule } from '@tiptap/core'
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { tableNodeTypes } from '@tiptap/pm/tables'

/** A completed delimiter row: `| --- | :---: |`, three or more dashes per cell. */
export const DELIMITER_ROW = /^\|(?:\s*:?-{3,}:?\s*\|)+$/

/** The cells of a delimiter row (its count is all that matters). */
export function delimiterCellCount(row: string): number {
  return row.trim().slice(1, -1).split('|').length
}

/**
 * Split a paragraph's inline content at its pipes into one fragment per cell,
 * keeping marks. `\|` is a literal pipe. Returns null when the row is not a
 * pipe row (no outer pipes, fewer than one cell) or holds a non-text inline
 * node, which a pipe row has no place for.
 */
export function splitPipeRow(paragraph: PMNode): Fragment[] | null {
  const text = paragraph.textContent
  if (!/^\|.*\|$/.test(text.trim())) return null

  const cells: PMNode[][] = [[]]
  let bad = false
  paragraph.content.forEach((inline) => {
    if (bad) return
    if (!inline.isText || inline.text === undefined) {
      bad = true
      return
    }
    let buffer = ''
    const flush = () => {
      if (buffer) cells[cells.length - 1]!.push(inline.type.schema.text(buffer, inline.marks))
      buffer = ''
    }
    const chars = inline.text
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!
      if (ch === '\\' && chars[i + 1] === '|') {
        buffer += '|'
        i += 1
      } else if (ch === '|') {
        flush()
        cells.push([])
      } else {
        buffer += ch
      }
    }
    flush()
  })
  if (bad) return null

  // Outer pipes leave an empty first and last cell.
  const inner = cells.slice(1, -1)
  if (inner.length === 0) return null
  return inner.map((nodes) => Fragment.from(trimEdges(nodes)))
}

/** Drop the whitespace at both ends of a cell's text nodes. */
function trimEdges(nodes: PMNode[]): PMNode[] {
  const out = nodes.map((n) => n)
  if (out.length === 0) return out
  const first = out[0]!
  const trimmedFirst = first.text!.replace(/^\s+/, '')
  if (trimmedFirst !== first.text) out[0] = trimmedFirst ? first.type.schema.text(trimmedFirst, first.marks) : null!
  const lastIndex = out.length - 1
  const last = out[lastIndex]
  if (last) {
    const trimmedLast = last.text!.replace(/\s+$/, '')
    if (trimmedLast !== last.text) out[lastIndex] = trimmedLast ? last.type.schema.text(trimmedLast, last.marks) : null!
  }
  return out.filter((n): n is PMNode => n !== null)
}

/** The table a typed header row makes: that row as header cells, one empty body row. */
export function buildTypedTable(schema: Schema, headerCells: Fragment[]): PMNode {
  const types = tableNodeTypes(schema)
  const paragraph = schema.nodes.paragraph!
  const header = types.row.createChecked(
    null,
    headerCells.map((content) => types.header_cell.createChecked(null, paragraph.create(null, content)))
  )
  const body = types.row.createChecked(
    null,
    headerCells.map(() => types.cell.createChecked(null, paragraph.create()))
  )
  return types.table.createChecked(null, [header, body])
}

export const TableInputRule = Extension.create({
  name: 'tableInputRule',

  addInputRules() {
    return [
      new InputRule({
        find: DELIMITER_ROW,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          const delimiter = $from.parent
          if (delimiter.type.name !== 'paragraph' || $from.parentOffset !== 0) return null
          // The match starts at the paragraph's first character (the regex is
          // anchored at both ends and the typed character is not in the
          // document yet), so the row is the whole paragraph only when the
          // caret is at its end.
          const $to = state.doc.resolve(range.to)
          if ($to.parentOffset !== $to.parent.content.size) return null
          const index = $from.index(-1)
          if (index === 0) return null
          const header = $from.node(-1).child(index - 1)
          if (header.type.name !== 'paragraph') return null

          const cells = splitPipeRow(header)
          if (!cells || cells.length !== delimiterCellCount(match[0])) return null

          const delimiterStart = $from.before()
          const headerStart = delimiterStart - header.nodeSize
          const end = $from.after()
          const table = buildTypedTable(state.schema, cells)

          const { tr } = state
          tr.replaceWith(headerStart, end, table)
          // Caret in the first body cell: table open, the header row, row open, cell open, paragraph open.
          const firstBodyCell = headerStart + 1 + table.firstChild!.nodeSize + 1 + 1 + 1
          tr.setSelection(TextSelection.near(tr.doc.resolve(firstBodyCell)))
          tr.scrollIntoView()
          return undefined
        }
      })
    ]
  }
})
