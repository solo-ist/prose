/**
 * The text around a change on a review card (#1295): its sentence, cut on
 * words, as the file holds it, across blocks, and the blocks around a change
 * that fills its own.
 */

import { describe, it, expect } from 'vitest'
import type { Editor } from '@tiptap/core'
import { makeEditor, after, before, cursor, select, type } from '../../extensions/tracked-changes/testEditor'
import { trackedChangesIn } from '../../extensions/tracked-changes/changes'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import { reviewContext, reviewContextOf, itemRange, clipBefore, clipAfter, CONTEXT_MAX } from './reviewContext'
import { reviewItems } from './reviewItems'

const plain = (markdown: string) => makeEditor(markdown, { suggesting: false }).editor

/** The context of the text `needle`, as if it were the change. */
function around(editor: Editor, needle: string) {
  return reviewContext(editor.state.doc, before(editor, needle), after(editor, needle))
}

function deleteSelection(editor: Editor) {
  editor.view.dispatch(editor.state.tr.deleteSelection())
}

describe('reviewContext (#1295)', () => {
  it('clips to the sentence around the change, with "…" where it cuts', () => {
    const editor = plain('First sentence here. The change sits in this one, then more. Third sentence follows.')
    expect(around(editor, 'sits')).toEqual({ before: '… The change ', after: ' in this one, then more. …' })
  })

  it('has no "…" at a block edge', () => {
    const editor = plain('Alpha beta gamma.')
    expect(around(editor, 'Alpha')).toEqual({ before: '', after: ' beta gamma.' })
    expect(around(editor, 'gamma.')).toEqual({ before: 'Alpha beta ', after: '' })
  })

  it('cuts a long sentence on a word, at most CONTEXT_MAX characters a side', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const editor = plain(`${words} CHANGE ${words}.`)
    const context = around(editor, 'CHANGE')
    expect(context.before.startsWith('… word')).toBe(true)
    expect(context.before.length).toBeLessThanOrEqual(CONTEXT_MAX + 2)
    expect(context.before.endsWith('word59 ')).toBe(true)
    expect(context.after.startsWith(' word0 word1')).toBe(true)
    expect(context.after.endsWith(' …')).toBe(true)
    expect(context.after.length).toBeLessThanOrEqual(CONTEXT_MAX + 2)
    expect(context.after).toMatch(/ word\d+ …$/)
  })

  it('reads a neighbouring tracked change as the original: its insertion left out, its deletion kept', () => {
    const { editor } = makeEditor('you just typed: hello world.')
    cursor(editor, after(editor, 'just'))
    type(editor, ' really')
    select(editor, before(editor, 'hello'), after(editor, 'hello'))
    deleteSelection(editor)
    const [insertion, deletion] = trackedChangesIn(editor.state.doc)
    expect([insertion.insertedText, deletion.deletedText]).toEqual([' really', 'hello'])
    expect(reviewContext(editor.state.doc, insertion.from, insertion.to)).toEqual({ before: 'you just', after: ' typed: hello world.' })
    expect(reviewContext(editor.state.doc, deletion.from, deletion.to)).toEqual({ before: 'you just typed: ', after: ' world.' })
  })

  it('takes a cross-block change’s lead-in from its first block and its tail from its last', () => {
    const editor = plain('One two three.\n\nFour five six.')
    expect(reviewContext(editor.state.doc, before(editor, 'two'), after(editor, 'five'))).toEqual({ before: 'One ', after: ' six.' })
  })

  it('gives a change that fills its block the nearest sentences of the blocks around it', () => {
    const editor = plain('Before it. Last of it.\n\nWhole\n\nNext first. Next second.')
    expect(around(editor, 'Whole')).toEqual({ before: '', after: '', above: '… Last of it.', below: 'Next first. …' })
  })

  it('covers an AI suggestion’s whole mark, though getAISuggestions reports its first text node', () => {
    const editor = plain('Keep this **bold** part here. Then more.')
    const from = before(editor, 'this')
    const to = after(editor, 'part')
    editor.view.dispatch(
      editor.state.tr.addMark(from, to, editor.schema.marks.aiSuggestion.create({ id: 's-1', originalText: 'this bold part', suggestedText: 'that part' }))
    )
    const [suggestion] = getAISuggestions(editor)
    expect(suggestion.to).toBeLessThan(to)
    expect(itemRange(editor.state.doc, suggestion)).toEqual({ from, to })
    const [item] = reviewItems(editor)
    expect(reviewContextOf(editor.state.doc, item)).toEqual({ before: 'Keep ', after: ' here. …' })
  })
})

describe('clipBefore / clipAfter', () => {
  it('keep a short sentence whole and mark a dropped one', () => {
    expect(clipBefore('Short one ')).toBe('Short one ')
    expect(clipBefore('Earlier. Short one ')).toBe('… Short one ')
    expect(clipAfter(' ends here.')).toBe(' ends here.')
    expect(clipAfter(' ends here. And more.')).toBe(' ends here. …')
  })

  it('does not split a sentence on a decimal point', () => {
    expect(clipAfter(' grew 3.5 percent. Next.')).toBe(' grew 3.5 percent. …')
  })
})
