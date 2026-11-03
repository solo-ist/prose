/**
 * Unit tests for the pure annotation record functions (#1146): mapping
 * through a transaction, re-anchoring across a whole-document replace,
 * seeding stored rows onto a re-parsed document, and the small helpers.
 * The schema comes from the app's own extension list.
 */

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { createEditorExtensions } from '../../components/editor/extensions'
import type { AIAnnotation } from '../../types/annotations'
import {
  anchorTextAt,
  isWholeDocumentReplace,
  mapRecords,
  reanchorRecords,
  loadRecords,
  refreshAnchors,
  removeRecordsInRange,
  restampRecords,
  stampAdded
} from './records'
import { textIndex, snapshotAnchors } from './reanchor'

// Module scope: the fixtures below are built while the describe blocks are
// collected, before any hook runs.
const editor = new Editor({ extensions: createEditorExtensions(), content: '' })

function docOf(html: string): PMNode {
  editor.commands.setContent(html)
  return editor.state.doc
}

/** Doc positions of the first occurrence of `needle` in the doc's text. */
function rangeOf(doc: PMNode, needle: string): { from: number; to: number } {
  const index = textIndex(doc)
  const i = index.text.indexOf(needle)
  if (i === -1) throw new Error(`"${needle}" not in document`)
  return { from: index.pos[i], to: index.pos[i + needle.length - 1] + 1 }
}

let seq = 0
function record(doc: PMNode, needle: string, extra: Partial<AIAnnotation> = {}): AIAnnotation {
  const { from, to } = rangeOf(doc, needle)
  return {
    id: `a${++seq}`,
    documentId: 'doc',
    type: 'replacement',
    createdAt: 1,
    from,
    to,
    content: needle,
    provenance: { model: 'test', conversationId: 'c', messageId: 'm' },
    anchorText: anchorTextAt(doc, from, to),
    ...extra
  }
}

function textAt(doc: PMNode, a: AIAnnotation): string {
  return anchorTextAt(doc, a.from, a.to)
}

const PROBE = '<h1>Probe</h1><p>Intro paragraph here with words.</p><p>Some rewritten text.</p><p>Second paragraph.</p>'

describe('anchorTextAt', () => {
  it('matches the text index slice across an empty paragraph, a list and a hard break', () => {
    const doc = docOf('<p>alpha beta</p><p></p><ul><li><p>gamma</p></li><li><p>delta</p></li></ul><p>eps<br>zeta</p>')
    const index = textIndex(doc)
    const spans = ['alpha beta', 'beta', 'gamma', 'gamma\ndelta', 'beta\n\ngamma', 'eps', 'epszeta', 'zeta']
    for (const span of spans) {
      const i = index.text.indexOf(span)
      expect(i, span).toBeGreaterThanOrEqual(0)
      const from = index.pos[i]
      const to = index.pos[i + span.length - 1] + 1
      expect(anchorTextAt(doc, from, to), span).toBe(span)
      const [anchor] = snapshotAnchors(index, [record(doc, span)])
      expect(index.text.slice(anchor.start, anchor.end), span).toBe(span)
    }
    expect(anchorTextAt(doc, 3, 3)).toBe('')
    expect(anchorTextAt(doc, 0, doc.content.size)).toBe(index.text)
  })
})

describe('mapRecords', () => {
  it('moves a record below an edit and returns the same array when nothing moved', () => {
    const doc = docOf(PROBE)
    const a = record(doc, 'rewritten text.')
    const below = record(doc, 'Second')
    const state = EditorState.create({ doc })
    const { from: introEnd } = rangeOf(doc, 'words.')
    const tr = state.tr.insertText('new ', introEnd)
    const result = mapRecords([a, below], tr)
    expect(result.records).toHaveLength(2)
    expect(textAt(tr.doc, result.records[0])).toBe('rewritten text.')
    expect(textAt(tr.doc, result.records[1])).toBe('Second')
    expect(result.moved.map((m) => m.id)).toEqual([a.id, below.id])
    expect(result.detached).toEqual([])

    const unrelated = state.tr.insertText('x', rangeOf(doc, 'Second').to)
    const input = [a]
    const same = mapRecords(input, unrelated)
    expect(same.records).toBe(input)
    expect(same.moved).toEqual([])
  })

  it('leaves a malformed range alone instead of mapping it', () => {
    const doc = docOf(PROBE)
    const bad = { ...record(doc, 'Intro'), from: 30, to: 10 }
    const before = docOf(PROBE.replace('with words.', 'with'))
    const r = reanchorRecords([bad], doc, before)
    expect(r.records[0]).toBe(bad)
    expect(r.detached).toEqual([])
  })

  it('splits a record around text typed inside it, with new ids and sliced content', () => {
    const doc = docOf(PROBE)
    const a = record(doc, 'rewritten text.')
    const state = EditorState.create({ doc })
    const pos = rangeOf(doc, ' text.').from
    const tr = state.tr.insertText('X', pos)
    const result = mapRecords([a], tr)
    expect(result.split).toBe(1)
    expect(result.records).toHaveLength(2)
    const [before, after] = result.records
    expect(before.id).not.toBe(a.id)
    expect(after.id).not.toBe(a.id)
    expect(before.id).not.toBe(after.id)
    expect(textAt(tr.doc, before)).toBe('rewritten')
    expect(before.content).toBe('rewritten')
    expect(textAt(tr.doc, after)).toBe(' text.')
    expect(after.content).toBe(' text.')
  })

  it('keeps one detached copy under the original id when both remnants collapse', () => {
    const doc = docOf(PROBE)
    const a = record(doc, 'rewritten')
    const state = EditorState.create({ doc })
    // Replace the whole word plus its neighbours: the insertion sits inside
    // the record's range in the pre-step coordinates, both halves vanish.
    const { from, to } = rangeOf(doc, 'rewritten')
    const tr = state.tr.insertText('Q', from + 3).delete(from, to + 1)
    const result = mapRecords([a], tr)
    expect(result.records).toHaveLength(1)
    expect(result.records[0].id).toBe(a.id)
    expect(result.records[0].detached).toBe(true)
    expect(result.detached).toHaveLength(1)
  })

  it('detaches a record whose range collapses and leaves detached records untouched', () => {
    const doc = docOf(PROBE)
    const a = record(doc, 'rewritten text.')
    const gone = record(doc, 'Second', { detached: true, from: 999, to: 1200 })
    const state = EditorState.create({ doc })
    const tr = state.tr.delete(a.from, a.to)
    const result = mapRecords([a, gone], tr)
    expect(result.records[0].detached).toBe(true)
    expect(result.records[0].from).toBe(a.from)
    expect(result.records[1]).toBe(gone)
    expect(result.detached.map((d) => d.id)).toEqual([a.id])
  })

  it('moves a zero-width deletion marker and never detaches it', () => {
    const doc = docOf(PROBE)
    const at = rangeOf(doc, 'Some').from
    const marker = record(doc, 'Some', { type: 'deletion', from: at, to: at, content: 'deleted', anchorText: undefined })
    const state = EditorState.create({ doc })
    const typed = mapRecords([marker], state.tr.insertText('new ', rangeOf(doc, 'Intro').from))
    expect(typed.records[0].from).toBe(at + 4)
    expect(typed.records[0].to).toBe(at + 4)
    expect(typed.records[0].detached).toBeUndefined()
    const around = state.tr.delete(at - 2, at + 4)
    const deleted = mapRecords([marker], around)
    expect(deleted.records[0].detached).toBeUndefined()
    expect(deleted.records[0].from).toBe(deleted.records[0].to)
  })
})

/** The document after an edit made in the editor (HTML parsing would collapse the whitespace these tests need). */
function edited(doc: PMNode, build: (tr: ReturnType<EditorState['tr']['delete']>) => void): PMNode {
  const tr = EditorState.create({ doc }).tr
  build(tr)
  return tr.doc
}

describe('reanchorRecords', () => {
  const before = docOf(PROBE)

  it('keeps a highlight on its words when a trailing space above it is normalised away', () => {
    // Six backspaces: "with words." → "with " (the trailing space survives in
    // the editor and is dropped by the markdown round trip).
    const words = rangeOf(before, 'words.')
    const typed = edited(before, (tr) => tr.delete(words.from, words.to))
    expect(textIndex(typed).text).toContain('here with \n')
    const a = record(typed, 'rewritten text.')
    const after = docOf(PROBE.replace('with words.', 'with'))
    const result = reanchorRecords([a], typed, after)
    expect(textAt(after, result.records[0])).toBe('rewritten text.')
    expect(result.moved).toHaveLength(1)
    expect(result.detached).toEqual([])
  })

  it('keeps a highlight on its words when doubled spaces above it collapse', () => {
    const typed = edited(before, (tr) => tr.insertText('  ', rangeOf(before, ' with').from))
    expect(textIndex(typed).text).toContain('here   with')
    const a = record(typed, 'rewritten text.')
    const result = reanchorRecords([a], typed, before)
    expect(textAt(before, result.records[0])).toBe('rewritten text.')
    expect(result.moved).toHaveLength(1)
  })

  it('grows around text typed inside the highlight and detaches when the text is gone', () => {
    const a = record(before, 'rewritten text.')
    const grown = docOf(PROBE.replace('rewritten text.', 'really rewritten text.'))
    const g = reanchorRecords([a], before, grown)
    expect(textAt(grown, g.records[0])).toBe('really rewritten text.')

    const gone = docOf(PROBE.replace('Some rewritten text.', 'Something else entirely.'))
    const d = reanchorRecords([a], before, gone)
    expect(d.records[0].detached).toBe(true)
    expect(d.detached).toHaveLength(1)
  })

  it('returns the same array when nothing changed and clamps a zero-width marker', () => {
    const a = record(before, 'rewritten text.')
    const same = reanchorRecords([a], before, before)
    expect(same.records[0]).toBe(a)
    const marker: AIAnnotation = { ...a, id: 'm', type: 'deletion', from: 500, to: 500, anchorText: undefined }
    const shorter = docOf('<p>Tiny.</p>')
    const r = reanchorRecords([marker], before, shorter)
    expect(r.records[0].from).toBe(shorter.content.size)
    expect(r.records[0].detached).toBeUndefined()
  })
})

describe('loadRecords', () => {
  const doc = docOf(PROBE)

  it('keeps a row whose anchor text sits at its range, moves one whose text shifted, detaches one whose text is gone', () => {
    const kept = record(doc, 'rewritten text.')
    const shifted = { ...record(doc, 'Second paragraph.'), from: 5, to: 22 }
    const gone = { ...record(doc, 'Intro'), anchorText: 'nowhere to be found' }
    const result = loadRecords([kept, shifted, gone], doc, 'doc')
    expect(result.records[0]).toBe(kept)
    expect(textAt(doc, result.records[1])).toBe('Second paragraph.')
    expect(result.moved.map((m) => m.id)).toEqual([shifted.id])
    expect(result.records[2].detached).toBe(true)
    expect(result.detached.map((d) => d.id)).toEqual([gone.id])
  })

  it('fills a legacy row from the document, detaches one out of bounds, and restamps the id', () => {
    const legacy = { ...record(doc, 'rewritten text.'), anchorText: undefined, documentId: 'old' }
    const outside = { ...record(doc, 'Second'), anchorText: undefined, from: 400, to: 410, documentId: 'old' }
    const result = loadRecords([legacy, outside], doc, 'doc')
    expect(result.filled).toBe(1)
    expect(result.records[0].anchorText).toBe('rewritten text.')
    expect(result.records[0].documentId).toBe('doc')
    expect(result.records[1].detached).toBe(true)
    expect(result.records[1].documentId).toBe('doc')
  })

  it('keeps a zero-width deletion marker by position, clamped, and detaches any other zero-width row', () => {
    const at = rangeOf(doc, 'Some').from
    const marker = record(doc, 'Some', { type: 'deletion', from: at, to: at, anchorText: undefined })
    const far = { ...marker, id: 'far', from: 900, to: 900 }
    const empty = { ...marker, id: 'empty', type: 'insertion' as const }
    const result = loadRecords([marker, far, empty], doc, 'doc')
    expect(result.records[0]).toBe(marker)
    expect(result.records[1].from).toBe(doc.content.size)
    expect(result.records[1].detached).toBeUndefined()
    expect(result.records[2].detached).toBe(true)
  })

  it('passes detached rows through untouched', () => {
    const d = { ...record(doc, 'Intro'), detached: true, from: 1, to: 2, anchorText: 'stale' }
    const result = loadRecords([d], doc, 'doc')
    expect(result.records[0]).toBe(d)
  })
})

describe('refreshAnchors, removeRecordsInRange, restampRecords, stampAdded', () => {
  const doc = docOf(PROBE)

  it('refreshes stale anchors and returns the same array when all are current', () => {
    const a = record(doc, 'rewritten text.')
    const stale = { ...record(doc, 'Second'), anchorText: 'old' }
    expect(refreshAnchors([a], doc)).toEqual([a])
    const same = [a]
    expect(refreshAnchors(same, doc)).toBe(same)
    const refreshed = refreshAnchors([a, stale], doc)
    expect(refreshed[0]).toBe(a)
    expect(refreshed[1].anchorText).toBe('Second')
  })

  it('removes records in a range, keeping the outside parts as remnants', () => {
    const a = record(doc, 'Some rewritten text.')
    const inside = rangeOf(doc, 'rewritten')
    const out = removeRecordsInRange([a], inside.from, inside.to, doc)
    expect(out).toHaveLength(2)
    expect(textAt(doc, out[0])).toBe('Some ')
    expect(out[0].content).toBe('Some ')
    expect(textAt(doc, out[1])).toBe(' text.')
    expect(out[1].content).toBe(' text.')
    expect(out[0].id).not.toBe(a.id)
    expect(removeRecordsInRange([a], a.from, a.to, doc)).toEqual([])
    const untouched = [a]
    expect(removeRecordsInRange(untouched, 1, 2, doc)).toBe(untouched)
  })

  it('labels remnants with the text they cover when the record crosses a block boundary', () => {
    const two = docOf('<p>alpha beta</p><p>gamma delta</p>')
    const a = record(two, 'beta\ngamma')
    expect(a.content).toBe('beta\ngamma')
    // Un-mark "gamma": the remnant covers "beta" and the block boundary, and
    // says so (position-offset slicing would have given "beta\ng").
    const gamma = rangeOf(two, 'gamma')
    const [remnant] = removeRecordsInRange([a], gamma.from, gamma.to, two)
    expect(remnant.content).toBe('beta')
    expect(textAt(two, remnant)).toBe('beta\n')
    // Type inside "gamma": the two remnants are labelled by their own text.
    const state = EditorState.create({ doc: two })
    const split = mapRecords([a], state.tr.insertText('X', gamma.from + 2))
    expect(split.records.map((r) => r.content)).toEqual(['beta\nga', 'mma'])
  })

  it('restamps only when an id differs', () => {
    const a = record(doc, 'Intro')
    const list = [a]
    expect(restampRecords(list, 'doc')).toBe(list)
    const re = restampRecords(list, 'other')
    expect(re[0].documentId).toBe('other')
    expect(re[0]).not.toBe(a)
  })

  it('stamps added records with the document id, the anchor text and clamped positions', () => {
    const { from, to } = rangeOf(doc, 'rewritten')
    const input: AIAnnotation = {
      id: 'n',
      documentId: '',
      type: 'insertion',
      createdAt: 2,
      from,
      to: to + 10_000,
      content: 'rewritten',
      provenance: { model: 'test', conversationId: 'c', messageId: 'm' }
    }
    const [stamped] = stampAdded([input], doc, 'doc')
    expect(stamped.documentId).toBe('doc')
    expect(stamped.to).toBe(doc.content.size)
    expect(stamped.anchorText).toBe(anchorTextAt(doc, from, doc.content.size))
    const [marker] = stampAdded([{ ...input, to: from, type: 'deletion' }], doc, 'doc')
    expect(marker.anchorText).toBeUndefined()
  })
})

describe('isWholeDocumentReplace', () => {
  it('recognises a replace of the whole document and nothing smaller', () => {
    const doc = docOf(PROBE)
    const state = EditorState.create({ doc })
    const whole = state.tr.replaceWith(0, doc.content.size, docOf('<p>New.</p>').content)
    expect(isWholeDocumentReplace(whole)).toBe(true)
    const partial = state.tr.insertText('x', 3)
    expect(isWholeDocumentReplace(partial)).toBe(false)
    const typedThenWhole = state.tr.insertText('x', 3)
    typedThenWhole.replaceWith(0, typedThenWhole.doc.content.size, docOf('<p>New.</p>').content)
    expect(isWholeDocumentReplace(typedThenWhole)).toBe(true)
  })
})
