/**
 * Unit tests for the comment threads plugin's `apply` (#1147): a thread
 * enters a state only through its own transaction, deleting a comment's
 * text resolves it and records a share push, an AI replacement leaves it
 * anchor-lost without a push, a mark that comes back reopens the thread, a
 * reload and a merge only reconcile, and the commands change thread and
 * marks in one transaction. A headless TipTap editor built from the app's
 * own extension list supplies the schema, the history plugin and the view.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Editor, createDocument } from '@tiptap/core'
import { createEditorExtensions } from '../../components/editor/extensions'
import { IDENTITY_META, RELOAD_META } from '../../document/identity'
import { AI_REPLACEMENT_META } from './plugin'
import { applyCommentMarks } from './extension'
import type { CommentData } from './types'
import {
  loadThreadsInto,
  mergeThreadsInto,
  threadPluginState,
  threadsOf,
  updateThreadIn
} from './transactions'

const DOC = '<h1>Probe</h1><p>Intro paragraph here with words.</p><p>Some rewritten text.</p><p>Second paragraph.</p>'

let editor: Editor

beforeEach(() => {
  editor = new Editor({ extensions: createEditorExtensions(), content: DOC })
  editor.view.dispatch(
    editor.state.tr.setMeta(IDENTITY_META, { documentId: 'doc', path: '/doc.md', plain: false }).setMeta('addToHistory', false)
  )
})

function rangeOf(needle: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isTextblock) return
    const i = node.textContent.indexOf(needle)
    if (i !== -1) found = { from: pos + 1 + i, to: pos + 1 + i + needle.length }
  })
  if (!found) throw new Error(`"${needle}" not in document`)
  return found
}

function comment(needle: string, id: string): CommentData {
  const { from, to } = rangeOf(needle)
  editor.chain().setTextSelection({ from, to }).setComment({ id, comment: `thread ${id}` }).run()
  const thread = threadsOf(editor.state).find((c) => c.id === id)
  if (!thread) throw new Error('thread not added')
  return thread
}

function markIds(): string[] {
  return [...(threadPluginState(editor.state)?.marks.keys() ?? [])].sort()
}

function stored(id: string, markedText: string, extra: Partial<CommentData> = {}): CommentData {
  return { id, markedText, comment: `thread ${id}`, createdAt: 1, occurrenceIndex: 0, from: 0, to: 0, replies: [], resolved: false, ...extra }
}

describe('setComment', () => {
  it('adds the thread in the mark\'s own transaction, anchored, urgent, with a thread push', () => {
    const before = threadPluginState(editor.state)!
    const thread = comment('rewritten text', 'c1')
    const after = threadPluginState(editor.state)!
    expect(thread).toMatchObject({ markedText: 'rewritten text', author: 'user', occurrenceIndex: 0, replies: [], resolved: false })
    expect(thread.anchorLost).toBeFalsy()
    expect(markIds()).toEqual(['c1'])
    expect(after.revision).toBe(before.revision + 1)
    expect(after.urgentRevision).toBe(after.revision)
    expect(after.pushes).toEqual([{ kind: 'thread', threadId: 'c1' }])
    expect(after.pushRevision).toBe(before.pushRevision + 1)
    expect(editor.view.dom.querySelectorAll('.comment-mark--pending').length).toBe(1)
  })
})

describe('edits', () => {
  it('keeps the thread reference while typing elsewhere, and records no push', () => {
    comment('rewritten text', 'c1')
    const before = threadPluginState(editor.state)!
    editor.commands.insertContentAt(rangeOf('Second paragraph.').to, ' more')
    const after = threadPluginState(editor.state)!
    expect(after.threads).toBe(before.threads)
    expect(after.revision).toBe(before.revision)
    expect(after.pushRevision).toBe(before.pushRevision)
  })

  it('resolves a thread whose text is deleted and records a resolve push; undo reopens it', () => {
    comment('rewritten text', 'c1')
    const before = threadPluginState(editor.state)!
    const { from, to } = rangeOf('rewritten text')
    editor.commands.deleteRange({ from, to })
    const resolved = threadPluginState(editor.state)!
    expect(resolved.threads[0]).toMatchObject({ id: 'c1', resolved: true })
    expect(resolved.urgentRevision).toBe(resolved.revision)
    expect(resolved.pushes).toEqual([{ kind: 'resolve', threadId: 'c1' }])
    expect(resolved.pushRevision).toBe(before.pushRevision + 1)

    expect(editor.commands.undo()).toBe(true)
    const reopened = threadPluginState(editor.state)!
    expect(reopened.threads[0]).toMatchObject({ id: 'c1', resolved: false, anchorLost: false })
    expect(markIds()).toEqual(['c1'])
    expect(reopened.pushes).toEqual([{ kind: 'resolve', threadId: 'c1' }])
  })

  it('leaves a thread open as anchor-lost under an AI replacement, with no push', () => {
    comment('rewritten text', 'c1')
    const before = threadPluginState(editor.state)!
    const { from, to } = rangeOf('Some rewritten text.')
    editor.view.dispatch(
      editor.state.tr.replaceWith(from, to, editor.schema.text('Brand new words.')).setMeta(AI_REPLACEMENT_META, true)
    )
    const after = threadPluginState(editor.state)!
    expect(after.threads[0]).toMatchObject({ id: 'c1', resolved: false, anchorLost: true })
    expect(after.urgentRevision).toBe(after.revision)
    expect(after.pushRevision).toBe(before.pushRevision)
    expect(editor.view.dom.querySelectorAll('.comment-mark').length).toBe(0)
  })

  it('keeps the recorded pushes across an appended transaction in the same apply (#1152)', () => {
    // The editor's blocks carry no ids yet (the session's normalise step gives
    // them in the app), so the first document change makes the node-ids
    // plugin append a transaction after the one that added the thread.
    const before = threadPluginState(editor.state)!
    comment('rewritten text', 'c1')
    const after = threadPluginState(editor.state)!
    expect(after.pushes).toEqual([{ kind: 'thread', threadId: 'c1' }])
    expect(after.pushRevision).toBe(before.pushRevision + 1)
    // A later unrelated change (with ids in place) keeps them too: the
    // session reads them once per revision.
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>Tail.</p>')
    const later = threadPluginState(editor.state)!
    expect(later.pushes).toEqual([{ kind: 'thread', threadId: 'c1' }])
    expect(later.pushRevision).toBe(after.pushRevision)
  })

  it('adopts a pasted mark that has no thread', () => {
    const pasted = createDocument('<p>x <span data-comment-id="p1" data-comment="pasted note" data-comment-created="5">pasted words</span></p>', editor.schema)
    editor.view.dispatch(editor.state.tr.replaceWith(rangeOf('Second paragraph.').to, rangeOf('Second paragraph.').to, pasted.firstChild!.content))
    const thread = threadsOf(editor.state).find((c) => c.id === 'p1')
    expect(thread).toMatchObject({ markedText: 'pasted words', comment: 'pasted note', createdAt: 5, resolved: false })
    expect(threadPluginState(editor.state)!.pushes).toEqual([{ kind: 'thread', threadId: 'p1' }])
  })
})

describe('commands', () => {
  it('resolveThread resolves and unmarks in one transaction; reopenThread puts the mark back on its text', () => {
    comment('rewritten text', 'c1')
    expect(editor.commands.resolveThread('c1')).toBe(true)
    let state = threadPluginState(editor.state)!
    expect(state.threads[0].resolved).toBe(true)
    expect(markIds()).toEqual([])
    expect(state.pushes).toEqual([{ kind: 'resolve', threadId: 'c1' }])

    expect(editor.commands.reopenThread('c1')).toBe(true)
    state = threadPluginState(editor.state)!
    expect(state.threads[0].resolved).toBe(false)
    expect(state.threads[0].anchorLost).toBeFalsy()
    expect(markIds()).toEqual(['c1'])
    const span = state.marks.get('c1')!
    expect(editor.state.doc.textBetween(span.from, span.to)).toBe('rewritten text')
    expect(state.pushes).toEqual([{ kind: 'resolve', threadId: 'c1' }])
    expect(editor.commands.resolveThread('nope')).toBe(false)
  })

  it('replyToThread appends and records a reply push; a quiet update records none', () => {
    comment('rewritten text', 'c1')
    const reply = { id: 'r1', author: 'user' as const, text: 'hello', createdAt: 2 }
    expect(editor.commands.replyToThread('c1', reply)).toBe(true)
    let state = threadPluginState(editor.state)!
    expect(state.threads[0].replies).toEqual([reply])
    expect(state.pushes).toEqual([{ kind: 'reply', threadId: 'c1', replyId: 'r1' }])
    // A reply means the thread is no longer pending.
    expect(editor.view.dom.querySelectorAll('.comment-mark--pending').length).toBe(0)

    const pushRevision = state.pushRevision
    editor.view.dispatch(updateThreadIn(editor.state.tr, 'c1', { shareId: 'srv-1' }, { quiet: true }))
    state = threadPluginState(editor.state)!
    expect(state.threads[0].shareId).toBe('srv-1')
    expect(state.urgentRevision).toBe(state.revision)
    // No new push: the revision stands and the previous pushes are carried
    // (the session reads them once per revision).
    expect(state.pushRevision).toBe(pushRevision)
    expect(state.pushes).toEqual([{ kind: 'reply', threadId: 'c1', replyId: state.threads[0].replies[0].id }])
  })

  it('removeThread drops thread and marks without resolving; push: false records nothing', () => {
    comment('rewritten text', 'c1')
    comment('Second paragraph', 'c2')
    expect(editor.commands.removeThread('c1')).toBe(true)
    let state = threadPluginState(editor.state)!
    expect(state.threads.map((c) => c.id)).toEqual(['c2'])
    expect(markIds()).toEqual(['c2'])
    expect(state.pushes).toEqual([{ kind: 'remove', thread: expect.objectContaining({ id: 'c1' }) }])

    const pushRevision = state.pushRevision
    expect(editor.commands.removeThread('c2', { push: false })).toBe(true)
    state = threadPluginState(editor.state)!
    expect(state.threads).toEqual([])
    expect(markIds()).toEqual([])
    expect(state.pushRevision).toBe(pushRevision)
  })
})

describe('load, merge and reload', () => {
  function reparsed(html: string) {
    return createDocument(html, editor.schema)
  }

  it('a seed loads threads with anchorLost from the marks that landed, not urgent, no pushes', () => {
    const rows = [stored('kept', 'rewritten text'), stored('gone', 'nowhere at all'), stored('done', 'Second paragraph', { resolved: true })]
    const tr = editor.state.tr.setMeta('addToHistory', false)
    loadThreadsInto(tr, rows)
    applyCommentMarks(tr, rows)
    editor.view.dispatch(tr)
    const state = threadPluginState(editor.state)!
    expect(state.threads.map((c) => [c.id, c.anchorLost === true, c.resolved === true])).toEqual([
      ['kept', false, false],
      ['gone', true, false],
      ['done', false, true]
    ])
    expect(markIds()).toEqual(['kept'])
    expect(state.revision).toBe(1)
    expect(state.urgentRevision).toBe(0)
    expect(state.pushRevision).toBe(0)
  })

  it('a merge replaces the set, marks the new open threads, unmarks a tombstone, and pushes nothing', () => {
    comment('rewritten text', 'c1')
    const pulled = stored('srv', 'Second paragraph', { shareId: 'srv', anchorLost: true, authorName: 'Reviewer' })
    // The merge dropped c1 (a tombstone) and brought srv.
    const merged = [pulled]
    const tr = editor.state.tr.setMeta('addToHistory', false)
    const present = threadPluginState(editor.state)!.marks
    for (const span of present.values()) {
      if (!merged.some((c) => c.id === span.id)) for (const r of span.spans) tr.removeMark(r.from, r.to, editor.schema.marks.comment)
    }
    applyCommentMarks(tr, merged.filter((c) => !c.resolved && !present.has(c.id)))
    mergeThreadsInto(tr, merged)
    const pushRevision = threadPluginState(editor.state)!.pushRevision
    editor.view.dispatch(tr)
    const state = threadPluginState(editor.state)!
    expect(state.threads.map((c) => c.id)).toEqual(['srv'])
    expect(state.threads[0].anchorLost).toBe(false)
    expect(markIds()).toEqual(['srv'])
    expect(state.urgentRevision).toBe(state.revision)
    expect(state.pushRevision).toBe(pushRevision)
  })

  it('a reload re-anchors by text and only reconciles: a thread whose text is gone is anchor-lost, not resolved', () => {
    comment('rewritten text', 'c1')
    comment('Second paragraph', 'c2')
    const pushRevision = threadPluginState(editor.state)!.pushRevision
    const next = reparsed(DOC.replace('Some rewritten text.', 'Nothing like it.'))
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content).setMeta(RELOAD_META, true)
    applyCommentMarks(tr, [...threadsOf(editor.state)])
    editor.view.dispatch(tr)
    const state = threadPluginState(editor.state)!
    expect(state.threads.find((c) => c.id === 'c1')).toMatchObject({ resolved: false, anchorLost: true })
    expect(state.threads.find((c) => c.id === 'c2')).toMatchObject({ resolved: false })
    expect(state.threads.find((c) => c.id === 'c2')!.anchorLost).toBeFalsy()
    expect(markIds()).toEqual(['c2'])
    expect(state.pushRevision).toBe(pushRevision)
    expect(editor.view.dom.querySelectorAll('.comment-mark--pending').length).toBe(1)
  })
})
