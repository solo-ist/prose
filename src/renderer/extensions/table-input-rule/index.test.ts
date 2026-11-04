/**
 * Typing a pipe table (#1108). The rule is driven the way TipTap's own tests
 * drive input rules: the view's `handleTextInput` prop with the final
 * character, after the document holds everything typed before it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'

let editor: Editor

beforeEach(() => {
  editor = new Editor({ extensions: createEditorExtensions(), content: '' })
})

afterEach(() => {
  editor.destroy()
})

/**
 * Put `html` in the document, place the caret at the end of the last
 * paragraph and type `char` through the input-rule plugin.
 */
function typeAtEnd(html: string, char: string): boolean {
  editor.commands.setContent(html)
  const end = editor.state.doc.content.size - 1
  editor.commands.setTextSelection(end)
  const { view } = editor
  return !!view.someProp('handleTextInput', (f) => f(view, end, end, char, () => view.state.tr))
}

function tables(): { headers: string[]; rows: number }[] {
  const out: { headers: string[]; rows: number }[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    const headers: string[] = []
    node.firstChild!.forEach((cell) => headers.push(cell.textContent))
    out.push({ headers, rows: node.childCount })
    return false
  })
  return out
}

describe('table input rule (#1108)', () => {
  it('turns a header row and a completed delimiter row into a table with one body row', () => {
    expect(typeAtEnd('<p>| a | b |</p><p>| --- | --- </p>', '|')).toBe(true)
    expect(tables()).toEqual([{ headers: ['a', 'b'], rows: 2 }])
    const md = editor.storage.markdown.getMarkdown() as string
    expect(md).toContain('| a | b |')
    expect(md).toContain('| --- | --- |')
    expect(md).not.toContain('<table')
    // The caret is in the first body cell.
    const $from = editor.state.selection.$from
    expect($from.node(-1).type.name).toBe('tableCell')
  })

  it('leaves the paragraphs when the cell counts differ', () => {
    expect(typeAtEnd('<p>| a | b | c |</p><p>| --- | --- </p>', '|')).toBe(false)
    expect(tables()).toEqual([])
  })

  it('leaves a delimiter row with no header row before it', () => {
    expect(typeAtEnd('<p>| --- | --- </p>', '|')).toBe(false)
    expect(tables()).toEqual([])
    expect(typeAtEnd('<h2>Title</h2><p>| --- </p>', '|')).toBe(false)
    expect(tables()).toEqual([])
  })

  it('accepts alignment colons and drops them', () => {
    expect(typeAtEnd('<p>| left | right |</p><p>| :--- | ---: </p>', '|')).toBe(true)
    expect(tables()).toEqual([{ headers: ['left', 'right'], rows: 2 }])
    expect(editor.storage.markdown.getMarkdown()).not.toContain(':')
  })

  it('keeps an escaped pipe as cell text and a typed mark on the header', () => {
    expect(typeAtEnd('<p>| a\\|b | <strong>bold</strong> |</p><p>| --- | --- </p>', '|')).toBe(true)
    expect(tables()).toEqual([{ headers: ['a|b', 'bold'], rows: 2 }])
    // The pipe is cell text; writing it back escaped is the serializer's job (#1107).
    expect(editor.storage.markdown.getMarkdown()).toContain('**bold**')
  })

  it('does nothing while the delimiter row is incomplete', () => {
    expect(typeAtEnd('<p>| a | b |</p><p>| --- | --</p>', '-')).toBe(false)
    expect(tables()).toEqual([])
  })
})
