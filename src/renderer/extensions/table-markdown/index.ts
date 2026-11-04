/**
 * Pipe tables that survive their own cells (#1107).
 *
 * tiptap-markdown serializes a table as a GFM pipe table but never escapes `|`
 * inside a cell: a cell holding `a|b` comes back as two cells, and a cell that
 * ends in `|` manufactures an extra empty cell that markdown-it then drops
 * (`rules_block/table.mjs` keeps `columnCount` cells per row). That was the one
 * silent data loss in the 1.9.0 QA pass. The same serializer writes every row at
 * its own width while the delimiter row follows the header, so a ragged table
 * loses every cell past the header's width on the next parse.
 *
 * This extension replaces the table's `serialize` only. tiptap-markdown spreads
 * its default spec under an extension's own (`getMarkdownSpec`), so parsing
 * stays with markdown-it, and the shape of the output is the default's: the same
 * `| a | b |` layout, the HTML fallback for a table with spans or multi-block
 * cells (`isPipeSerializable` is its rule), `state.inTable` for the hard-break
 * serializer. Two changes:
 *
 * 1. Every `|` a cell renders is escaped as `\|`. The escape is applied to the
 *    rendered text of the cell, so it covers code spans and link text as well as
 *    plain text; markdown-it unescapes `\|` inside a table cell in every inline
 *    span, code included, so the round trip is exact.
 * 2. Every row, the header included, is padded with empty cells to the widest
 *    row, and the delimiter row has that many columns. A ragged table (the state
 *    `tableCommands.ts` models as `isUniformGrid === false`) then re-parses with
 *    every cell, as a rectangle.
 *
 * tiptap-markdown's own `HTMLNode` and `childNodes` are not importable (the
 * package exports only its entry point), so the fallback is reproduced here.
 */

import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { getHTMLFromFragment } from '@tiptap/core'
import Table from '@tiptap/extension-table'

/** The slice of prosemirror-markdown's serializer state this serializer touches. */
interface SerializerState {
  out: string
  inTable?: boolean
  write(content?: string): void
  ensureNewLine(): void
  closeBlock(node: PMNode): void
  renderInline(parent: PMNode): void
}

/** `this` inside a tiptap-markdown node serializer (`MarkdownSerializer.serializeNode`). */
interface SerializerContext {
  editor: { storage: { markdown: { options: { html: boolean } } } }
}

const hasSpan = (cell: PMNode): boolean =>
  (cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1

/**
 * tiptap-markdown's rule for emitting a pipe table rather than HTML: the first
 * row is all header cells, no other row has one, no cell spans, and every cell
 * holds exactly one block.
 */
export function isPipeSerializable(table: PMNode): boolean {
  for (let r = 0; r < table.childCount; r++) {
    const row = table.child(r)
    for (let c = 0; c < row.childCount; c++) {
      const cell = row.child(c)
      const isHeader = cell.type.name === 'tableHeader'
      if ((r === 0 ? !isHeader : isHeader) || hasSpan(cell) || cell.childCount > 1) return false
    }
  }
  return true
}

/**
 * Escape every pipe in a cell's rendered markdown. prosemirror-markdown has
 * already doubled literal backslashes in plain text, so each `|` left is a
 * pipe that would split the cell.
 */
export function escapePipes(renderedCell: string): string {
  return renderedCell.replace(/\|/g, '\\|')
}

/** The widest row: the column count every row is padded to. */
export function tableWidth(table: PMNode): number {
  let width = 0
  table.forEach((row) => {
    width = Math.max(width, row.childCount)
  })
  return width
}

/**
 * tiptap-markdown's `formatBlock`: a top-level HTML block carries its inner
 * HTML on its own lines, the CommonMark block form. Done on the string rather
 * than through a detached element so no HTML is assigned to a DOM node.
 */
function formatBlock(html: string): string {
  const match = /^(<table\b[^>]*>)([\s\S]*)(<\/table>)$/.exec(html)
  if (!match) return html
  const inner = match[2]!.trim() ? `\n${match[2]}\n` : '\n'
  return `${match[1]}${inner}${match[3]}`
}

function serializeAsHtml(
  this: SerializerContext,
  state: SerializerState,
  node: PMNode,
  parent: PMNode | Fragment
): void {
  if (!this.editor.storage.markdown.options.html) {
    console.warn(`Tiptap Markdown: "${node.type.name}" node is only available in html mode`)
    state.write(`[${node.type.name}]`)
    state.closeBlock(node)
    return
  }
  const schema = node.type.schema
  const html = getHTMLFromFragment(Fragment.from(node), schema)
  const topLevel = parent instanceof Fragment || parent.type.name === schema.topNodeType.name
  state.write(topLevel ? formatBlock(html) : html)
  state.closeBlock(node)
}

function serializePipeTable(state: SerializerState, table: PMNode): void {
  const width = tableWidth(table)
  state.inTable = true
  table.forEach((row, _offset, index) => {
    state.write('| ')
    for (let column = 0; column < width; column++) {
      if (column) state.write(' | ')
      const cell = column < row.childCount ? row.child(column) : null
      const content = cell?.firstChild ?? null
      if (content && content.textContent.trim()) {
        const start = state.out.length
        state.renderInline(content)
        state.out = state.out.slice(0, start) + escapePipes(state.out.slice(start))
      }
    }
    state.write(' |')
    state.ensureNewLine()
    if (index === 0) {
      state.write(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`)
      state.ensureNewLine()
    }
  })
  state.closeBlock(table)
  state.inTable = false
}

export const TableMarkdown = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(this: SerializerContext, state: SerializerState, node: PMNode, parent: PMNode | Fragment) {
          if (!isPipeSerializable(node)) {
            serializeAsHtml.call(this, state, node, parent)
            return
          }
          serializePipeTable(state, node)
        }
      }
    }
  }
})
