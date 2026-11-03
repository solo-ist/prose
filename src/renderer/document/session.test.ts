/**
 * Unit tests for the session layer (#1145): a headless TipTap editor built
 * from the app's own extension list gives the schema, parser and serializer;
 * IndexedDB is a map behind the mocked persistence module.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import type { Node as PMNode } from '@tiptap/pm/model'

const db = vi.hoisted(() => ({
  annotations: new Map<string, unknown[]>(),
  comments: new Map<string, unknown[]>(),
  suggestions: new Map<string, unknown[]>(),
  conversations: new Map<string, unknown[]>()
}))

vi.mock('../lib/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/persistence')>()
  const table = <T>(store: Map<string, unknown[]>) => ({
    save: vi.fn(async (id: string, records: T[]) => {
      store.set(id, records)
    }),
    load: vi.fn(async (id: string) => (store.get(id) ?? []) as T[]),
    remove: vi.fn(async (id: string) => {
      store.delete(id)
    })
  })
  const annotations = table(db.annotations)
  const comments = table(db.comments)
  const suggestions = table(db.suggestions)
  const conversations = table(db.conversations)
  return {
    ...actual,
    initDB: vi.fn(async () => {}),
    saveDraft: vi.fn(async () => {}),
    loadDraft: vi.fn(async () => null),
    clearDraft: vi.fn(async () => {}),
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => null),
    clearSession: vi.fn(async () => {}),
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
    deleteSuggestions: suggestions.remove
  }
})

import { createEditorExtensions } from '../components/editor/extensions'
import {
  attachEditor,
  openSession,
  activateSession,
  closeSession,
  persistRecords,
  setSessionIdentity,
  flushActiveProjections,
  replaceSessionDocument,
  getSession,
  getProjectionStats,
  mergeThreads,
  patchThread,
  readThreads,
  registerSharePushPerformer,
  enterSource,
  exitSource,
  setSourceState,
  getSourceSession,
  serializeSession,
  saveSnapshot,
  recordSaved,
  markFrontmatterChanged,
  type SharePushPerformer
} from './session'
import { resolveToolHandle, isToolHandleError } from './handle'
import { undoDepth as pmUndoDepth } from '@tiptap/pm/history'
import { sourceText } from '../extensions/source/state'
import { getIdentity } from './identity'
import { useTabStore, type Tab } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { annotationsOf } from '../extensions/ai-annotations/transactions'
import { threadsOf } from '../extensions/comments/transactions'
import { saveAnnotations, saveComments } from '../lib/persistence'
import type { AIAnnotation } from '../types/annotations'
import type { CommentData } from '../extensions/comments/types'
import type { AISuggestionData } from '../extensions/ai-suggestions/types'

let editor: Editor

function tab(id: string, documentId: string, path: string | null, content: string): Tab {
  const record: Tab = { id, documentId, path, title: id, isDirty: false, content, frontmatter: {} }
  useTabStore.getState().addTab(record)
  return record
}

function textblocks(doc: PMNode): PMNode[] {
  const out: PMNode[] = []
  doc.descendants((node) => {
    if (node.isTextblock) out.push(node)
  })
  return out
}

function marksOf(doc: PMNode, markName: string): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = []
  doc.descendants((node) => {
    if (!node.isText) return
    for (const mark of node.marks) {
      if (mark.type.name === markName) out.push({ id: mark.attrs.id as string, text: node.text ?? '' })
    }
  })
  return out
}

const PROV = { model: 'test', conversationId: 'c', messageId: 'm' }

const annotation = (documentId: string, from: number, to: number, content: string): AIAnnotation => ({
  id: `ann-${documentId}-${from}`,
  documentId,
  type: 'insertion',
  createdAt: 1,
  from,
  to,
  content,
  provenance: PROV
})

const comment = (id: string, markedText: string, extra: Partial<CommentData> = {}): CommentData => ({
  id,
  markedText,
  comment: `thread ${id}`,
  createdAt: 1,
  occurrenceIndex: 0,
  from: 0,
  to: 0,
  ...extra
})

const suggestion = (id: string, originalText: string): AISuggestionData => ({
  id,
  type: 'edit',
  originalText,
  suggestedText: `${originalText} rewritten`,
  explanation: 'test',
  createdAt: 1,
  from: 0,
  to: 0
})

beforeAll(() => {
  editor = new Editor({ extensions: createEditorExtensions(), content: '' })
  attachEditor(editor)
})

beforeEach(async () => {
  for (const id of [...useTabStore.getState().tabs.map((t) => t.id)]) await closeSession(id)
  useTabStore.setState({ tabs: [], activeTabId: null })
  db.annotations.clear()
  db.comments.clear()
  db.suggestions.clear()
})

describe('openSession', () => {
  it('stamps the identity, assigns node ids, keeps a paragraph after a table and starts with an empty history', async () => {
    const content = '# Title\n\nPara one.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const t = tab('t1', 'doc-1', '/docs/one.md', content)
    const session = await openSession(t, content)

    expect(getIdentity(session.state)).toEqual({ documentId: 'doc-1', path: '/docs/one.md', plain: false })
    const blocks = textblocks(session.state.doc)
    expect(blocks.length).toBeGreaterThan(2)
    for (const block of blocks) {
      if (block.type.name === 'paragraph' || block.type.name === 'heading') {
        expect(block.attrs.nodeId, `${block.type.name} has a node id`).toBeTruthy()
      }
    }
    expect(session.state.doc.lastChild?.type.name).toBe('paragraph')
    expect(session.state.doc.childCount).toBeGreaterThan(2)
    expect(undoDepth(session.state)).toBe(0)
  })

  it('flattens a .txt document to paragraphs', async () => {
    const content = '# Heading\n\n* item one\n* item two\n\nPlain line.\n'
    const t = tab('t2', 'doc-2', '/docs/notes.txt', content)
    const session = await openSession(t, content)
    expect(getIdentity(session.state).plain).toBe(true)
    const names = new Set<string>()
    session.state.doc.descendants((node) => {
      if (node.isBlock) names.add(node.type.name)
    })
    expect([...names]).toEqual(['paragraph'])
  })

  it('restores comment marks on the right occurrence, skips resolved threads, reports lost anchors, restores suggestion marks', async () => {
    const content = 'What that he said.\n\nThen the end came.\n\nAnother the here.\n'
    db.comments.set('doc-3', [
      comment('c-short', 'the', { occurrenceIndex: 0 }),
      comment('c-second', 'the', { occurrenceIndex: 1 }),
      comment('c-resolved', 'end came', { resolved: true }),
      comment('c-lost', 'nowhere to be found')
    ])
    db.suggestions.set('doc-3', [suggestion('s-1', 'the end')])
    const t = tab('t3', 'doc-3', '/docs/three.md', content)
    const session = await openSession(t, content)

    const comments = marksOf(session.state.doc, 'comment')
    // The short-word thread lands on "the" in the second paragraph, not inside "that he" (#1137).
    expect(comments.find((m) => m.id === 'c-short')?.text).toBe('the')
    expect(comments.find((m) => m.id === 'c-second')?.text).toBe('the')
    expect(comments.some((m) => m.id === 'c-resolved')).toBe(false)
    expect(comments.some((m) => m.id === 'c-lost')).toBe(false)
    const paragraphTexts = textblocks(session.state.doc).map((b) => b.textContent)
    expect(paragraphTexts[0]).toBe('What that he said.')
    // c-short sits in paragraph two, c-second in paragraph three: marks by order of appearance.
    expect(comments.map((m) => m.id)).toEqual(['c-short', 'c-second'])
    expect(threadsOf(session.state).find((c) => c.id === 'c-lost')?.anchorLost).toBe(true)
    expect(threadsOf(session.state).find((c) => c.id === 'c-short')?.anchorLost).toBeFalsy()

    // "the" carries the comment mark too, so the suggestion spans two text nodes.
    const suggestions = marksOf(session.state.doc, 'aiSuggestion')
    expect([...new Set(suggestions.map((m) => m.id))]).toEqual(['s-1'])
    expect(suggestions.map((m) => m.text).join('')).toBe('the end')
  })
})

describe('the markdown projection', () => {
  it('is byte-exact for an untouched document and dirty after an edit', async () => {
    const content = 'Some __bold__ text.\n'
    const t = tab('t4', 'doc-4', '/docs/four.md', content)
    await openSession(t, content)
    activateSession('t4')
    expect(useEditorStore.getState().document.content).toBe(content)
    expect(useEditorStore.getState().document.isDirty).toBe(false)

    // A mark-only transaction changes no byte: the store keeps the file's bytes.
    editor.commands.setTextSelection({ from: 1, to: 5 })
    editor.commands.setComment({ id: 'c-4', comment: 'x' })
    flushActiveProjections()
    expect(useEditorStore.getState().document.content).toBe(content)
    expect(useEditorStore.getState().document.isDirty).toBe(false)

    editor.commands.insertContentAt(1, 'X')
    flushActiveProjections()
    expect(useEditorStore.getState().document.content).toBe('XSome **bold** text.')
    expect(useEditorStore.getState().document.isDirty).toBe(true)
  })
})

describe('persistRecords and the plugin state (§G)', () => {
  it('writes each document under its own key from its own state, and a transaction on one never touches the other', async () => {
    const a = tab('ta', 'doc-a', '/docs/a.md', 'Alpha body.\n')
    const b = tab('tb', 'doc-b', '/docs/b.md', 'Beta body.\n')
    await openSession(a, 'Alpha body.\n')
    await openSession(b, 'Beta body.\n')

    // An add is written at once, under the state's own id, with its anchor text.
    activateSession('ta')
    editor.commands.addAIAnnotations([{ type: 'insertion', from: 1, to: 6, content: 'Alpha', provenance: PROV }])
    const stateA = annotationsOf(editor.state)
    expect(stateA).toHaveLength(1)
    expect(stateA[0]).toMatchObject({ documentId: 'doc-a', from: 1, to: 6, anchorText: 'Alpha' })
    await getSession('ta')!.annotationWrite
    expect(db.annotations.get('doc-a')).toEqual([stateA[0]])
    expect(db.annotations.has('doc-b')).toBe(false)

    activateSession('tb')
    expect(getIdentity(editor.state).documentId).toBe('doc-b')
    expect(annotationsOf(editor.state)).toEqual([])

    // Typing in B is a transaction on B's state alone.
    editor.commands.insertContentAt(1, 'Zed ')
    expect(annotationsOf(editor.state)).toEqual([])
    expect(annotationsOf(getSession('ta')!.state)).toBe(stateA)

    // A write for the background document lands under its key; the state stays the truth.
    const recA2 = annotation('doc-a', 1, 3, 'Al')
    await persistRecords('annotations', 'doc-a', [recA2])
    expect(db.annotations.get('doc-a')).toEqual([recA2])
    expect(annotationsOf(getSession('ta')!.state)).toBe(stateA)

    activateSession('ta')
    expect(annotationsOf(editor.state)).toBe(stateA)
  })

  it('persists a plain move on flush and a detach at once, never an empty set from a load', async () => {
    const content = 'Alpha body here.\n'
    const stored = { ...annotation('doc-m', 7, 11, 'body'), anchorText: 'body' }
    db.annotations.set('doc-m', [stored])
    const t = tab('tm', 'doc-m', '/docs/m.md', content)
    await openSession(t, content)
    activateSession('tm')
    expect(annotationsOf(editor.state)[0]).toMatchObject({ from: 7, to: 11 })
    // The seed wrote nothing back.
    expect(db.annotations.get('doc-m')).toEqual([stored])

    // Typing above the record moves it: the write waits for the flush.
    editor.commands.insertContentAt(1, 'Zed ')
    expect(annotationsOf(editor.state)[0]).toMatchObject({ from: 11, to: 15, anchorText: 'body' })
    expect(db.annotations.get('doc-m')).toEqual([stored])
    flushActiveProjections()
    await getSession('tm')!.annotationWrite
    expect((db.annotations.get('doc-m') as AIAnnotation[])[0]).toMatchObject({ from: 11, to: 15 })

    // Deleting the annotated text detaches the record and writes at once.
    editor.commands.deleteRange({ from: 11, to: 15 })
    expect(annotationsOf(editor.state)[0].detached).toBe(true)
    await getSession('tm')!.annotationWrite
    expect((db.annotations.get('doc-m') as AIAnnotation[])[0].detached).toBe(true)
  })

  it('writes once on a close with a pending move, and not at all when nothing is behind', async () => {
    const content = 'Alpha body here.\n'
    db.annotations.set('doc-w', [{ ...annotation('doc-w', 7, 11, 'body'), anchorText: 'body' }])
    const t = tab('tw', 'doc-w', '/docs/w.md', content)
    await openSession(t, content)
    activateSession('tw')
    const writes = () => vi.mocked(saveAnnotations).mock.calls.filter(([id]) => id === 'doc-w').length
    const before = writes()

    editor.commands.insertContentAt(1, 'Zed ')
    expect(writes()).toBe(before)
    await closeSession('tw')
    expect(writes()).toBe(before + 1)
    expect((db.annotations.get('doc-w') as AIAnnotation[])[0]).toMatchObject({ from: 11, to: 15 })

    // Re-open and close with nothing changed: the stored rows are current, no write.
    const t2 = tab('tw2', 'doc-w', '/docs/w.md', 'Zed Alpha body here.\n')
    await openSession(t2, 'Zed Alpha body here.\n')
    activateSession('tw2')
    const again = writes()
    await closeSession('tw2')
    expect(writes()).toBe(again)
  })

  it('writes rows the seed re-anchored or filled in at the next close', async () => {
    const content = 'Intro here.\n\nSome rewritten text.\n'
    // A legacy row (no anchorText; "rewritten text." sits at 19..34: p1 is
    // 13 positions, "Some " five more) and one whose text moved since it was stored.
    const legacy = annotation('doc-s', 19, 34, 'rewritten text.')
    const stale = { ...annotation('doc-s', 2, 17, 'rewritten text.'), id: 'stale', anchorText: 'rewritten text.' }
    db.annotations.set('doc-s', [legacy, stale])
    const t = tab('ts', 'doc-s', '/docs/s.md', content)
    await openSession(t, content)
    activateSession('ts')
    const live = annotationsOf(editor.state)
    expect(live[0].anchorText).toBe('rewritten text.')
    expect(editor.state.doc.textBetween(live[1].from, live[1].to, '\n')).toBe('rewritten text.')
    // Nothing written at load.
    expect(db.annotations.get('doc-s')).toEqual([legacy, stale])
    await closeSession('ts')
    const rows = db.annotations.get('doc-s') as AIAnnotation[]
    expect(rows[0].anchorText).toBe('rewritten text.')
    expect(rows[1].from).toBe(live[1].from)
  })
})

describe('reloads carry the records (#1138)', () => {
  it('re-anchors stored rows when a disk reload re-opens the session', async () => {
    const content = 'Intro paragraph here with words.\n\nSome rewritten text.\n'
    const t = tab('tr', 'doc-r', '/docs/r.md', content)
    await openSession(t, content)
    activateSession('tr')
    const doc = editor.state.doc
    const match = (() => {
      let pos = -1
      doc.descendants((node, p) => {
        if (pos === -1 && node.isText && node.text?.includes('rewritten')) pos = p + node.text.indexOf('rewritten')
      })
      return pos
    })()
    expect(match).toBeGreaterThan(0)
    editor.commands.addAIAnnotations([{ type: 'replacement', from: match, to: match + 'rewritten text.'.length, content: 'rewritten text.', provenance: PROV }])
    await getSession('tr')!.annotationWrite
    expect((db.annotations.get('doc-r') as AIAnnotation[])[0].anchorText).toBe('rewritten text.')

    // The file changed on disk: one word fewer above the highlight.
    const shorter = 'Intro paragraph here.\n\nSome rewritten text.\n'
    await replaceSessionDocument('tr', { content: shorter, body: shorter, frontmatter: {} }, { keepHistory: false })
    const [record] = annotationsOf(editor.state)
    expect(record.detached).toBeUndefined()
    expect(editor.state.doc.textBetween(record.from, record.to, '\n')).toBe('rewritten text.')
    expect(record.from).toBe(match - 'with words'.length - 1)
  })

  it('carries the records across a dev remount', async () => {
    const content = 'Remount body text.\n'
    const t = tab('th', 'doc-h', '/docs/h.md', content)
    await openSession(t, content)
    activateSession('th')
    editor.commands.addAIAnnotations([{ type: 'insertion', from: 1, to: 8, content: 'Remount', provenance: PROV }])
    await getSession('th')!.annotationWrite
    const written = db.annotations.get('doc-h')

    const remounted = new Editor({ extensions: createEditorExtensions(), content: '' })
    attachEditor(remounted)
    const carried = annotationsOf(getSession('th')!.state)
    expect(carried.map((a) => a.anchorText)).toEqual(['Remount'])
    expect(remounted.state.doc.textContent).toBe('Remount body text.')
    // A remount writes nothing.
    expect(db.annotations.get('doc-h')).toBe(written)

    attachEditor(editor)
    remounted.destroy()
    expect(annotationsOf(getSession('th')!.state).map((a) => a.anchorText)).toEqual(['Remount'])
  })
})

describe('setSessionIdentity', () => {
  it('restamps the state and writes the records under the new id', async () => {
    const content = 'Identity body with a thread.\n'
    db.comments.set('doc-5', [comment('c-5', 'a thread')])
    db.suggestions.set('doc-5', [suggestion('s-5', 'Identity body')])
    const t = tab('t5', 'doc-5', '/docs/five.md', content)
    await openSession(t, content)
    activateSession('t5')
    editor.commands.addAIAnnotations([{ type: 'insertion', from: 1, to: 9, content: 'Identity', provenance: PROV }])
    await getSession('t5')!.annotationWrite

    await setSessionIdentity('t5', { documentId: 'doc-5b', path: '/docs/five-b.md', plain: false })

    expect(getIdentity(editor.state)).toEqual({ documentId: 'doc-5b', path: '/docs/five-b.md', plain: false })
    expect(annotationsOf(editor.state).map((a) => a.documentId)).toEqual(['doc-5b'])
    expect((db.annotations.get('doc-5b') as AIAnnotation[]).map((a) => a.documentId)).toEqual(['doc-5b'])
    expect((db.comments.get('doc-5b') as CommentData[]).map((c) => c.id)).toEqual(['c-5'])
    expect((db.suggestions.get('doc-5b') as AISuggestionData[]).map((s) => s.id)).toEqual(['s-5'])
    // The old keys stay, as before.
    expect(db.comments.has('doc-5')).toBe(true)
  })
})

describe('comment threads in the state (#1147)', () => {
  const pushes: Array<{ documentId: string; pushes: unknown[] }> = []
  const performer: SharePushPerformer = (target, batch) => {
    pushes.push({ documentId: target.documentId, pushes: [...batch] })
  }
  beforeEach(() => {
    pushes.length = 0
    registerSharePushPerformer(performer)
  })

  function markText(doc: PMNode, id: string): string {
    return marksOf(doc, 'comment')
      .filter((m) => m.id === id)
      .map((m) => m.text)
      .join('')
  }

  it('seeds the threads from the stored rows and writes nothing back until the close', async () => {
    const content = 'Alpha body here.\n\nSecond line.\n'
    db.comments.set('doc-c', [comment('kept', 'body here'), comment('gone', 'not in the text')])
    const t = tab('tc', 'doc-c', '/docs/c.md', content)
    const session = await openSession(t, content)
    const writes = () => vi.mocked(saveComments).mock.calls.filter(([id]) => id === 'doc-c').length
    const before = writes()
    expect(threadsOf(session.state).map((c) => [c.id, c.anchorLost === true])).toEqual([['kept', false], ['gone', true]])
    expect(markText(session.state.doc, 'kept')).toBe('body here')
    expect(writes()).toBe(before)
    expect(pushes).toEqual([])

    activateSession('tc')
    await closeSession('tc')
    expect(writes()).toBe(before + 1)
    const rows = db.comments.get('doc-c') as CommentData[]
    expect(rows.find((c) => c.id === 'gone')?.anchorLost).toBe(true)
    expect(rows.find((c) => c.id === 'kept')?.anchorLost).toBe(false)
  })

  it('writes a thread change at once under the state\'s own id and hands the push to the performer', async () => {
    const a = tab('ta', 'doc-a', '/docs/a.md', 'Alpha body.\n')
    const b = tab('tb', 'doc-b', '/docs/b.md', 'Beta body.\n')
    await openSession(a, 'Alpha body.\n')
    await openSession(b, 'Beta body.\n')
    activateSession('ta')
    editor.chain().setTextSelection({ from: 1, to: 6 }).setComment({ id: 'c-a', comment: 'on alpha' }).run()
    expect(threadsOf(editor.state).map((c) => c.id)).toEqual(['c-a'])
    await getSession('ta')!.commentWrite
    expect((db.comments.get('doc-a') as CommentData[]).map((c) => c.id)).toEqual(['c-a'])
    expect(db.comments.has('doc-b')).toBe(false)
    expect(pushes).toEqual([{ documentId: 'doc-a', pushes: [{ kind: 'thread', threadId: 'c-a' }] }])

    // B's state knows nothing of it; a write-back for A lands in A while B is shown.
    activateSession('tb')
    expect(threadsOf(editor.state)).toEqual([])
    await patchThread('doc-a', 'c-a', () => ({ shareId: 'srv-a' }))
    expect(threadsOf(getSession('ta')!.state)[0].shareId).toBe('srv-a')
    expect((db.comments.get('doc-a') as CommentData[])[0].shareId).toBe('srv-a')
    expect(threadsOf(editor.state)).toEqual([])
    // Quiet: no push for a share write-back.
    expect(pushes).toHaveLength(1)

    // A resolve on A from the background is one transaction on A's state.
    activateSession('ta')
    editor.commands.resolveThread('c-a')
    await getSession('ta')!.commentWrite
    expect((db.comments.get('doc-a') as CommentData[])[0].resolved).toBe(true)
    expect(marksOf(editor.state.doc, 'comment')).toEqual([])
    expect(pushes[1]).toEqual({ documentId: 'doc-a', pushes: [{ kind: 'resolve', threadId: 'c-a' }] })
  })

  it('merges a share pull into a background tab\'s state and IndexedDB; activating it shows the thread without a reopen', async () => {
    const a = tab('ta', 'doc-a', '/docs/a.md', 'Alpha body here.\n')
    const b = tab('tb', 'doc-b', '/docs/b.md', 'Beta body.\n')
    await openSession(a, 'Alpha body here.\n')
    await openSession(b, 'Beta body.\n')
    activateSession('tb')
    editor.chain().setTextSelection({ from: 1, to: 5 }).setComment({ id: 'c-b', comment: 'on beta' }).run()
    await getSession('tb')!.commentWrite
    const opens = getProjectionStats().opens

    const pulled: CommentData = comment('srv-1', 'body here', { shareId: 'srv-1', authorName: 'Reviewer', anchorLost: true })
    await mergeThreads('doc-a', [pulled])
    const stateA = getSession('ta')!.state
    expect(threadsOf(stateA).map((c) => [c.id, c.anchorLost])).toEqual([['srv-1', false]])
    expect(markText(stateA.doc, 'srv-1')).toBe('body here')
    expect((db.comments.get('doc-a') as CommentData[]).map((c) => c.id)).toEqual(['srv-1'])
    // B untouched, in state and in IndexedDB.
    expect(threadsOf(editor.state).map((c) => c.id)).toEqual(['c-b'])
    expect((db.comments.get('doc-b') as CommentData[]).map((c) => c.id)).toEqual(['c-b'])
    expect(await readThreads('doc-a')).toBe(threadsOf(stateA))
    // A merge pushes nothing.
    expect(pushes.every((p) => p.documentId !== 'doc-a')).toBe(true)

    activateSession('ta')
    expect(getProjectionStats().opens).toBe(opens)
    expect(threadsOf(editor.state).map((c) => c.id)).toEqual(['srv-1'])
    expect(markText(editor.state.doc, 'srv-1')).toBe('body here')

    // A later pull that dropped the thread (a reviewer tombstone) takes its mark with it.
    await mergeThreads('doc-a', [])
    expect(threadsOf(editor.state)).toEqual([])
    expect(marksOf(editor.state.doc, 'comment')).toEqual([])
    expect(db.comments.get('doc-a')).toEqual([])

    // No session: the stored rows are written.
    await mergeThreads('doc-z', [pulled])
    expect((db.comments.get('doc-z') as CommentData[]).map((c) => c.id)).toEqual(['srv-1'])
  })

  it('re-anchors the threads across a reload with history and reports the lost one', async () => {
    const content = 'Intro here.\n\nSome rewritten text.\n'
    db.comments.set('doc-r', [comment('c-r', 'rewritten text')])
    const t = tab('tr', 'doc-r', '/docs/r.md', content)
    await openSession(t, content)
    activateSession('tr')
    expect(markText(editor.state.doc, 'c-r')).toBe('rewritten text')

    const next = 'Intro here, longer.\n\nSome rewritten text.\n'
    await replaceSessionDocument('tr', { content: next, body: next, frontmatter: {} }, { keepHistory: true })
    expect(markText(editor.state.doc, 'c-r')).toBe('rewritten text')
    expect(threadsOf(editor.state)[0].anchorLost).toBeFalsy()

    const gone = 'Intro here.\n\nNothing like it.\n'
    await replaceSessionDocument('tr', { content: gone, body: gone, frontmatter: {} }, { keepHistory: true })
    expect(threadsOf(editor.state)[0].resolved).toBeFalsy()
    expect(threadsOf(editor.state)[0].anchorLost).toBe(true)
    expect(marksOf(editor.state.doc, 'comment')).toEqual([])
    expect(editor.commands.undo()).toBe(true)
    expect(markText(editor.state.doc, 'c-r')).toBe('rewritten text')
    expect(threadsOf(editor.state)[0].anchorLost).toBe(false)
  })
})

describe('source mode per tab (#1150)', () => {
  it('enters with the document as loaded (the #1102 baseline), projects typing into the tab, and an untouched exit changes nothing', async () => {
    vi.useFakeTimers()
    try {
      // A bullet the serializer would rewrite: the baseline keeps the loaded bytes.
      const content = '# Title\n\n* item one\n'
      const t = tab('ts', 'doc-s', '/docs/s.md', content)
      await openSession(t, content)
      activateSession('ts')
      const before = getSession('ts')!.state.doc

      const source = enterSource('ts')
      expect(sourceText(source.state)).toBe(content)
      expect(useTabStore.getState().getTabById('ts')!.mode).toBe('source')
      expect(getSourceSession('ts')).not.toBeNull()
      expect(getSession('ts')!.state.doc).toBe(before)

      // Typing: the state lands at once, the tab record and the store after the delay; the ProseMirror state waits.
      const typed = source.state.update({ changes: { from: content.length, insert: 'More.\n' } }).state
      setSourceState('ts', typed)
      expect(getSourceSession('ts')!.state).toBe(typed)
      expect(useEditorStore.getState().document.content).not.toContain('More.')
      await vi.advanceTimersByTimeAsync(600)
      expect(useEditorStore.getState().document.content).toContain('More.')
      expect(getSession('ts')!.state.doc).toBe(before)
      expect(serializeSession('ts')).toBe(content + 'More.\n')

      // A write is refused while source mode is open on this tab.
      const refused = await resolveToolHandle({ conversationId: 'c', documentId: 'doc-s', path: '/docs/s.md', tabId: 'ts' }, { forWrite: true })
      expect(isToolHandleError(refused) && refused.code).toBe('SOURCE_MODE')

      // Back to the entry text, then exit: nothing dispatched, rich again, clean.
      setSourceState('ts', typed.update({ changes: { from: content.length, to: content.length + 6, insert: '' } }).state)
      exitSource('ts')
      expect(getSourceSession('ts')).toBeNull()
      expect(getSession('ts')!.state.doc).toBe(before)
      expect(useTabStore.getState().getTabById('ts')!.mode).toBe('rich')
      expect(useTabStore.getState().getTabById('ts')!.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an exit with changes is one replace and one undo step, with the annotations and threads re-anchored', async () => {
    const content = 'Intro here.\n\nSome rewritten text.\n'
    db.comments.set('doc-x', [comment('c-x', 'rewritten text')])
    const t = tab('tx', 'doc-x', '/docs/x.md', content)
    await openSession(t, content)
    activateSession('tx')
    editor.commands.addAIAnnotations([{ type: 'insertion', from: 1, to: 6, content: 'Intro', provenance: PROV }])
    const depth = pmUndoDepth(editor.state)

    const source = enterSource('tx')
    const edited = source.state.update({ changes: { from: 0, insert: 'Added line.\n\n' } }).state
    setSourceState('tx', edited)
    exitSource('tx')

    expect(editor.state.doc.textContent).toContain('Added line.')
    expect(pmUndoDepth(editor.state)).toBe(depth + 1)
    expect(annotationsOf(editor.state)[0].detached).toBeFalsy()
    expect(editor.state.doc.textBetween(annotationsOf(editor.state)[0].from, annotationsOf(editor.state)[0].to)).toBe('Intro')
    expect(threadsOf(editor.state)[0].anchorLost).toBeFalsy()
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.textContent).not.toContain('Added line.')
  })

  it('keeps a background tab in source mode across a switch and writes its text back when it closes', async () => {
    vi.useFakeTimers()
    try {
      const a = tab('ta', 'doc-a', '/docs/a.md', 'Alpha body.\n')
      const b = tab('tb', 'doc-b', '/docs/b.md', 'Beta body.\n')
      await openSession(a, a.content!)
      await openSession(b, b.content!)
      activateSession('ta')
      const source = enterSource('ta')
      setSourceState('ta', source.state.update({ changes: { from: 0, insert: 'Typed in source. ' }, selection: { anchor: 5 } }).state)

      activateSession('tb')
      expect(getSourceSession('ta')).toBe(source)
      expect(getSourceSession('ta')!.state.selection.main.head).toBe(5)
      expect(useTabStore.getState().getTabById('ta')!.mode).toBe('source')
      expect(getSourceSession('tb')).toBeNull()
      await vi.advanceTimersByTimeAsync(600)
      expect(useTabStore.getState().getTabById('ta')!.content).toContain('Typed in source.')
      expect(useTabStore.getState().getTabById('ta')!.isDirty).toBe(true)

      activateSession('ta')
      expect(useTabStore.getState().activeTabId).toBe('ta')
      expect(getSourceSession('ta')).toBe(source)

      activateSession('tb')
      await closeSession('ta')
      expect(useTabStore.getState().getTabById('ta')!.mode).toBe('rich')
      expect(useTabStore.getState().getTabById('ta')!.content).toContain('Typed in source.')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('frontmatter on the tab, one dirty rule, the saved snapshot (#1151)', () => {
  it('a frontmatter write dirties the tab and the mirror, the saved value back cleans it, a save snapshot cleans', async () => {
    const content = '# Doc\n\nBody.\n'
    const t = tab('tf', 'doc-f', '/docs/f.md', content)
    useTabStore.getState().updateTab('tf', { frontmatter: { title: 'One' } })
    await openSession(t, content)
    activateSession('tf')
    expect(useTabStore.getState().getTabById('tf')!.isDirty).toBe(false)
    expect(useEditorStore.getState().document.frontmatter).toEqual({ title: 'One' })

    useTabStore.getState().updateTab('tf', { frontmatter: { title: 'Two' } })
    markFrontmatterChanged('tf')
    expect(useTabStore.getState().getTabById('tf')!.isDirty).toBe(true)
    expect(useEditorStore.getState().document.isDirty).toBe(true)
    expect(useEditorStore.getState().document.frontmatter).toEqual({ title: 'Two' })
    expect(serializeSession('tf')).toBe('---\ntitle: Two\n---\n' + content)

    // Not sticky: the saved value back is clean again.
    useTabStore.getState().updateTab('tf', { frontmatter: { title: 'One' } })
    markFrontmatterChanged('tf')
    expect(useTabStore.getState().getTabById('tf')!.isDirty).toBe(false)
    expect(useEditorStore.getState().document.isDirty).toBe(false)

    useTabStore.getState().updateTab('tf', { frontmatter: { title: 'Three' } })
    markFrontmatterChanged('tf')
    const snapshot = saveSnapshot('tf')
    expect(snapshot.text).toBe('---\ntitle: Three\n---\n' + content)
    recordSaved('tf', snapshot)
    expect(useTabStore.getState().getTabById('tf')!.isDirty).toBe(false)
    expect(useEditorStore.getState().document.isDirty).toBe(false)
  })

  it('an undo back to the saved body cleans the tab, and typing during a save keeps it dirty', async () => {
    vi.useFakeTimers()
    try {
      const content = 'Some text.\n'
      const t = tab('tu', 'doc-u', '/docs/u.md', content)
      await openSession(t, content)
      activateSession('tu')
      editor.commands.insertContentAt(1, 'X')
      await vi.advanceTimersByTimeAsync(600)
      expect(useTabStore.getState().getTabById('tu')!.isDirty).toBe(true)
      expect(editor.commands.undo()).toBe(true)
      await vi.advanceTimersByTimeAsync(600)
      expect(useTabStore.getState().getTabById('tu')!.isDirty).toBe(false)
      expect(useEditorStore.getState().document.isDirty).toBe(false)
      expect(useEditorStore.getState().document.content).toBe(content)

      // The snapshot a save writes, then a keystroke before the write is recorded.
      editor.commands.insertContentAt(1, 'Y')
      const snapshot = saveSnapshot('tu')
      expect(snapshot.text).toBe('YSome text.')
      editor.commands.insertContentAt(1, 'Z')
      recordSaved('tu', snapshot)
      expect(useTabStore.getState().getTabById('tu')!.isDirty).toBe(true)
      recordSaved('tu', saveSnapshot('tu'))
      expect(useTabStore.getState().getTabById('tu')!.isDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a background tab follows the same rule, and a tab that arrived dirty stays dirty until a save', async () => {
    const a = tab('tba', 'doc-ba', '/docs/ba.md', 'Alpha.\n')
    const b = tab('tbb', 'doc-bb', '/docs/bb.md', 'Beta.\n')
    await openSession(a, a.content!)
    await openSession(b, b.content!)
    activateSession('tba')
    useTabStore.getState().updateTab('tbb', { frontmatter: { k: 1 } })
    markFrontmatterChanged('tbb')
    expect(useTabStore.getState().getTabById('tbb')!.isDirty).toBe(true)
    // The mirror is the shown tab's.
    expect(useEditorStore.getState().document.isDirty).toBe(false)
    expect(saveSnapshot('tbb').text).toBe('---\nk: 1\n---\nBeta.\n')
    recordSaved('tbb', saveSnapshot('tbb'))
    expect(useTabStore.getState().getTabById('tbb')!.isDirty).toBe(false)

    tab('td', 'doc-d', '/docs/d.md', 'Draft.\n')
    useTabStore.getState().updateTab('td', { isDirty: true })
    await openSession(useTabStore.getState().getTabById('td')!, 'Draft.\n')
    activateSession('td')
    expect(useTabStore.getState().getTabById('td')!.isDirty).toBe(true)
    recordSaved('td', saveSnapshot('td'))
    expect(useTabStore.getState().getTabById('td')!.isDirty).toBe(false)
  })

  it('a preview tab is read-only until promoted; the mirror re-applies editable', async () => {
    const p = tab('tp', 'doc-p', '/docs/p.md', 'Preview.\n')
    useTabStore.getState().updateTab('tp', { isPreview: true })
    await openSession(p, p.content!)
    activateSession('tp')
    expect(editor.isEditable).toBe(false)
    useTabStore.getState().promotePreviewTab('tp')
    expect(editor.isEditable).toBe(true)
  })
})
