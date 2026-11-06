/**
 * Superscript and subscript round-trip as `^x^` and `~x~` (#1110), through
 * the app's own extension list, parser and serializer.
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'

function withEditor<T>(markdown: string, fn: (editor: Editor) => T): T {
  const editor = new Editor({ extensions: createEditorExtensions(), content: markdown })
  try {
    return fn(editor)
  } finally {
    editor.destroy()
  }
}

const serialize = (markdown: string): string =>
  withEditor(markdown, (editor) => editor.storage.markdown.getMarkdown() as string)

/** Every `[markName, text]` of the first paragraph, in order. */
function marked(markdown: string): Array<[string, string]> {
  return withEditor(markdown, (editor) => {
    const out: Array<[string, string]> = []
    editor.state.doc.firstChild!.forEach((inline) => {
      inline.marks.forEach((mark) => out.push([mark.type.name, inline.text ?? '']))
    })
    return out
  })
}

describe('superscript and subscript as markdown (#1110)', () => {
  it('reads and writes the caret syntax for superscript', () => {
    expect(marked('x^2^ and e^iπ^')).toEqual([
      ['superscript', '2'],
      ['superscript', 'iπ']
    ])
    expect(serialize('x^2^ and e^iπ^')).toBe('x^2^ and e^iπ^')
  })

  it('reads and writes the tilde syntax for subscript', () => {
    expect(marked('H~2~O')).toEqual([['subscript', '2']])
    expect(serialize('H~2~O')).toBe('H~2~O')
  })

  it('still reads the HTML form and writes it back as markdown', () => {
    expect(marked('x<sup>2</sup> and H<sub>2</sub>O')).toEqual([
      ['superscript', '2'],
      ['subscript', '2']
    ])
    expect(serialize('x<sup>2</sup> and H<sub>2</sub>O')).toBe('x^2^ and H~2~O')
  })

  it('leaves strikethrough and a literal tilde alone', () => {
    expect(marked('~~gone~~ and 5 \\~ 6')).toEqual([['strike', 'gone']])
    expect(serialize('~~gone~~ and 5 \\~ 6')).toBe('~~gone~~ and 5 \\~ 6')
  })

  it('keeps a table with a superscript a pipe table', () => {
    const md = '| a | b |\n| --- | --- |\n| x^2^ | y |'
    const out = serialize(md)
    expect(out).toContain('| x^2^ | y |')
    expect(out).not.toContain('<table')
  })

  it('still writes underline as HTML, since markdown has no syntax for it', () => {
    expect(serialize('a <u>line</u> here')).toBe('a <u>line</u> here')
  })
})
