/**
 * Chat store turns and parked conversations (#1148): a stream event lands
 * in its own conversation wherever that conversation lives, the streaming
 * flags follow the active conversation, a parked list is saved under its
 * document and wins over the stored one when its document returns, a
 * conversation moves with a tab-changing tool, a rename rekeys, a discard
 * orphans.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ conversations: new Map<string, unknown>() }))

vi.mock('../lib/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/persistence')>()
  return {
    ...actual,
    saveConversations: vi.fn(async (id: string, rows: unknown) => void db.conversations.set(id, rows)),
    loadConversations: vi.fn(async (id: string) => (db.conversations.get(id) as unknown[] | undefined) ?? []),
    deleteConversations: vi.fn(async (id: string) => void db.conversations.delete(id))
  }
})

import { useChatStore, flushParkedSaves } from './chatStore'
import type { ChatConversation } from '../lib/persistence'
import type { ToolBinding } from '../document/handle'

function binding(conversationId: string, documentId: string): ToolBinding {
  return { conversationId, documentId, path: `/${documentId}.md`, tabId: `tab-${documentId}` }
}

function message(id: string, role: 'user' | 'assistant', content = '') {
  return { id, role, content, timestamp: new Date() }
}

beforeEach(() => {
  db.conversations.clear()
  useChatStore.setState({
    conversations: [],
    conversationsDocumentId: null,
    activeConversationId: null,
    messages: [],
    isLoading: false,
    isStreaming: false,
    currentStreamId: null,
    streamingMessageId: null,
    turns: {},
    parked: {},
    context: null
  })
})

describe('turns and routed writes', () => {
  it('appends a chunk to its own conversation after the document is parked, and the flags follow the active one', async () => {
    const store = useChatStore.getState()
    store.resetForNewDocument('doc-a')
    const convA = store.addConversation('doc-a')
    store.addMessage(message('u1', 'user', 'hi'))
    store.addMessage(message('m1', 'assistant'))
    store.startStreaming('m1', 'stream-1', binding(convA, 'doc-a'))
    expect(useChatStore.getState()).toMatchObject({ isStreaming: true, currentStreamId: 'stream-1', streamingMessageId: 'm1', isLoading: true })

    // Leave for B: A's list is parked because its conversation has a turn.
    await useChatStore.getState().loadForDocument('doc-b')
    let state = useChatStore.getState()
    expect(state.conversationsDocumentId).toBe('doc-b')
    expect(state.conversations).toEqual([])
    expect(state.parked['doc-a']?.map((c) => c.id)).toEqual([convA])
    expect(state).toMatchObject({ isStreaming: false, currentStreamId: null, streamingMessageId: null, isLoading: false })

    // The stream keeps writing into A's conversation, parked, saved under A.
    state.appendStreamChunk('Hello', 'stream-1')
    state.appendStreamChunk(' there', 'stream-1')
    state = useChatStore.getState()
    expect(state.messageOf(convA, 'm1')?.content).toBe('Hello there')
    expect(state.messages).toEqual([])
    await flushParkedSaves()
    expect((db.conversations.get('doc-a') as ChatConversation[])[0].messages[1].content).toBe('Hello there')
    expect(db.conversations.has('doc-b')).toBe(false)

    // A chunk for an unknown stream is dropped.
    state.appendStreamChunk('nope', 'stream-x')
    expect(useChatStore.getState().messageOf(convA, 'm1')?.content).toBe('Hello there')

    // Back on A: the parked list wins over the stored one and the flags are A's again.
    db.conversations.set('doc-a', [{ ...(db.conversations.get('doc-a') as ChatConversation[])[0], messages: [] }, { id: 'old', documentId: 'doc-a', messages: [], createdAt: 1, updatedAt: 1 }])
    await useChatStore.getState().loadForDocument('doc-a')
    state = useChatStore.getState()
    expect(state.conversations.map((c) => c.id)).toEqual([convA, 'old'])
    expect(state.parked['doc-a']).toBeUndefined()
    expect(state.messages[1].content).toBe('Hello there')
    expect(state).toMatchObject({ isStreaming: true, currentStreamId: 'stream-1', streamingMessageId: 'm1' })

    state.completeStreaming(convA)
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, isLoading: false, turns: {} })
  })

  it('keeps a second document\'s turn independent of the active one', async () => {
    const store = useChatStore.getState()
    store.resetForNewDocument('doc-a')
    const convA = store.addConversation('doc-a')
    store.addMessage(message('m1', 'assistant'))
    store.startStreaming('m1', 'stream-a', binding(convA, 'doc-a'))
    await useChatStore.getState().loadForDocument('doc-b')
    const convB = useChatStore.getState().addConversation('doc-b')
    useChatStore.getState().addMessage(message('m2', 'assistant'))
    useChatStore.getState().startStreaming('m2', 'stream-b', binding(convB, 'doc-b'))
    let state = useChatStore.getState()
    expect(state.turnFor('stream-a')?.conversationId).toBe(convA)
    expect(state.turnFor('stream-b')?.conversationId).toBe(convB)
    expect(state.currentStreamId).toBe('stream-b')
    state.appendStreamChunk('A', 'stream-a')
    state.appendStreamChunk('B', 'stream-b')
    state = useChatStore.getState()
    expect(state.messageOf(convA, 'm1')?.content).toBe('A')
    expect(state.messages[0].content).toBe('B')
    state.completeStreaming(convB)
    state = useChatStore.getState()
    expect(state.isStreaming).toBe(false)
    expect(state.turns[convA]).toBeTruthy()
  })
})

describe('move, rekey, discard', () => {
  it('moves a conversation to the document a tab-changing tool opened, into the shown list', async () => {
    const store = useChatStore.getState()
    store.resetForNewDocument('doc-a')
    const convA = store.addConversation('doc-a')
    store.addMessage(message('m1', 'assistant', 'working'))
    const b = binding(convA, 'doc-a')
    store.startStreaming('m1', 'stream-1', b)
    // create_and_open_file: the new document arrives fresh, then the turn rebinds.
    useChatStore.getState().resetForNewDocument('doc-new')
    expect(useChatStore.getState().parked['doc-a']?.length).toBe(1)
    useChatStore.getState().moveConversation(convA, 'doc-new')
    const state = useChatStore.getState()
    expect(state.conversations.map((c) => [c.id, c.documentId])).toEqual([[convA, 'doc-new']])
    expect(state.activeConversationId).toBe(convA)
    expect(state.messages[0].content).toBe('working')
    expect(state.parked['doc-a']).toEqual([])
    expect(b.documentId).toBe('doc-new')
    expect(state.isStreaming).toBe(true)
    await flushParkedSaves()
  })

  it('rekeys a parked list and its turn on a rename, and orphans a discarded document\'s turn', async () => {
    const store = useChatStore.getState()
    store.resetForNewDocument('doc-a')
    const convA = store.addConversation('doc-a')
    store.addMessage(message('m1', 'assistant'))
    const b = binding(convA, 'doc-a')
    store.startStreaming('m1', 'stream-1', b)
    await useChatStore.getState().loadForDocument('doc-b')
    useChatStore.getState().rekeyDocument('doc-a', 'doc-a2')
    let state = useChatStore.getState()
    expect(state.parked['doc-a']).toBeUndefined()
    expect(state.parked['doc-a2']?.[0].documentId).toBe('doc-a2')
    expect(b.documentId).toBe('doc-a2')
    await flushParkedSaves()
    expect(db.conversations.has('doc-a2')).toBe(true)

    useChatStore.getState().discardDocument('doc-a2')
    state = useChatStore.getState()
    expect(state.parked['doc-a2']).toBeUndefined()
    expect(state.turns[convA]?.orphaned).toBe(true)
    // Writes for the orphaned turn go nowhere.
    state.appendStreamChunk('late', 'stream-1')
    expect(useChatStore.getState().messageOf(convA, 'm1')).toBeUndefined()
    state.completeStreaming(convA)
    expect(useChatStore.getState().turns).toEqual({})
  })

  it('saves the shown list under the document it belongs to, not the one being loaded', async () => {
    vi.useFakeTimers()
    try {
      const store = useChatStore.getState()
      store.resetForNewDocument('doc-a')
      store.addConversation('doc-a')
      store.addMessage(message('u1', 'user', 'hello'))
      // The debounced save is armed for A; loading B must not redirect it.
      const load = useChatStore.getState().loadForDocument('doc-b')
      await vi.advanceTimersByTimeAsync(1100)
      await load
      expect((db.conversations.get('doc-a') as ChatConversation[])?.[0]?.messages[0].content).toBe('hello')
      expect(db.conversations.has('doc-b')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
