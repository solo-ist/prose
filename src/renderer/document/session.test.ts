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
  getSession
} from './session'
import { getIdentity } from './identity'
import { useTabStore, type Tab } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { annotationsOf } from '../extensions/ai-annotations/transactions'
import { useCommentStore } from '../extensions/comments/store'
import { useSuggestionStore } from '../extensions/ai-suggestions/store'
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
    expect(session.records.comments.find((c) => c.id === 'c-lost')?.anchorLost).toBe(true)
    expect(session.records.comments.find((c) => c.id === 'c-short')?.anchorLost).toBeFalsy()

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
    expect(useCommentStore.getState().documentId).toBe('doc-b')
    expect(useSuggestionStore.getState().documentId).toBe('doc-b')

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
    expect(useCommentStore.getState().documentId).toBe('doc-5b')
    expect(useSuggestionStore.getState().documentId).toBe('doc-5b')
    expect((db.annotations.get('doc-5b') as AIAnnotation[]).map((a) => a.documentId)).toEqual(['doc-5b'])
    expect((db.comments.get('doc-5b') as CommentData[]).map((c) => c.id)).toEqual(['c-5'])
    expect((db.suggestions.get('doc-5b') as AISuggestionData[]).map((s) => s.id)).toEqual(['s-5'])
    // The old keys stay, as before.
    expect(db.comments.has('doc-5')).toBe(true)
  })
})
