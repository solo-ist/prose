/**
 * The CodeMirror state a session keeps for a tab in source mode (#1150):
 * built from text as its initial document (no undo step), it survives the
 * view that shows it, and the appearance and read-only compartments are
 * reconfigured on a live view without a rebuild.
 */

import { describe, it, expect } from 'vitest'
import { EditorView } from '@codemirror/view'
import { undoDepth, undo } from '@codemirror/commands'
import {
  appearanceCompartment,
  appearanceExtensions,
  buildSourceState,
  foldAllHeadingsEffects,
  readOnlyCompartment,
  readOnlyExtension,
  sourceFolds,
  sourceSelection,
  sourceText
} from './state'

const TEXT = '# Title\n\nBody one.\n\n## Second\n\nBody two.\n'

describe('buildSourceState', () => {
  it('starts with the text as its document and no undo history', () => {
    const state = buildSourceState(TEXT)
    expect(sourceText(state)).toBe(TEXT)
    expect(undoDepth(state)).toBe(0)
    expect(sourceSelection(state)).toEqual({ anchor: 0, head: 0 })
    expect(sourceFolds(state)).toEqual([])
  })

  it('keeps selection, folds and history across the view that showed it', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const first = new EditorView({ state: buildSourceState(TEXT), parent })
    first.dispatch({ changes: { from: TEXT.length, insert: 'More.' } })
    first.dispatch({ selection: { anchor: 3 } })
    first.dispatch({ effects: foldAllHeadingsEffects(first.state) })
    const kept = first.state
    first.destroy()

    expect(sourceText(kept)).toBe(TEXT + 'More.')
    expect(sourceSelection(kept)).toEqual({ anchor: 3, head: 3 })
    expect(sourceFolds(kept).length).toBe(1)
    expect(undoDepth(kept)).toBe(1)

    const second = new EditorView({ state: kept, parent })
    expect(second.state).toBe(kept)
    expect(undo(second)).toBe(true)
    expect(sourceText(second.state)).toBe(TEXT)
    second.destroy()
    parent.remove()
  })

  it('reconfigures appearance and read-only on the live view without touching the document or history', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ state: buildSourceState(TEXT), parent })
    view.dispatch({ changes: { from: 0, insert: 'X' } })
    view.dispatch({
      effects: [
        appearanceCompartment.reconfigure(appearanceExtensions({ fontSize: 15, lineHeight: 1.6, fontFamily: 'monospace' })),
        readOnlyCompartment.reconfigure(readOnlyExtension(true))
      ]
    })
    expect(sourceText(view.state)).toBe('X' + TEXT)
    expect(undoDepth(view.state)).toBe(1)
    expect(view.state.readOnly).toBe(true)
    view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtension(false)) })
    expect(view.state.readOnly).toBe(false)
    view.destroy()
    parent.remove()
  })
})
