/**
 * Pure transitions of the comment thread set (#1147): the mark scan, the
 * metas, the two reconcile modes and the push diff.
 */

import { describe, it, expect } from 'vitest'
import { Editor, createDocument } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { createEditorExtensions } from '../../components/editor/extensions'
import type { CommentData } from './types'
import { EMPTY_MARKS } from './transactions'
import {
  applyThreadMetas,
  diffPushes,
  marksEqual,
  reconcileThreads,
  scanMarks,
  transactionInsertsCommentMarks
} from './threads'

// Module scope: the describe blocks build their fixtures at collection time.
const editor: Editor = new Editor({ extensions: createEditorExtensions(), content: '' })

function doc(html: string): PMNode {
  return createDocument(html, editor.schema)
}

function span(id: string, text: string, comment = `about ${id}`): string {
  return `<span data-comment-id="${id}" data-comment="${comment}" data-comment-created="1000">${text}</span>`
}

function thread(id: string, extra: Partial<CommentData> = {}): CommentData {
  return {
    id,
    markedText: id,
    comment: `about ${id}`,
    createdAt: 1000,
    from: 0,
    to: 0,
    replies: [],
    resolved: false,
    ...extra
  }
}

describe('scanMarks', () => {
  it('collects every text node of a mark and its aggregate range', () => {
    const d = doc(`<p>One ${span('a', 'alpha')} two ${span('b', 'be <strong>bold</strong> ta')}.</p>`)
    const marks = scanMarks(d)
    expect([...marks.keys()].sort()).toEqual(['a', 'b'])
    const b = marks.get('b')!
    expect(b.spans).toHaveLength(3)
    expect(d.textBetween(b.from, b.to)).toBe('be bold ta')
    expect(marks.get('a')!.comment).toBe('about a')
    expect(marks.get('a')!.createdAt).toBe(1000)
  })

  it('returns the shared empty map for a document without marks', () => {
    expect(scanMarks(doc('<p>plain</p>'))).toBe(EMPTY_MARKS)
  })

  it('compares scans by ids and spans', () => {
    const d = doc(`<p>${span('a', 'alpha')}</p>`)
    expect(marksEqual(scanMarks(d), scanMarks(d))).toBe(true)
    expect(marksEqual(scanMarks(d), scanMarks(doc(`<p>x ${span('a', 'alpha')}</p>`)))).toBe(false)
    expect(marksEqual(scanMarks(d), EMPTY_MARKS)).toBe(false)
  })
})

describe('transactionInsertsCommentMarks', () => {
  it('sees a pasted slice with a mark and an addMark, not plain typing', () => {
    editor.commands.setContent('<p>Hello</p>')
    const state = editor.state
    expect(transactionInsertsCommentMarks(state.tr.insertText('x', 1))).toBe(false)
    const commented = doc(`<p>${span('p', 'pasted')}</p>`)
    expect(transactionInsertsCommentMarks(state.tr.replaceWith(1, 1, commented.firstChild!.content))).toBe(true)
    const mark = state.schema.marks.comment.create({ id: 'm', comment: 'c', createdAt: 1 })
    expect(transactionInsertsCommentMarks(state.tr.addMark(1, 3, mark))).toBe(true)
  })
})

describe('applyThreadMetas', () => {
  const base = [thread('a'), thread('b')]

  it('load and merge replace the set; add appends and supersedes; remove drops', () => {
    expect(applyThreadMetas(base, { load: [thread('z')] }).map((c) => c.id)).toEqual(['z'])
    expect(applyThreadMetas(base, { merge: [thread('a'), thread('c')] }).map((c) => c.id)).toEqual(['a', 'c'])
    const added = applyThreadMetas(base, { add: [thread('b', { comment: 'again' }), thread('c')] })
    expect(added.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(added[1].comment).toBe('again')
    expect(applyThreadMetas(base, { remove: ['a'] }).map((c) => c.id)).toEqual(['b'])
    expect(applyThreadMetas(base, { remove: ['nope'] })).toBe(base)
  })

  it('update keeps the reference when the patch changes nothing', () => {
    expect(applyThreadMetas(base, { update: [{ id: 'a', patch: { resolved: false } }] })).toBe(base)
    expect(applyThreadMetas(base, { update: [{ id: 'nope', patch: { resolved: true } }] })).toBe(base)
    const next = applyThreadMetas(base, { update: [{ id: 'a', patch: { resolved: true } }] })
    expect(next).not.toBe(base)
    expect(next[0].resolved).toBe(true)
    expect(next[1]).toBe(base[1])
  })
})

describe('reconcileThreads', () => {
  const marked = doc(`<p>Intro ${span('a', 'alpha')} and ${span('b', 'beta')}.</p>`)
  const withoutB = doc(`<p>Intro ${span('a', 'alpha')} and .</p>`)
  const both = scanMarks(marked)
  const onlyA = scanMarks(withoutB)

  it('edit mode: a mark that vanished resolves its thread, or goes anchor-lost under an AI replacement', () => {
    const threads = [thread('a'), thread('b')]
    const edit = reconcileThreads(threads, both, onlyA, 'edit', false, withoutB)
    expect(edit.resolved).toEqual(['b'])
    expect(edit.threads[1].resolved).toBe(true)
    expect(edit.threads[0]).toBe(threads[0])
    const ai = reconcileThreads(threads, both, onlyA, 'edit', true, withoutB)
    expect(ai.lost).toEqual(['b'])
    expect(ai.threads[1]).toMatchObject({ resolved: false, anchorLost: true })
  })

  it('reconcile mode: a missing mark only marks the thread anchor-lost', () => {
    const threads = [thread('a'), thread('b')]
    const out = reconcileThreads(threads, both, onlyA, 'reconcile', false, withoutB)
    expect(out.resolved).toEqual([])
    expect(out.lost).toEqual(['b'])
    expect(out.threads[1]).toMatchObject({ resolved: false, anchorLost: true })
    // Already anchor-lost: nothing to do, same reference.
    const again = reconcileThreads(out.threads, onlyA, onlyA, 'reconcile', false, withoutB)
    expect(again.threads).toBe(out.threads)
  })

  it('a thread that never had a mark is anchor-lost in edit mode too, never resolved', () => {
    const threads = [thread('a'), thread('ghost')]
    const out = reconcileThreads(threads, onlyA, onlyA, 'edit', false, withoutB)
    expect(out.resolved).toEqual([])
    expect(out.threads[1]).toMatchObject({ anchorLost: true, resolved: false })
  })

  it('a mark that comes back reopens a resolved thread and re-anchors a lost one', () => {
    const threads = [thread('a', { resolved: true }), thread('b', { anchorLost: true })]
    const out = reconcileThreads(threads, EMPTY_MARKS, both, 'edit', false, marked)
    expect(out.regained.sort()).toEqual(['a', 'b'])
    expect(out.threads[0]).toMatchObject({ resolved: false, anchorLost: false })
    expect(out.threads[1]).toMatchObject({ anchorLost: false })
    // In reconcile mode a resolved thread keeps its state even with a mark present.
    const seed = reconcileThreads(threads, EMPTY_MARKS, both, 'reconcile', false, marked)
    expect(seed.threads[0].resolved).toBe(true)
    expect(seed.threads[1].anchorLost).toBe(false)
  })

  it('adopts a mark with no thread from its attributes', () => {
    const d = doc(`<p>alpha ${span('a', 'alpha')} alpha</p>`)
    const out = reconcileThreads([], EMPTY_MARKS, scanMarks(d), 'edit', false, d)
    expect(out.adopted).toEqual(['a'])
    expect(out.threads[0]).toMatchObject({
      id: 'a',
      markedText: 'alpha',
      comment: 'about a',
      createdAt: 1000,
      author: 'user',
      occurrenceIndex: 1,
      replies: [],
      resolved: false
    })
  })
})

describe('diffPushes', () => {
  it('asks for a thread push for a new local thread (with its unpushed replies), none for a pulled one', () => {
    const local = thread('a', { replies: [{ id: 'r1', author: 'user', text: 'hi', createdAt: 1 }] })
    const pulled = thread('p', { shareId: 'p' })
    expect(diffPushes([], [local, pulled])).toEqual([
      { kind: 'thread', threadId: 'a' },
      { kind: 'reply', threadId: 'a', replyId: 'r1' }
    ])
  })

  it('asks for a resolve on a toggle, a reply for a new unpushed reply, a remove with the thread', () => {
    const a = thread('a', { shareId: 's' })
    const b = thread('b')
    const resolved = { ...a, resolved: true }
    expect(diffPushes([a, b], [resolved, b])).toEqual([{ kind: 'resolve', threadId: 'a' }])
    const replied = { ...a, replies: [{ id: 'r', author: 'user' as const, text: 't', createdAt: 1 }] }
    expect(diffPushes([a, b], [replied, b])).toEqual([{ kind: 'reply', threadId: 'a', replyId: 'r' }])
    const pushedReply = { ...a, replies: [{ id: 'r', author: 'user' as const, text: 't', createdAt: 1, shareId: 'x' }] }
    expect(diffPushes([a, b], [pushedReply, b])).toEqual([])
    expect(diffPushes([a, b], [a])).toEqual([{ kind: 'remove', thread: b }])
    expect(diffPushes([a, b], [a, b])).toEqual([])
  })
})
