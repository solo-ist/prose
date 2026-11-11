/**
 * Suggesting mode's rewrite rules (#891; design §2–§3, plan decisions 5–7),
 * one test per rule, each through the real dispatch of a headless editor built
 * from the app's own extension list.
 */

import { describe, it, expect } from 'vitest'
import { Slice, Fragment } from '@tiptap/pm/model'
import { createDocument } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { makeEditor, after, before, cursor, select, type, runs, idsOf } from './testEditor'
import { trackedChangesIn } from './changes'
import { trackedMarkTypes } from './changes'
import { reviewLogOf } from '../review-log/transactions'
import { setSuggestingIn } from './transactions'
import { flatInline } from './filter'

const AGENT = { kind: 'mcp-agent' as const, connectionId: 'c-891', connectionLabel: 'Codex laptop' }

/** An agent's pending insertion of `text` at `pos`, as `suggest_insert` makes it. */
function agentInsert(editor: Editor, pos: number, text: string, id = 'agent-1') {
  const { insert } = trackedMarkTypes(editor.schema)
  const tr = editor.state.tr.insert(pos, editor.schema.text(text, [insert.create({ id, actor: AGENT, createdAt: 1 })]))
  editor.view.dispatch(tr.setMeta('trackedSkip', true))
}

/**
 * Backspace as the view delivers it: a collapsed caret's character deletion is
 * the browser's (ProseMirror reads it back from the DOM as one delete step);
 * a selection or a block start goes through the keymap.
 */
function backspace(editor: Editor) {
  const { empty, from, $from } = editor.state.selection
  if (empty && $from.parentOffset > 0) editor.view.dispatch(editor.state.tr.delete(from - 1, from))
  else editor.commands.keyboardShortcut('Backspace')
}

function forwardDelete(editor: Editor) {
  const { from } = editor.state.selection
  editor.view.dispatch(editor.state.tr.delete(from, from + 1))
}

describe('Suggesting mode: the writer’s edits become tracked changes', () => {
  it('typed text is inserted with trackedInsert and the writer as actor; nothing else changes', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'world'))
    type(editor, ' wide')
    expect(runs(editor.state.doc)).toEqual(['Hello world[+ wide].'])
    const [change] = trackedChangesIn(editor.state.doc)
    expect(change).toMatchObject({ type: 'insertion', insertedText: ' wide', actor: { kind: 'human', self: true } })
    expect(editor.state.selection.from).toBe(after(editor, ' wide'))
  })

  it('contiguous typing in one textblock keeps one id', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'world'))
    for (const ch of ' wide') type(editor, ch)
    expect(runs(editor.state.doc)).toEqual(['Hello world[+ wide].'])
    expect(idsOf(editor.state.doc)).toHaveLength(1)
  })

  it('typing elsewhere starts a new change', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'Hello'))
    type(editor, ' there')
    cursor(editor, after(editor, 'world'))
    type(editor, '!')
    expect(idsOf(editor.state.doc)).toHaveLength(2)
  })

  it('a deletion of untracked text marks it trackedDelete and Backspace leaves the caret before it', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'world'))
    backspace(editor)
    backspace(editor)
    expect(runs(editor.state.doc)).toEqual(['Hello wor[-ld].'])
    expect(idsOf(editor.state.doc)).toHaveLength(1)
    expect(editor.state.selection.from).toBe(before(editor, 'ld'))
  })

  it('the Delete key leaves the caret after the struck text', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, before(editor, 'world'))
    forwardDelete(editor)
    expect(runs(editor.state.doc)).toEqual(['Hello [-w]orld.'])
    expect(editor.state.selection.from).toBe(before(editor, 'orld'))
  })

  it('a deletion inside your own pending insertion deletes for real (fix your own typo)', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'world'))
    type(editor, ' wied')
    backspace(editor)
    backspace(editor)
    type(editor, 'de')
    expect(runs(editor.state.doc)).toEqual(['Hello world[+ wide].'])
  })

  it('a replacement (select and type) is a deletion plus an insertion under one id, deleted text first', () => {
    const { editor } = makeEditor('Hello world.')
    select(editor, before(editor, 'world'), after(editor, 'world'))
    type(editor, 'there')
    expect(runs(editor.state.doc)).toEqual(['Hello [-world][+there].'])
    const changes = trackedChangesIn(editor.state.doc)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ type: 'edit', deletedText: 'world', insertedText: 'there' })
  })

  it('deleting text already proposed for deletion changes nothing but the caret', () => {
    const { editor } = makeEditor('Hello world.')
    const end = after(editor, 'world')
    cursor(editor, end)
    backspace(editor)
    const doc = editor.state.doc
    cursor(editor, end)
    backspace(editor)
    expect(editor.state.doc.eq(doc)).toBe(true)
    expect(editor.state.selection.from).toBe(end - 1)
  })

  it('deleting a space and typing it back leaves no change; the caret is after the space', () => {
    const { editor } = makeEditor('you just typed:')
    cursor(editor, after(editor, 'you '))
    backspace(editor)
    expect(runs(editor.state.doc)).toEqual(['you[- ]just typed:'])
    type(editor, ' ')
    expect(runs(editor.state.doc)).toEqual(['you just typed:'])
    expect(trackedChangesIn(editor.state.doc)).toEqual([])
    expect(editor.state.selection.from).toBe(after(editor, 'you '))
  })

  it('the Delete key over a space, then the same space typed, leaves no change', () => {
    const { editor } = makeEditor('you just typed:')
    cursor(editor, after(editor, 'you'))
    forwardDelete(editor)
    type(editor, ' ')
    expect(runs(editor.state.doc)).toEqual(['you just typed:'])
    expect(editor.state.selection.from).toBe(after(editor, 'you '))
  })

  it('a space typed beside an original one, then the original deleted, leaves no change', () => {
    const { editor } = makeEditor('you just typed:')
    cursor(editor, after(editor, 'you'))
    type(editor, ' ')
    expect(runs(editor.state.doc)).toEqual(['you[+ ] just typed:'])
    forwardDelete(editor)
    expect(runs(editor.state.doc)).toEqual(['you just typed:'])
    expect(trackedChangesIn(editor.state.doc)).toEqual([])
  })

  it('a word backspaced away and typed back letter by letter leaves no change', () => {
    const { editor } = makeEditor('you just typed:')
    cursor(editor, after(editor, 'just'))
    for (let i = 0; i < 4; i++) backspace(editor)
    expect(runs(editor.state.doc)).toEqual(['you [-just] typed:'])
    for (const ch of 'jus') type(editor, ch)
    expect(runs(editor.state.doc)).toEqual(['you [+jus][-just] typed:'])
    type(editor, 't')
    expect(runs(editor.state.doc)).toEqual(['you just typed:'])
    expect(editor.state.selection.from).toBe(after(editor, 'just'))
  })

  it('a selected word replaced by the same word leaves no change', () => {
    const { editor } = makeEditor('you just typed:')
    select(editor, before(editor, 'just'), after(editor, 'just'))
    type(editor, 'just')
    expect(runs(editor.state.doc)).toEqual(['you just typed:'])
    expect(trackedChangesIn(editor.state.doc)).toEqual([])
    expect(editor.state.selection.from).toBe(after(editor, 'just'))
  })

  it('only the run that cancels out goes; the rest of the change stays', () => {
    const { editor } = makeEditor('you just typed:')
    cursor(editor, after(editor, 'typed'))
    type(editor, ' it')
    cursor(editor, after(editor, 'you '))
    backspace(editor)
    type(editor, ' ')
    expect(runs(editor.state.doc)).toEqual(['you just typed[+ it]:'])
  })

  it('the same text with different formatting stays a change', () => {
    const { editor } = makeEditor('you just typed:')
    select(editor, before(editor, 'just'), after(editor, 'just'))
    const { from, to } = editor.state.selection
    editor.view.dispatch(editor.state.tr.replaceWith(from, to, editor.schema.text('just', [editor.schema.marks.bold.create()])))
    expect(runs(editor.state.doc)).toEqual(['you [-just][+just] typed:'])
  })

  it('a deletion across another actor’s pending insertion rejects that whole change, decided by the writer', () => {
    const { editor } = makeEditor('Hello world.')
    agentInsert(editor, after(editor, 'Hello'), ' brave new')
    expect(runs(editor.state.doc)).toEqual(['Hello[+ brave new] world.'])
    // The writer deletes "new world" — across the end of the agent's insertion.
    select(editor, before(editor, 'new'), after(editor, 'world'))
    backspace(editor)
    // "new" was the agent's: gone with the rest of its change; " world" is struck.
    expect(runs(editor.state.doc)).toEqual(['Hello[- world].'])
    const row = reviewLogOf(editor.state).suggestions.find((s) => s.id === 'agent-1')
    expect(row).toMatchObject({ status: 'rejected', decidedBy: { kind: 'human', self: true } })
  })

  it('the writer typing next to an agent’s insertion starts the writer’s own change', () => {
    const { editor } = makeEditor('Hello world.')
    agentInsert(editor, after(editor, 'Hello'), ' brave')
    cursor(editor, after(editor, 'brave'))
    type(editor, '!')
    const changes = trackedChangesIn(editor.state.doc)
    expect(changes.map((c) => [c.insertedText, c.actor.kind])).toEqual([[' brave', 'mcp-agent'], ['!', 'human']])
  })

  it('a flat paste is tracked; its formatting is kept', () => {
    const { editor } = makeEditor('Hello world.')
    const html = (editor.storage.markdown as { parser: { parse: (s: string) => string } }).parser.parse('**bold** move')
    const pasted = createDocument(html, editor.schema)
    cursor(editor, after(editor, 'Hello'))
    editor.view.dispatch(editor.state.tr.replaceSelection(new Slice(pasted.content, 1, 1)).setMeta('uiEvent', 'paste'))
    expect(runs(editor.state.doc)).toEqual(['Hello[+bold][+ move] world.'])
    let bold = false
    editor.state.doc.descendants((n) => {
      if (n.isText && n.text === 'bold' && n.marks.some((m) => m.type.name === 'bold')) bold = true
    })
    expect(bold).toBe(true)
  })

  it('a paste of two paragraphs is refused and nothing changes', () => {
    const { editor, refusals } = makeEditor('Hello world.')
    const html = (editor.storage.markdown as { parser: { parse: (s: string) => string } }).parser.parse('one\n\ntwo')
    const pasted = createDocument(html, editor.schema)
    const doc = editor.state.doc
    cursor(editor, after(editor, 'Hello'))
    editor.view.dispatch(editor.state.tr.replaceSelection(new Slice(pasted.content, 1, 1)).setMeta('uiEvent', 'paste'))
    expect(editor.state.doc.eq(doc)).toBe(true)
    expect(refusals).toEqual(['structure'])
  })

  it('Enter (a new block boundary) is refused, not applied untracked', () => {
    const { editor, refusals } = makeEditor('One.\n\nTwo.')
    const doc = editor.state.doc
    cursor(editor, after(editor, 'One.'))
    editor.commands.keyboardShortcut('Enter')
    expect(editor.state.doc.eq(doc)).toBe(true)
    expect(refusals).toEqual(['structure'])
  })

  it('Backspace at the start of a paragraph (a join) is refused', () => {
    const { editor, refusals } = makeEditor('One.\n\nTwo.')
    const doc = editor.state.doc
    cursor(editor, before(editor, 'Two.'))
    backspace(editor)
    expect(editor.state.doc.eq(doc)).toBe(true)
    expect(refusals).toEqual(['structure'])
  })

  it('a deletion across two paragraphs is refused', () => {
    const { editor, refusals } = makeEditor('One.\n\nTwo.')
    const doc = editor.state.doc
    select(editor, before(editor, 'ne.'), after(editor, 'Tw'))
    backspace(editor)
    expect(editor.state.doc.eq(doc)).toBe(true)
    expect(refusals).toEqual(['structure'])
  })

  it('typing in a code block is refused (code blocks hold no marks)', () => {
    const { editor, refusals } = makeEditor('```\ncode\n```')
    const doc = editor.state.doc
    cursor(editor, after(editor, 'code'))
    type(editor, 'X')
    expect(editor.state.doc.eq(doc)).toBe(true)
    expect(refusals).toEqual(['no-marks'])
  })

  it('typing in a table cell is tracked', () => {
    const { editor } = makeEditor('| a | b |\n| --- | --- |\n| c | d |')
    cursor(editor, after(editor, 'c'))
    type(editor, 'X')
    expect(runs(editor.state.doc)).toContain('c[+X]')
  })

  it('formatting applies directly (a mark step is never tracked)', () => {
    const { editor } = makeEditor('Hello world.')
    editor.chain().setTextSelection({ from: before(editor, 'Hello'), to: after(editor, 'Hello') }).toggleBold().run()
    expect(runs(editor.state.doc)).toEqual(['Hello world.'])
    expect(trackedChangesIn(editor.state.doc)).toHaveLength(0)
    let bold = false
    editor.state.doc.descendants((n) => {
      if (n.isText && n.text === 'Hello' && n.marks.some((m) => m.type.name === 'bold')) bold = true
    })
    expect(bold).toBe(true)
  })

  it('a node-type change applies directly (paragraph → heading)', () => {
    const { editor } = makeEditor('Hello world.')
    editor.chain().setTextSelection(after(editor, 'Hel')).setNode('heading', { level: 2 }).run()
    expect(editor.state.doc.firstChild!.type.name).toBe('heading')
    expect(trackedChangesIn(editor.state.doc)).toHaveLength(0)
  })

  it('undo removes a tracked insertion whole; redo brings it back tracked', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'world'))
    type(editor, ' wide')
    editor.commands.undo()
    expect(runs(editor.state.doc)).toEqual(['Hello world.'])
    editor.commands.redo()
    expect(runs(editor.state.doc)).toEqual(['Hello world[+ wide].'])
  })

  it('undo of a tracked deletion unmarks it', () => {
    const { editor } = makeEditor('Hello world.')
    cursor(editor, after(editor, 'world'))
    backspace(editor)
    editor.commands.undo()
    expect(runs(editor.state.doc)).toEqual(['Hello world.'])
  })

  it('a drag (delete at the source, insert at the target) becomes a deletion and an insertion', () => {
    const { editor } = makeEditor('Alpha beta gamma.')
    const from = before(editor, 'beta ')
    const to = after(editor, 'beta ')
    const slice = editor.state.doc.slice(from, to)
    const tr = editor.state.tr.delete(from, to)
    const target = tr.mapping.map(after(editor, 'gamma'))
    tr.replace(target, target, slice).setMeta('uiEvent', 'drop')
    editor.view.dispatch(tr)
    expect(runs(editor.state.doc)).toEqual(['Alpha [-beta ]gamma[+beta ].'])
  })

  it('with Suggesting off, typing is direct', () => {
    const { editor } = makeEditor('Hello world.', { suggesting: false })
    cursor(editor, after(editor, 'world'))
    type(editor, '!')
    expect(runs(editor.state.doc)).toEqual(['Hello world!.'])
  })

  it('turning Suggesting off and on is history-free and per state', () => {
    const { editor } = makeEditor('Hello world.')
    editor.view.dispatch(setSuggestingIn(editor.state.tr, false))
    cursor(editor, after(editor, 'world'))
    type(editor, '!')
    expect(runs(editor.state.doc)).toEqual(['Hello world!.'])
    editor.commands.undo()
    expect(runs(editor.state.doc)).toEqual(['Hello world.'])
  })
})

describe('flatInline', () => {
  it('takes a flat inline slice, a textblock open on both sides, and refuses structure', () => {
    const { editor } = makeEditor('Hello')
    const s = editor.schema
    const text = s.text('x')
    expect(flatInline(new Slice(Fragment.from(text), 0, 0))?.size).toBe(1)
    expect(flatInline(new Slice(Fragment.from(s.nodes.paragraph.create(null, text)), 1, 1))?.size).toBe(1)
    expect(flatInline(new Slice(Fragment.from([s.nodes.paragraph.create(null, text), s.nodes.paragraph.create(null, text)]), 1, 1))).toBeNull()
    expect(flatInline(new Slice(Fragment.from(s.nodes.paragraph.create(null, text)), 0, 0))).toBeNull()
    const li = s.nodes.listItem.create(null, s.nodes.paragraph.create(null, text))
    expect(flatInline(new Slice(Fragment.from(s.nodes.bulletList.create(null, li)), 3, 3))?.size).toBe(1)
  })
})
