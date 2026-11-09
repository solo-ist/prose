/**
 * The writer's decisions on tracked changes (#891, design §2): accept and
 * reject, one and all, with the decider in the review log, the AI annotation
 * for an accepted agent insertion, and undo reopening a decision.
 */

import { describe, it, expect } from 'vitest'
import type { Editor } from '@tiptap/core'
import { makeEditor, after, before, cursor, select, type, runs } from './testEditor'
import { trackedChangesIn, trackedMarkTypes } from './changes'
import { reviewLogOf } from '../review-log/transactions'
import { annotationsOf } from '../ai-annotations/transactions'
import { TRACK_SKIP_META } from './transactions'

const AGENT = { kind: 'prose-agent' as const, provider: 'anthropic' as const, model: 'claude-opus-5-5' }

function agentInsert(editor: Editor, pos: number, text: string, id: string) {
  const { insert } = trackedMarkTypes(editor.schema)
  editor.view.dispatch(editor.state.tr.insert(pos, editor.schema.text(text, [insert.create({ id, actor: AGENT, createdAt: 1 })])).setMeta(TRACK_SKIP_META, true))
}

function agentDelete(editor: Editor, from: number, to: number, id: string) {
  const { remove } = trackedMarkTypes(editor.schema)
  editor.view.dispatch(editor.state.tr.addMark(from, to, remove.create({ id, actor: AGENT, createdAt: 1 })).setMeta(TRACK_SKIP_META, true))
}

function replacement(editor: Editor) {
  select(editor, before(editor, 'world'), after(editor, 'world'))
  type(editor, 'there')
  return trackedChangesIn(editor.state.doc)[0].id
}

describe('accepting and rejecting tracked changes', () => {
  it('accept keeps an insertion and drops a deletion, under one id', () => {
    const { editor } = makeEditor('Hello world.')
    const id = replacement(editor)
    expect(editor.commands.acceptTrackedChange(id)).toBe(true)
    expect(runs(editor.state.doc)).toEqual(['Hello there.'])
    expect(reviewLogOf(editor.state).suggestions.find((s) => s.id === id)).toMatchObject({
      status: 'accepted',
      type: 'edit',
      originalText: 'world',
      suggestedText: 'there',
      tracked: true,
      decidedBy: { kind: 'human', self: true },
    })
  })

  it('reject drops an insertion and keeps a deletion', () => {
    const { editor } = makeEditor('Hello world.')
    const id = replacement(editor)
    expect(editor.commands.rejectTrackedChange(id)).toBe(true)
    expect(runs(editor.state.doc)).toEqual(['Hello world.'])
    expect(reviewLogOf(editor.state).suggestions.find((s) => s.id === id)).toMatchObject({ status: 'rejected' })
  })

  it('accept-all and reject-all decide every change, with who decided', () => {
    const { editor } = makeEditor('One two three.')
    agentInsert(editor, after(editor, 'One'), ' and', 'a1')
    agentDelete(editor, before(editor, 'three'), after(editor, 'three'), 'a2')
    const by = { kind: 'mcp-agent' as const, connectionId: 'x', connectionLabel: 'X' }
    editor.commands.acceptAllTrackedChanges(by)
    expect(runs(editor.state.doc)).toEqual(['One and two .'])
    const rows = reviewLogOf(editor.state).suggestions
    expect(rows.map((r) => [r.id, r.status, r.decidedBy])).toEqual([
      ['a1', 'accepted', by],
      ['a2', 'accepted', by],
    ])
    editor.commands.undo()
    editor.commands.rejectAllTrackedChanges()
    expect(runs(editor.state.doc)).toEqual(['One two three.'])
  })

  it('accepting an agent’s insertion records an AI annotation with that agent; the writer’s own records none', () => {
    const { editor } = makeEditor('Hello world.')
    agentInsert(editor, after(editor, 'Hello'), ' brave', 'a1')
    cursor(editor, after(editor, 'world'))
    type(editor, '!')
    const mine = trackedChangesIn(editor.state.doc).find((c) => c.actor.kind === 'human')!.id
    editor.commands.acceptTrackedChange('a1')
    editor.commands.acceptTrackedChange(mine)
    expect(runs(editor.state.doc)).toEqual(['Hello brave world!.'])
    const annotations = annotationsOf(editor.state)
    expect(annotations).toHaveLength(1)
    expect(annotations[0]).toMatchObject({ type: 'insertion', content: ' brave', provenance: { actor: AGENT } })
    expect(editor.state.doc.textBetween(annotations[0].from, annotations[0].to)).toBe(' brave')
  })

  it('undo of a decision reopens the change in the log', () => {
    const { editor } = makeEditor('Hello world.')
    const id = replacement(editor)
    editor.commands.acceptTrackedChange(id)
    editor.commands.undo()
    expect(runs(editor.state.doc)).toEqual(['Hello [-world][+there].'])
    const log = reviewLogOf(editor.state)
    expect(log.suggestions.find((s) => s.id === id)!.status).toBe('pending')
    expect(log.events.map((e) => e.kind)).toEqual(['suggestion:proposed', 'suggestion:accepted', 'suggestion:reopened'])
  })

  it('accepting the deletion of a whole paragraph removes the paragraph', () => {
    const { editor } = makeEditor('One.\n\nTwo.\n\nThree.')
    select(editor, before(editor, 'Two.'), after(editor, 'Two.'))
    editor.commands.keyboardShortcut('Backspace')
    const id = trackedChangesIn(editor.state.doc)[0].id
    editor.commands.acceptTrackedChange(id)
    expect(runs(editor.state.doc)).toEqual(['One.', 'Three.'])
  })

  it('a pending change grows in the log as the writer types', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'world'))
    for (const ch of ' wide') type(editor, ch)
    const [row] = reviewLogOf(editor.state).suggestions
    expect(row).toMatchObject({ status: 'pending', type: 'insertion', suggestedText: ' wide' })
    expect(reviewLogOf(editor.state).events.map((e) => e.kind)).toEqual(['suggestion:proposed'])
  })

  it('feedback on a tracked change is kept in the log', () => {
    const { editor } = makeEditor('Hello world.')
    const id = replacement(editor)
    expect(editor.commands.replyToTrackedChange(id, 'Why "there"?')).toBe(true)
    expect(reviewLogOf(editor.state).suggestions[0].feedback.map((f) => f.text)).toEqual(['Why "there"?'])
  })
})
