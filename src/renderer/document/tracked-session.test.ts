/**
 * Tracked changes in the session layer (#891; design §5): the file holds the
 * original until a change is accepted. The projection is `originalOf(doc)`, so
 * suggesting leaves the tab clean and an untouched file saves byte for byte;
 * the pending changes persist as the `tracked` record kind, written only here,
 * and come back on their context at the next open, or are orphaned.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

const db = vi.hoisted(() => ({
  annotations: new Map<string, unknown>(),
  comments: new Map<string, unknown>(),
  suggestions: new Map<string, unknown>(),
  reviewLog: new Map<string, unknown>(),
  tracked: new Map<string, unknown>(),
  conversations: new Map<string, unknown>(),
  trackedWrites: [] as Array<{ id: string; count: number }>
}))

vi.mock('../lib/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/persistence')>()
  const table = (store: Map<string, unknown>, empty: unknown) => ({
    save: vi.fn(async (id: string, value: unknown) => {
      store.set(id, value)
    }),
    load: vi.fn(async (id: string) => store.get(id) ?? empty),
    remove: vi.fn(async (id: string) => {
      store.delete(id)
    })
  })
  const annotations = table(db.annotations, [])
  const comments = table(db.comments, [])
  const suggestions = table(db.suggestions, [])
  const reviewLog = table(db.reviewLog, null)
  const tracked = table(db.tracked, [])
  const conversations = table(db.conversations, [])
  return {
    ...actual,
    initDB: vi.fn(async () => {}),
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => null),
    saveConversations: conversations.save,
    loadConversations: conversations.load,
    deleteConversations: conversations.remove,
    saveAnnotations: annotations.save,
    loadAnnotations: annotations.load,
    deleteAnnotations: annotations.remove,
    saveComments: comments.save,
    loadComments: comments.load,
    deleteComments: comments.remove,
    saveSuggestions: suggestions.save,
    loadSuggestions: suggestions.load,
    deleteSuggestions: suggestions.remove,
    saveReviewLog: reviewLog.save,
    loadReviewLog: reviewLog.load,
    deleteReviewLog: reviewLog.remove,
    saveTracked: vi.fn(async (id: string, records: unknown[]) => {
      db.trackedWrites.push({ id, count: records.length })
      db.tracked.set(id, records)
    }),
    loadTracked: tracked.load,
    deleteTracked: tracked.remove
  }
})

import { createEditorExtensions } from '../components/editor/extensions'
import {
  attachEditor,
  openSession,
  activateSession,
  closeSession,
  flushActiveProjections,
  saveSnapshot,
  setSessionIdentity,
  setSessionSuggesting,
  enterSource,
  exitSource,
  setSourceState,
  getSession,
  serializeFinal,
  originalOf,
  finalOf
} from './session'
import { useTabStore, type Tab } from '../stores/tabStore'
import { trackedChangesIn } from '../extensions/tracked-changes/changes'
import { isSuggesting } from '../extensions/tracked-changes/transactions'
import { reviewLogOf } from '../extensions/review-log/transactions'
import { sourceText } from '../extensions/source/state'

let editor: Editor

function tab(id: string, documentId: string, content: string, extra: Partial<Tab> = {}): Tab {
  const record: Tab = { id, documentId, path: `/docs/${id}.md`, title: id, isDirty: false, content, frontmatter: {}, ...extra }
  useTabStore.getState().addTab(record)
  return record
}

function after(text: string): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text) + text.length
    return at === -1
  })
  if (at === -1) throw new Error(`no "${text}"`)
  return at
}

function typeAt(pos: number, text: string): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
  editor.view.dispatch(editor.state.tr.insertText(text, pos))
}

function replaceWord(word: string, by: string): void {
  const to = after(word)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, to - word.length, to)))
  editor.view.dispatch(editor.state.tr.insertText(by, to - word.length, to))
}

async function openSuggesting(id: string, documentId: string, content: string): Promise<void> {
  const t = tab(id, documentId, content, { suggesting: true })
  await openSession(t, content)
  activateSession(id)
}

beforeAll(() => {
  editor = new Editor({ extensions: createEditorExtensions(), content: '' })
  attachEditor(editor)
})

beforeEach(async () => {
  for (const id of [...useTabStore.getState().tabs.map((t) => t.id)]) await closeSession(id)
  useTabStore.setState({ tabs: [], activeTabId: null })
  for (const store of [db.annotations, db.comments, db.suggestions, db.reviewLog, db.tracked, db.conversations]) store.clear()
  db.trackedWrites.length = 0
})

describe('the file holds the original until a change is accepted', () => {
  it('suggesting leaves the projection, the tab and a save on the original', async () => {
    const content = 'Alpha beta gamma.\n\nDelta epsilon.'
    await openSuggesting('t1', 'doc-1', content)
    expect(isSuggesting(editor.state)).toBe(true)
    replaceWord('beta', 'BETA')
    typeAt(after('epsilon'), ' zeta')
    flushActiveProjections()
    const record = useTabStore.getState().getTabById('t1')!
    expect(record.content).toBe(content)
    expect(record.isDirty).toBe(false)
    expect(saveSnapshot('t1').text).toBe(content)
    expect(serializeFinal('t1')).toBe('Alpha BETA gamma.\n\nDelta epsilon zeta.')
  })

  it('an untouched file with pending changes still saves byte for byte (#1102 baseline against the original)', async () => {
    // Re-serialized, this file would change: `*` bullets and a trailing space.
    const content = '* one\n* two  \n\nPlain text here.\n'
    await openSuggesting('t2', 'doc-2', content)
    typeAt(after('Plain'), ' old')
    flushActiveProjections()
    expect(saveSnapshot('t2').text).toBe(content)
  })

  it('accepting a change dirties the tab and the save carries it', async () => {
    const content = 'Alpha beta gamma.'
    await openSuggesting('t3', 'doc-3', content)
    replaceWord('beta', 'BETA')
    const id = trackedChangesIn(editor.state.doc)[0].id
    editor.commands.acceptTrackedChange(id)
    flushActiveProjections()
    expect(useTabStore.getState().getTabById('t3')!.isDirty).toBe(true)
    expect(saveSnapshot('t3').body).toBe('Alpha BETA gamma.')
  })

  it('originalOf and finalOf are pure and leave a document without changes as it is', async () => {
    const content = 'Alpha beta gamma.'
    await openSuggesting('t4', 'doc-4', content)
    const untouched = editor.state.doc
    expect(originalOf(untouched)).toBe(untouched)
    replaceWord('beta', 'BETA')
    const doc = editor.state.doc
    expect(originalOf(doc).textContent).toBe('Alpha beta gamma.')
    expect(finalOf(doc).textContent).toBe('Alpha BETA gamma.')
    expect(editor.state.doc).toBe(doc)
  })
})

describe('the tracked record kind', () => {
  it('is written when a change appears, and written empty when the last one goes', async () => {
    await openSuggesting('t5', 'doc-5', 'Alpha beta gamma.')
    typeAt(after('gamma'), ' delta')
    expect((db.tracked.get('doc-5') as unknown[]).length).toBe(1)
    editor.commands.undo()
    flushActiveProjections()
    expect(db.tracked.get('doc-5')).toEqual([])
  })

  it('comes back on its context when the document opens again, in Suggesting mode as the tab left it', async () => {
    const content = 'Alpha beta gamma.\n\nDelta epsilon.'
    await openSuggesting('t6', 'doc-6', content)
    replaceWord('beta', 'BETA')
    typeAt(after('epsilon'), ' zeta')
    // Node ids are minted per open; everything else must come back as it was.
    const withoutIds = (json: unknown) => JSON.parse(JSON.stringify(json).replace(/"nodeId":"[^"]*"/g, '"nodeId":""'))
    const before = withoutIds(editor.state.doc.toJSON())
    await closeSession('t6')
    await openSession(useTabStore.getState().getTabById('t6')!, content)
    activateSession('t6')
    expect(withoutIds(editor.state.doc.toJSON())).toEqual(before)
    expect(isSuggesting(editor.state)).toBe(true)
    expect(reviewLogOf(editor.state).suggestions.map((s) => s.status)).toEqual(['pending', 'pending'])
  })

  it('a change whose context the file lost is orphaned: not put back, superseded in the log, dropped from the store', async () => {
    const content = 'Alpha beta gamma.\n\nDelta epsilon.'
    await openSuggesting('t7', 'doc-7', content)
    replaceWord('beta', 'BETA')
    typeAt(after('epsilon'), ' zeta')
    const [replaced, kept] = trackedChangesIn(editor.state.doc).map((c) => c.id)
    await closeSession('t7')
    const changed = 'Alpha beta, gamma!\n\nDelta epsilon.'
    await openSession(useTabStore.getState().getTabById('t7')!, changed)
    activateSession('t7')
    expect(trackedChangesIn(editor.state.doc).map((c) => c.id)).toEqual([kept])
    expect(editor.state.doc.textContent).toBe('Alpha beta, gamma!Delta epsilon zeta.')
    const log = reviewLogOf(editor.state)
    expect(log.suggestions.find((s) => s.id === replaced)).toMatchObject({ status: 'superseded', orphaned: true })
    expect(log.events.at(-1)).toMatchObject({ kind: 'suggestion:orphaned', suggestionId: replaced })
    await closeSession('t7')
    expect((db.tracked.get('doc-7') as Array<{ id: string }>).map((r) => r.id)).toEqual([kept])
  })

  it('follows a rename to the new id', async () => {
    await openSuggesting('t8', 'doc-8', 'Alpha beta gamma.')
    typeAt(after('gamma'), ' delta')
    await setSessionIdentity('t8', { documentId: 'doc-8b', path: '/docs/t8b.md', plain: false })
    expect((db.tracked.get('doc-8b') as unknown[]).length).toBe(1)
  })
})

describe('Suggesting mode on a tab', () => {
  it('is on the tab record and the state together, and not on a plain-text document', async () => {
    const t = tab('t9', 'doc-9', 'Alpha.')
    await openSession(t, 'Alpha.')
    activateSession('t9')
    expect(isSuggesting(editor.state)).toBe(false)
    expect(setSessionSuggesting('t9', true)).toBe(true)
    expect(useTabStore.getState().getTabById('t9')!.suggesting).toBe(true)
    expect(isSuggesting(editor.state)).toBe(true)
    const txt = tab('t10', 'doc-10', 'Plain.', { path: '/docs/notes.txt' })
    await openSession(txt, 'Plain.')
    expect(setSessionSuggesting('t10', true)).toBe(false)
    expect(isSuggesting(getSession('t10')!.state)).toBe(false)
  })
})

describe('a whole-document replace keeps the changes on their context', () => {
  it('a source-mode exit re-anchors them; one whose context the source edit removed is orphaned', async () => {
    const content = 'Alpha beta gamma.\n\nDelta epsilon.'
    await openSuggesting('t11', 'doc-11', content)
    replaceWord('beta', 'BETA')
    typeAt(after('epsilon'), ' zeta')
    const [replaced, kept] = trackedChangesIn(editor.state.doc).map((c) => c.id)
    const source = enterSource('t11')
    // The source shows the original; the writer edits the first paragraph.
    expect(sourceText(source.state)).toBe(content)
    const edited = source.state.update({ changes: { from: 0, to: 'Alpha beta gamma.'.length, insert: 'Alpha beta, gamma!' } }).state
    setSourceState('t11', edited)
    exitSource('t11')
    expect(trackedChangesIn(editor.state.doc).map((c) => c.id)).toEqual([kept])
    expect(reviewLogOf(editor.state).suggestions.find((s) => s.id === replaced)).toMatchObject({ status: 'superseded', orphaned: true })
  })
})
