/**
 * The `tracked` record kind (#891, design §5): records anchored in the
 * original text, put back on a document built from the file, orphaned when
 * their context is gone.
 */

import { describe, it, expect } from 'vitest'
import type { Editor } from '@tiptap/core'
import { makeEditor, after, before, cursor, select, type, runs } from './testEditor'
import { trackedRecordsOf, applyTrackedRecords, originalTextOf, CONTEXT_CHARS } from './records'
import { trackedMarkTypes } from './changes'
import { TRACK_SKIP_META } from './transactions'

/** Records of `editor`'s document, re-applied to a fresh document built from `markdown`. */
function reapply(editor: Editor, markdown: string) {
  const records = trackedRecordsOf(editor.state.doc)
  const fresh = makeEditor(markdown, { suggesting: false }).editor
  const tr = fresh.state.tr.setMeta(TRACK_SKIP_META, true)
  const orphans = applyTrackedRecords(tr, records)
  fresh.view.dispatch(tr)
  return { fresh, records, orphans }
}

describe('tracked records', () => {
  it('anchor each range in the original text with up to 32 characters each side, inside its paragraph', () => {
    const { editor } = makeEditor('Alpha beta gamma.\n\nDelta epsilon.')
    select(editor, before(editor, 'beta'), after(editor, 'beta'))
    type(editor, 'BETA')
    const records = trackedRecordsOf(editor.state.doc)
    expect(records.map((r) => [r.kind, r.text, r.before, r.after, r.at])).toEqual([
      ['delete', 'beta', 'Alpha ', ' gamma.\n', 6],
      ['insert', 'BETA', 'Alpha beta', ' gamma.\n', 10],
    ])
    expect(records[0].id).toBe(records[1].id)
    expect(records[1].content).toEqual([{ type: 'text', text: 'BETA' }])
  })

  it('cap the context at 32 characters', () => {
    const long = 'x'.repeat(50)
    const { editor } = makeEditor(`${long} end`)
    cursor(editor, after(editor, 'end'))
    type(editor, '!')
    const [record] = trackedRecordsOf(editor.state.doc)
    expect(record.before).toHaveLength(CONTEXT_CHARS)
  })

  it('go back exactly onto the file they came from', () => {
    const { editor } = makeEditor('Alpha beta gamma.\n\nDelta epsilon.')
    select(editor, before(editor, 'beta'), after(editor, 'beta'))
    type(editor, 'BETA')
    cursor(editor, after(editor, 'epsilon'))
    type(editor, ' zeta')
    const { fresh, orphans } = reapply(editor, 'Alpha beta gamma.\n\nDelta epsilon.')
    expect(orphans).toEqual([])
    expect(runs(fresh.state.doc)).toEqual(runs(editor.state.doc))
    expect(trackedRecordsOf(fresh.state.doc)).toEqual(trackedRecordsOf(editor.state.doc))
  })

  it('keep an insertion’s formatting', () => {
    const { editor } = makeEditor('Hello world.')
    const { insert } = trackedMarkTypes(editor.schema)
    const bold = editor.schema.marks.bold.create()
    editor.view.dispatch(
      editor.state.tr.insert(after(editor, 'Hello'), editor.schema.text(' big', [bold, insert.create({ id: 'i1', actor: null, createdAt: 1 })])).setMeta(TRACK_SKIP_META, true)
    )
    const { fresh } = reapply(editor, 'Hello world.')
    let found = false
    fresh.state.doc.descendants((n) => {
      if (n.isText && n.text === ' big') found = n.marks.some((m) => m.type.name === 'bold') && n.marks.some((m) => m.type.name === 'trackedInsert')
    })
    expect(found).toBe(true)
  })

  it('are orphaned, not put back elsewhere, when their context changed outside Prose', () => {
    const { editor } = makeEditor('Alpha beta gamma.\n\nDelta epsilon.')
    select(editor, before(editor, 'beta'), after(editor, 'beta'))
    type(editor, 'BETA')
    cursor(editor, after(editor, 'epsilon'))
    type(editor, ' zeta')
    const { fresh, orphans } = reapply(editor, 'Alpha beta, gamma!\n\nDelta epsilon.')
    // The replacement's context changed; the insertion after "epsilon" still fits.
    expect(orphans.map((o) => o.kind)).toEqual(['delete', 'insert'])
    expect(runs(fresh.state.doc)).toEqual(['Alpha beta, gamma!', 'Delta epsilon[+ zeta].'])
  })

  it('take the occurrence nearest where they were when the context repeats', () => {
    const { editor } = makeEditor('one two. one two. one two.')
    const second = editor.state.doc.textContent.indexOf('two', 6) + 1
    cursor(editor, second + 3)
    type(editor, '!')
    const { fresh, orphans } = reapply(editor, 'one two. one two. one two.')
    expect(orphans).toEqual([])
    expect(runs(fresh.state.doc)).toEqual(['one two. one two[+!]. one two.'])
  })

  it('keep two insertions at one place in their order, and a deletion before an insertion at its start', () => {
    const { editor } = makeEditor('Hello world.')
    const { insert, remove } = trackedMarkTypes(editor.schema)
    const at = after(editor, 'Hello')
    editor.view.dispatch(
      editor.state.tr
        .insert(at, [
          editor.schema.text(' A', [insert.create({ id: 'a', actor: null, createdAt: 1 })]),
          editor.schema.text(' B', [insert.create({ id: 'b', actor: null, createdAt: 1 })]),
        ])
        .setMeta(TRACK_SKIP_META, true)
    )
    const from = before(editor, 'world')
    editor.view.dispatch(editor.state.tr.addMark(from, from + 5, remove.create({ id: 'c', actor: null, createdAt: 1 })).setMeta(TRACK_SKIP_META, true))
    const { fresh, orphans } = reapply(editor, 'Hello world.')
    expect(orphans).toEqual([])
    expect(runs(fresh.state.doc)).toEqual(runs(editor.state.doc))
  })
})

describe('originalTextOf', () => {
  it('leaves insertions out and keeps deletions', () => {
    const { editor } = makeEditor('Hello world.')
    select(editor, before(editor, 'world'), after(editor, 'world'))
    type(editor, 'there')
    expect(originalTextOf(editor.state.doc.firstChild!)).toBe('Hello world.')
  })
})
