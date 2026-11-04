/**
 * The find bar's matches follow the document (#1106): the plugin re-scans on
 * every edit and keeps the current match by position. The editor is the app's
 * own extension list.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'
import { findMatches, searchStateOf } from './index'

let editor: Editor

beforeEach(() => {
  editor = new Editor({
    extensions: createEditorExtensions(),
    content: '<p>needle one</p><p>needle two</p><p>needle three</p>'
  })
})

afterEach(() => {
  editor.destroy()
})

/** The text under each match, in order. */
function matchTexts(): string[] {
  const state = searchStateOf(editor.state)!
  return state.results.map((r) => editor.state.doc.textBetween(r.from, r.to))
}

/** The text under each painted decoration, in order. */
function decorationTexts(): string[] {
  const state = searchStateOf(editor.state)!
  return state.decorationSet
    .find()
    .map((d) => editor.state.doc.textBetween(d.from, d.to))
}

function current(): string | null {
  const state = searchStateOf(editor.state)!
  const match = state.results[state.currentIndex]
  return match ? editor.state.doc.textBetween(match.from, match.to) : null
}

describe('search highlight (#1106)', () => {
  it('finds every occurrence, case-insensitively, and makes the first current', () => {
    editor.commands.setSearchTerm('NEEDLE')
    expect(matchTexts()).toEqual(['needle', 'needle', 'needle'])
    expect(decorationTexts()).toEqual(['needle', 'needle', 'needle'])
    expect(searchStateOf(editor.state)!.currentIndex).toBe(0)
  })

  it('keeps the highlights on their text when text is typed above them', () => {
    editor.commands.setSearchTerm('needle')
    editor.commands.insertContentAt(1, 'Intro words. ')
    expect(matchTexts()).toEqual(['needle', 'needle', 'needle'])
    expect(decorationTexts()).toEqual(['needle', 'needle', 'needle'])
    expect(searchStateOf(editor.state)!.currentIndex).toBe(0)
  })

  it('drops a match that is deleted and keeps the index on the nearest remaining match', () => {
    editor.commands.setSearchTerm('needle')
    editor.commands.setSearchIndex(1)
    expect(current()).toBe('needle')
    // Delete the second paragraph, the current match.
    const second = editor.state.doc.child(1)
    const from = editor.state.doc.child(0).nodeSize
    editor.commands.deleteRange({ from, to: from + second.nodeSize })
    const state = searchStateOf(editor.state)!
    expect(state.results).toHaveLength(2)
    expect(state.currentIndex).toBe(1)
    expect(matchTexts()).toEqual(['needle', 'needle'])
  })

  it('adds a match that is typed in', () => {
    editor.commands.setSearchTerm('needle')
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' and a fourth needle')
    expect(matchTexts()).toHaveLength(4)
  })

  it('finds a match that spans a mark boundary', () => {
    editor.destroy()
    editor = new Editor({
      extensions: createEditorExtensions(),
      content: '<p>a nee<strong>dle</strong> here</p>'
    })
    editor.commands.setSearchTerm('needle')
    expect(matchTexts()).toEqual(['needle'])
    expect(findMatches(editor.state.doc, 'dle h')).toHaveLength(1)
  })

  it('wraps the index in both directions', () => {
    editor.commands.setSearchTerm('needle')
    editor.commands.setSearchIndex(3)
    expect(searchStateOf(editor.state)!.currentIndex).toBe(0)
    editor.commands.setSearchIndex(-1)
    expect(searchStateOf(editor.state)!.currentIndex).toBe(2)
  })

  it('clears to an empty state, and an empty term clears too', () => {
    editor.commands.setSearchTerm('needle')
    editor.commands.clearSearchHighlight()
    expect(searchStateOf(editor.state)).toMatchObject({ term: '', results: [], currentIndex: -1 })
    editor.commands.setSearchTerm('needle')
    editor.commands.setSearchTerm('')
    expect(searchStateOf(editor.state)!.results).toHaveLength(0)
  })

  it('returns the same state object for a transaction that changes nothing it cares about', () => {
    editor.commands.setSearchTerm('needle')
    const before = searchStateOf(editor.state)
    editor.commands.setTextSelection(3)
    expect(searchStateOf(editor.state)).toBe(before)
  })
})
