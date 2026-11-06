/**
 * Code-block round trips (#1109): an indented block stays indented, a fence
 * grows past the backtick runs inside it, and the fence-line count of a real
 * document does not change across a trip. The editor is the app's own
 * extension list, so this is the parser and serializer the save path uses.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'
import { fenceFor, indentCode } from './index'

function withEditor<T>(markdown: string, fn: (editor: Editor) => T): T {
  const editor = new Editor({ extensions: createEditorExtensions(), content: markdown })
  try {
    return fn(editor)
  } finally {
    editor.destroy()
  }
}

/** The serializer's output (it writes no final newline; the save path keeps the file's). */
const roundTrip = (markdown: string): string =>
  withEditor(markdown, (editor) => editor.storage.markdown.getMarkdown() as string)

/** `{ indented, language, content }` of every code block, in order. */
function codeBlocks(markdown: string): { indented: boolean; language: string | null; content: string }[] {
  return withEditor(markdown, (editor) => {
    const out: { indented: boolean; language: string | null; content: string }[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') {
        out.push({ indented: !!node.attrs.indented, language: node.attrs.language ?? null, content: node.textContent })
      }
      return true
    })
    return out
  })
}

const fenceLines = (markdown: string): number => markdown.split('\n').filter((l) => /^\s*```/.test(l)).length

describe('code blocks through markdown (#1109)', () => {
  it('keeps a fence indented inside a list item as the indented block it is', () => {
    // `*` is the default bullet marker the serializer writes; the marker is a setting, not this issue.
    const md = '* step one:\n\n      ```sh\n      echo hi\n      ```\n\n* step two'
    expect(codeBlocks(md)).toEqual([{ indented: true, language: null, content: '```sh\necho hi\n```' }])
    expect(roundTrip(md)).toBe(md)
    expect(roundTrip(roundTrip(md))).toBe(md)
  })

  it('keeps a top-level indented block indented', () => {
    const md = 'Before.\n\n    plain code\n    more code\n\nAfter.'
    expect(codeBlocks(md)).toEqual([{ indented: true, language: null, content: 'plain code\nmore code' }])
    expect(roundTrip(md)).toBe(md)
  })

  it('fences a block whose content holds a backtick run with a longer fence', () => {
    const md = '````md\n```js\nconsole.log(1)\n```\n````'
    expect(codeBlocks(md)).toEqual([{ indented: false, language: 'md', content: '```js\nconsole.log(1)\n```' }])
    const out = roundTrip(md)
    expect(out).toBe(md)
    expect(codeBlocks(out)).toEqual(codeBlocks(md))
  })

  it('leaves an ordinary fenced block with a language as it was', () => {
    const md = '```ts\nconst a = 1\n```'
    expect(codeBlocks(md)).toEqual([{ indented: false, language: 'ts', content: 'const a = 1' }])
    expect(roundTrip(md)).toBe(md)
  })

  it('keeps the fence-line count of the QA checklist across a round trip', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const checklist = readFileSync(resolve(here, '../../../../docs/qa/v1.9.0-checklist.md'), 'utf8')
    const before = fenceLines(checklist)
    expect(before).toBeGreaterThan(0)
    const once = roundTrip(checklist)
    expect(fenceLines(once)).toBe(before)
    expect(fenceLines(roundTrip(once))).toBe(before)
  })

  it('helpers: the fence is one longer than the longest run, indentation skips blank lines', () => {
    expect(fenceFor('no backticks')).toBe('```')
    expect(fenceFor('a ``` b')).toBe('````')
    expect(fenceFor('a ````` b')).toBe('``````')
    expect(indentCode('a\n\nb')).toBe('    a\n\n    b')
  })
})
