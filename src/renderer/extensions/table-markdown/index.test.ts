/**
 * Pipe-table serialization (#1107): a cell keeps its pipes across a round trip
 * and a ragged table keeps every cell. The editor is the app's own extension
 * list, so this is the serializer and parser the save path uses.
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'
import { TableMarkdown, escapePipes } from './index'

type Content = string | Record<string, unknown>

function withEditor<T>(content: Content, fn: (editor: Editor) => T): T {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  try {
    return fn(editor)
  } finally {
    editor.destroy()
  }
}

const serialize = (content: Content): string =>
  withEditor(content, (editor) => editor.storage.markdown.getMarkdown() as string)

/** The text of every cell, row by row, of the first table in the document. */
function cellTexts(editor: Editor): string[][] {
  const rows: string[][] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    node.forEach((row) => {
      const cells: string[] = []
      row.forEach((cell) => cells.push(cell.textContent))
      rows.push(cells)
    })
    return false
  })
  return rows
}

const parsedCells = (markdown: string): string[][] => withEditor(markdown, cellTexts)

const text = (value: string) => ({ type: 'text', text: value })
const paragraph = (...content: object[]) => ({ type: 'paragraph', content })
const cell = (type: 'tableHeader' | 'tableCell', value: string, attrs?: Record<string, unknown>) => ({
  type,
  ...(attrs ? { attrs } : {}),
  content: [paragraph(text(value))]
})
const row = (...cells: object[]) => ({ type: 'tableRow', content: cells })
const doc = (...content: object[]) => ({ type: 'doc', content })

describe('table markdown (#1107)', () => {
  it('escapes a pipe inside a cell, and the cell comes back whole', () => {
    const md = '| a\\|b | c |\n| --- | --- |\n| d | e |'
    expect(parsedCells(md)).toEqual([
      ['a|b', 'c'],
      ['d', 'e']
    ])
    const out = serialize(md)
    expect(out).toContain('| a\\|b | c |')
    expect(parsedCells(out)).toEqual(parsedCells(md))
    expect(serialize(out)).toBe(out)
  })

  it('a cell that ends in a pipe does not grow the row', () => {
    const md = '| h | i |\n| --- | --- |\n| ends\\| | z |'
    const out = serialize(md)
    expect(out).toContain('| ends\\| | z |')
    expect(parsedCells(out)).toEqual([
      ['h', 'i'],
      ['ends|', 'z']
    ])
  })

  it('escapes a pipe inside a code span too', () => {
    const md = '| h | i |\n| --- | --- |\n| `x\\|y` | z |'
    const out = serialize(md)
    expect(out).toContain('`x\\|y`')
    expect(parsedCells(out)).toEqual([
      ['h', 'i'],
      ['x|y', 'z']
    ])
  })

  it('pads a ragged table to its widest row, header included, so no cell is dropped', () => {
    const ragged = doc({
      type: 'table',
      content: [
        row(cell('tableHeader', 'a'), cell('tableHeader', 'b')),
        row(cell('tableCell', '1'), cell('tableCell', '2'), cell('tableCell', '3')),
        row(cell('tableCell', '4'))
      ]
    })
    const out = serialize(ragged)
    expect(out.split('\n').filter((line) => line.startsWith('|'))).toEqual([
      '| a | b |  |',
      '| --- | --- | --- |',
      '| 1 | 2 | 3 |',
      '| 4 |  |  |'
    ])
    expect(parsedCells(out)).toEqual([
      ['a', 'b', ''],
      ['1', '2', '3'],
      ['4', '', '']
    ])
  })

  it('still writes a table with a spanning cell as an HTML block', () => {
    const spanning = doc({
      type: 'table',
      content: [
        row(cell('tableHeader', 'wide', { colspan: 2 })),
        row(cell('tableCell', '1'), cell('tableCell', '2'))
      ]
    })
    const out = serialize(spanning)
    expect(out).toMatch(/^<table[^>]*>\n/)
    expect(out).toContain('colspan="2"')
    expect(out).toMatch(/\n<\/table>\s*$/)
  })

  it('leaves pipes outside a table alone', () => {
    // Outside a table a pipe needs no escape, and markdown-it reads `\|` as `|`.
    expect(serialize('a|b and c\\|d')).toBe('a|b and c|d')
  })

  it('keeps a hard break inside a cell as <br>', () => {
    const broken = doc({
      type: 'table',
      content: [
        row(cell('tableHeader', 'h')),
        row({
          type: 'tableCell',
          content: [paragraph(text('one'), { type: 'hardBreak' }, text('two'))]
        })
      ]
    })
    const out = serialize(broken)
    expect(out).toContain('<br>')
    expect(out.split('\n').filter((line) => line.startsWith('|'))).toHaveLength(3)
  })

  it('keeps a cell whose only content is an image', () => {
    const imageOnly = doc({
      type: 'table',
      content: [
        row(cell('tableHeader', 'h'), cell('tableHeader', 'i')),
        row(
          { type: 'tableCell', content: [paragraph({ type: 'image', attrs: { src: 'pic.png', alt: 'pic' } })] },
          cell('tableCell', 'z')
        )
      ]
    })
    const body = serialize(imageOnly)
      .split('\n')
      .filter((line) => line.startsWith('|'))[2]
    expect(body).toBe('| ![pic](pic.png) | z |')
  })

  it('restores inTable when a cell throws while rendering', () => {
    const table = withEditor('| a | b |\n| --- | --- |\n| c | d |', (editor) => editor.state.doc.firstChild!)
    const state = {
      out: '',
      inTable: false,
      write() {},
      ensureNewLine() {},
      closeBlock() {},
      renderInline() {
        throw new Error('malformed cell')
      }
    }
    const storage = (TableMarkdown.config.addStorage as () => { markdown: { serialize: Function } }).call(TableMarkdown)
    const context = { editor: { storage: { markdown: { options: { html: true } } } } }
    expect(() => storage.markdown.serialize.call(context, state, table, table)).toThrow('malformed cell')
    expect(state.inTable).toBe(false)
  })

  it('escapePipes escapes every pipe in rendered cell text', () => {
    expect(escapePipes('a|b')).toBe('a\\|b')
    expect(escapePipes('||')).toBe('\\|\\|')
    expect(escapePipes('plain')).toBe('plain')
  })
})
