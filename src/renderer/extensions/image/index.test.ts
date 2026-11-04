/**
 * Image sources through markdown (#1133): a file name with spaces is written
 * in a form markdown-it reads back as an image, and the output is stable.
 * The editor is the app's own extension list.
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'
import { encodeImageSrc } from './index'

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

/** The `src` of every image node, in order. */
const imageSrcs = (content: Content): string[] =>
  withEditor(content, (editor) => {
    const out: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') out.push(String(node.attrs.src))
      return true
    })
    return out
  })

const imageDoc = (src: string, alt = 'Screenshot 2026 10 30 at 1.45.22 AM') => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt } }] }]
})

const SPACED = 'Screenshot 2026-10-30 at 1.45.22 AM.png'
const ENCODED = 'Screenshot%202026-10-30%20at%201.45.22%E2%80%AFAM.png'

describe('image sources through markdown (#1133)', () => {
  it('writes a spaced file name percent-encoded, and it comes back as an image', () => {
    const md = serialize(imageDoc(SPACED))
    expect(md).toBe(`![Screenshot 2026 10 30 at 1.45.22 AM](${ENCODED})`)
    expect(imageSrcs(md)).toEqual([ENCODED])
    expect(serialize(md)).toBe(md)
  })

  it('leaves an already encoded source and a URL with a query string alone', () => {
    expect(serialize(imageDoc(ENCODED))).toContain(`](${ENCODED})`)
    const url = 'https://example.com/a/b.png?size=2&v=1#x'
    expect(serialize(imageDoc(url, 'remote'))).toBe(`![remote](${url})`)
  })

  it('still escapes parentheses, as the default serializer did', () => {
    expect(serialize(imageDoc('shot (1).png', 'shot'))).toBe('![shot](shot%20\\(1\\).png)')
    expect(imageSrcs('![shot](shot%20\\(1\\).png)')).toEqual(['shot%20(1).png'])
  })

  it('documents the loss it prevents: a raw spaced destination is text to markdown-it, an angle-bracketed one is not', () => {
    expect(imageSrcs('![a](x y.png)')).toEqual([])
    expect(imageSrcs('![a](<x y.png>)')).toEqual(['x%20y.png'])
  })

  it('encodeImageSrc touches only whitespace and angle brackets', () => {
    expect(encodeImageSrc('a b\tc d e.png')).toBe('a%20b%09c%C2%A0d%E2%80%AFe.png')
    expect(encodeImageSrc('x<y>z.png')).toBe('x%3Cy%3Ez.png')
    expect(encodeImageSrc('already%20done.png')).toBe('already%20done.png')
    expect(encodeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })
})
