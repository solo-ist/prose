/**
 * Unit tests for the annotations plugin's `apply` (#1146): records enter a
 * state only through its own transactions, are mapped before a transaction's
 * metas run, are re-anchored by text across a whole-document replace and its
 * undo, are restamped by an identity change, and keep their array reference
 * while nothing moves. A headless TipTap editor built from the app's own
 * extension list supplies the schema, the history plugin and the view.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Editor, createDocument } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'
import { IDENTITY_META, RELOAD_META } from '../../document/identity'
import type { AIAnnotation } from '../../types/annotations'
import { textIndex } from './reanchor'
import { anchorTextAt } from './records'
import {
  addAnnotationsTo,
  annotationPluginState,
  annotationsOf,
  loadAnnotationsInto,
  removeAnnotationFrom,
  removeAnnotationsInRangeFrom
} from './transactions'

const PROV = { model: 'test', conversationId: 'c', messageId: 'm' }
const DOC = '<h1>Probe</h1><p>Intro paragraph here with words.</p><p>Some rewritten text.</p><p>Second paragraph.</p>'

let editor: Editor

beforeEach(() => {
  editor = new Editor({ extensions: createEditorExtensions(), content: DOC })
  editor.view.dispatch(
    editor.state.tr.setMeta(IDENTITY_META, { documentId: 'doc', path: '/doc.md', plain: false }).setMeta('addToHistory', false)
  )
})

function rangeOf(needle: string): { from: number; to: number } {
  const index = textIndex(editor.state.doc)
  const i = index.text.indexOf(needle)
  if (i === -1) throw new Error(`"${needle}" not in document`)
  return { from: index.pos[i], to: index.pos[i + needle.length - 1] + 1 }
}

function textOf(a: AIAnnotation): string {
  return anchorTextAt(editor.state.doc, a.from, a.to)
}

function annotate(needle: string): AIAnnotation {
  const { from, to } = rangeOf(needle)
  editor.commands.addAIAnnotations([{ type: 'replacement', from, to, content: needle, provenance: PROV }])
  const record = annotationsOf(editor.state).find((a) => a.from === from && a.to === to)
  if (!record) throw new Error('record not added')
  return record
}

describe('adding records', () => {
  it('stamps the document id and the anchor text, mints id and createdAt, and is urgent', () => {
    const before = annotationPluginState(editor.state)!
    const a = annotate('rewritten text.')
    expect(a.documentId).toBe('doc')
    expect(a.anchorText).toBe('rewritten text.')
    expect(a.id).toBeTruthy()
    expect(a.createdAt).toBeGreaterThan(0)
    const after = annotationPluginState(editor.state)!
    expect(after.revision).toBe(before.revision + 1)
    expect(after.urgentRevision).toBe(after.revision)
  })

  it('lets an add that reuses an existing id supersede that record', () => {
    const old = annotate('rewritten text.')
    const { from, to } = rangeOf('Second paragraph.')
    editor.view.dispatch(
      addAnnotationsTo(editor.state.tr, [{ id: old.id, createdAt: old.createdAt, type: 'replacement', from, to, content: 'Second paragraph.', provenance: PROV }])
    )
    const records = annotationsOf(editor.state)
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe(old.id)
    expect(records[0].createdAt).toBe(old.createdAt)
    expect(textOf(records[0])).toBe('Second paragraph.')
    expect(records[0].detached).toBeUndefined()
  })

  it('applies an add after mapping, so a replace-and-annotate is one dispatch', () => {
    const old = annotate('rewritten text.')
    const { from, to } = rangeOf('Some rewritten text.')
    const tr = editor.state.tr.replaceWith(from, to, editor.schema.text('Brand new words.'))
    addAnnotationsTo(tr, [{ type: 'replacement', from, to: from + 'Brand new words.'.length, content: 'Brand new words.', provenance: PROV }])
    editor.view.dispatch(tr)
    const records = annotationsOf(editor.state)
    expect(records).toHaveLength(2)
    expect(records[0].id).toBe(old.id)
    expect(records[0].detached).toBe(true)
    expect(textOf(records[1])).toBe('Brand new words.')
    expect(records[1].anchorText).toBe('Brand new words.')
  })
})

describe('mapping and reference stability', () => {
  it('keeps the array reference when a transaction moves nothing and bumps no revision', () => {
    annotate('rewritten text.')
    const before = annotationPluginState(editor.state)!
    editor.commands.insertContentAt(rangeOf('Second paragraph.').to, ' more')
    const after = annotationPluginState(editor.state)!
    expect(after.records).toBe(before.records)
    expect(after.revision).toBe(before.revision)
  })

  it('moves a record under an edit above it without urgency, and detaches with urgency', () => {
    const a = annotate('rewritten text.')
    const before = annotationPluginState(editor.state)!
    editor.commands.insertContentAt(rangeOf('Intro').from, 'New ')
    const moved = annotationPluginState(editor.state)!
    expect(textOf(moved.records[0])).toBe('rewritten text.')
    expect(moved.records[0].from).toBe(a.from + 4)
    expect(moved.revision).toBe(before.revision + 1)
    expect(moved.urgentRevision).toBe(before.urgentRevision)

    const { from, to } = rangeOf('rewritten text.')
    editor.commands.deleteRange({ from, to })
    const detached = annotationPluginState(editor.state)!
    expect(detached.records[0].detached).toBe(true)
    expect(detached.urgentRevision).toBe(detached.revision)
  })
})

describe('remove and removeRange', () => {
  it('removes by id and splits around a removed range', () => {
    const a = annotate('Some rewritten text.')
    const b = annotate('Second paragraph.')
    editor.view.dispatch(removeAnnotationFrom(editor.state.tr, b.id))
    expect(annotationsOf(editor.state).map((r) => r.id)).toEqual([a.id])

    const inner = rangeOf('rewritten')
    editor.view.dispatch(removeAnnotationsInRangeFrom(editor.state.tr, inner.from, inner.to))
    const remnants = annotationsOf(editor.state)
    expect(remnants.map(textOf)).toEqual(['Some ', ' text.'])
    expect(remnants.map((r) => r.anchorText)).toEqual(['Some ', ' text.'])
    expect(annotationPluginState(editor.state)!.urgentRevision).toBe(annotationPluginState(editor.state)!.revision)
  })
})

describe('identity', () => {
  it('restamps every record when the identity changes', () => {
    annotate('rewritten text.')
    editor.view.dispatch(
      editor.state.tr.setMeta(IDENTITY_META, { documentId: 'renamed', path: '/renamed.md', plain: false }).setMeta('addToHistory', false)
    )
    const state = annotationPluginState(editor.state)!
    expect(state.records.map((r) => r.documentId)).toEqual(['renamed'])
    expect(state.urgentRevision).toBe(state.revision)
  })
})

describe('whole-document replace', () => {
  /** The document as a markdown round trip would re-parse it, in this editor's schema. */
  function reparsed(html: string) {
    return createDocument(html, editor.schema)
  }

  it('re-anchors by text on a RELOAD and on a bare whole-document replace, and back on undo', () => {
    const a = annotate('rewritten text.')
    // The markdown round trip drops a trailing space above the highlight.
    const shorter = reparsed(DOC.replace('with words.', 'with'))
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, shorter.content).setMeta(RELOAD_META, true))
    let records = annotationsOf(editor.state)
    expect(textOf(records[0])).toBe('rewritten text.')
    expect(records[0].from).toBe(a.from - 7)
    expect(records[0].detached).toBeUndefined()

    // Undo is the inverse whole-document replace with no meta of ours.
    expect(editor.commands.undo()).toBe(true)
    records = annotationsOf(editor.state)
    expect(editor.state.doc.textContent).toContain('with words.')
    expect(textOf(records[0])).toBe('rewritten text.')
    expect(records[0].from).toBe(a.from)
    expect(records[0].detached).toBeUndefined()

    // Text gone: detached, not deleted.
    const gone = reparsed(DOC.replace('Some rewritten text.', 'Nothing like it.'))
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, gone.content))
    records = annotationsOf(editor.state)
    expect(records).toHaveLength(1)
    expect(records[0].detached).toBe(true)
    expect(editor.view.dom.querySelectorAll('.ai-annotation').length).toBe(0)
  })

  it('repaints after a whole-document replace that moved nothing', () => {
    annotate('rewritten text.')
    const before = annotationPluginState(editor.state)!
    expect(editor.view.dom.querySelectorAll('.ai-annotation').length).toBe(1)
    // The edit is below the highlight: same positions, same records array.
    const below = reparsed(DOC.replace('Second paragraph.', 'Second paragraph, now longer.'))
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, below.content).setMeta(RELOAD_META, true))
    const after = annotationPluginState(editor.state)!
    expect(after.records).toBe(before.records)
    expect(after.revision).toBe(before.revision)
    expect(textOf(after.records[0])).toBe('rewritten text.')
    expect(editor.view.dom.querySelectorAll('.ai-annotation').length).toBe(1)
  })
})

describe('load', () => {
  it('seeds stored rows re-anchored onto the document without urgency', () => {
    const before = annotationPluginState(editor.state)!
    const { from, to } = rangeOf('Second paragraph.')
    const intro = rangeOf('Intro paragraph')
    const rows: AIAnnotation[] = [
      { id: 'kept', documentId: 'old', type: 'insertion', createdAt: 1, from, to, content: 'Second paragraph.', provenance: PROV, anchorText: 'Second paragraph.' },
      { id: 'shifted', documentId: 'old', type: 'insertion', createdAt: 1, from: 3, to: 18, content: 'rewritten text.', provenance: PROV, anchorText: 'rewritten text.' },
      { id: 'legacy', documentId: 'old', type: 'insertion', createdAt: 1, from: intro.from, to: intro.to, content: 'Intro paragraph', provenance: PROV }
    ]
    editor.view.dispatch(loadAnnotationsInto(editor.state.tr, rows).setMeta('addToHistory', false))
    const state = annotationPluginState(editor.state)!
    expect(state.records.map((r) => r.id)).toEqual(['kept', 'shifted', 'legacy'])
    expect(state.records.every((r) => r.documentId === 'doc')).toBe(true)
    expect(textOf(state.records[1])).toBe('rewritten text.')
    expect(state.records[2].anchorText).toBe('Intro paragraph')
    expect(state.revision).toBe(before.revision + 1)
    expect(state.urgentRevision).toBe(before.urgentRevision)
    expect(editor.view.dom.querySelectorAll('.ai-annotation').length).toBe(3)
  })
})
