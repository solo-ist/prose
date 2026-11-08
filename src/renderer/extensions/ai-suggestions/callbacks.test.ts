/**
 * The suggestion lifecycle callbacks (#888, from PR #854): one call per
 * suggestion, even when a suggestion's text spans several text nodes (inline
 * formatting splits the mark).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'

const DOC = '<p>Plain <strong>bold</strong> tail sentence.</p><p>Second paragraph here.</p>'

let editor: Editor
const calls: Array<{ kind: 'accepted' | 'rejected'; id: string }> = []

function setup(): void {
  calls.length = 0
  const record = (kind: 'accepted' | 'rejected') => (id: string) => calls.push({ kind, id })
  editor = new Editor({
    content: DOC,
    extensions: createEditorExtensions().map((ext) =>
      ext.name === 'aiSuggestion'
        ? ext.configure({ ...ext.options, onSuggestionAccepted: record('accepted'), onSuggestionRejected: record('rejected') })
        : ext
    )
  })
}

afterEach(() => editor?.destroy())

function suggest(needle: string, id: string): void {
  let range: { from: number; to: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (range || !node.isTextblock) return
    const i = node.textContent.indexOf(needle)
    if (i !== -1) range = { from: pos + 1 + i, to: pos + 1 + i + needle.length }
  })
  if (!range) throw new Error(`"${needle}" not in document`)
  editor
    .chain()
    .setTextSelection(range)
    .setAISuggestion({ id, type: 'edit', originalText: needle, suggestedText: `${needle}!`, explanation: '' })
    .run()
}

/** How many text nodes carry the suggestion's mark. */
function textNodesOf(id: string): number {
  let count = 0
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === 'aiSuggestion' && m.attrs.id === id)) count++
  })
  return count
}

describe('suggestion callbacks', () => {
  it('reject-all calls onSuggestionRejected once per suggestion', () => {
    setup()
    suggest('Plain bold tail', 's-split')
    suggest('Second paragraph', 's-plain')
    expect(textNodesOf('s-split')).toBe(3)

    expect(editor.commands.rejectAllAISuggestions()).toBe(true)

    expect(calls.map((c) => `${c.kind}:${c.id}`).sort()).toEqual(['rejected:s-plain', 'rejected:s-split'])
  })

  it('a single reject calls once', () => {
    setup()
    suggest('Plain bold tail', 's-split')
    editor.commands.rejectAISuggestion('s-split')
    expect(calls).toEqual([{ kind: 'rejected', id: 's-split' }])
  })

  it('accept-all calls onSuggestionAccepted once per suggestion', () => {
    setup()
    suggest('Plain bold tail', 's-split')
    suggest('Second paragraph', 's-plain')
    expect(editor.commands.acceptAllAISuggestions()).toBe(true)
    expect(calls.map((c) => `${c.kind}:${c.id}`).sort()).toEqual(['accepted:s-plain', 'accepted:s-split'])
  })
})
