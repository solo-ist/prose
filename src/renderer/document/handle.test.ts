/**
 * DocumentHandle for a background tab (#1148): commands run over the
 * session's own state and land there, never in the view; `focus()` is a
 * no-op; the same handle routes through the view once the tab is shown.
 * `resolveToolHandle` follows a turn's binding: its tab, the tab holding its
 * document, a background reopen from disk, or a closed untitled document.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'

const db = vi.hoisted(() => ({
  annotations: new Map<string, unknown>(),
  comments: new Map<string, unknown>(),
  suggestions: new Map<string, unknown>(),
  conversations: new Map<string, unknown>()
}))

vi.mock('../lib/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/persistence')>()
  const table = (map: Map<string, unknown>) => ({
    save: vi.fn(async (id: string, rows: unknown) => void map.set(id, rows)),
    load: vi.fn(async (id: string) => (map.get(id) as unknown[] | undefined) ?? []),
    remove: vi.fn(async (id: string) => void map.delete(id))
  })
  const a = table(db.annotations)
  const c = table(db.comments)
  const s = table(db.suggestions)
  const v = table(db.conversations)
  return {
    ...actual,
    saveAnnotations: a.save,
    loadAnnotations: a.load,
    deleteAnnotations: a.remove,
    saveComments: c.save,
    loadComments: c.load,
    deleteComments: c.remove,
    saveSuggestions: s.save,
    loadSuggestions: s.load,
    deleteSuggestions: s.remove,
    saveConversations: v.save,
    loadConversations: v.load,
    deleteConversations: v.remove,
    saveSession: vi.fn(async () => {}),
    loadSession: vi.fn(async () => null),
    clearSession: vi.fn(async () => {})
  }
})

import { createEditorExtensions } from '../components/editor/extensions'
import { attachEditor, openSession, activateSession, closeSession, getSession, getSessionTabIds } from './session'
import { handleForTab, resolveToolHandle, isToolHandleError, type ToolBinding } from './handle'
import { getIdentity } from './identity'
import { useTabStore, type Tab } from '../stores/tabStore'
import { annotationsOf } from '../extensions/ai-annotations/transactions'
import { threadsOf } from '../extensions/comments/transactions'
import { getAISuggestions } from '../extensions/ai-suggestions/extension'
import type { AISuggestionData } from '../extensions/ai-suggestions/types'
import { executeTool } from '../lib/tools'
import { getNodesWithIds } from '../extensions/node-ids'

let editor: Editor
const PROV = { model: 'test', conversationId: 'c', messageId: 'm' }

function tab(id: string, documentId: string, path: string | null, content: string): Tab {
  const record: Tab = { id, documentId, path, title: id, isDirty: false, content, frontmatter: {} }
  useTabStore.getState().addTab(record)
  return record
}

async function twoTabs(): Promise<void> {
  const a = tab('ta', 'doc-a', '/docs/a.md', 'Alpha body here.\n\nAlpha second.\n')
  const b = tab('tb', 'doc-b', '/docs/b.md', 'Beta body.\n')
  await openSession(a, a.content!)
  await openSession(b, b.content!)
  activateSession('tb')
}

beforeAll(() => {
  editor = new Editor({ extensions: createEditorExtensions(), content: '' })
  attachEditor(editor)
})

beforeEach(async () => {
  for (const id of [...useTabStore.getState().tabs.map((t) => t.id)]) await closeSession(id)
  useTabStore.setState({ tabs: [], activeTabId: null, closedTabs: [] })
  db.annotations.clear()
  db.comments.clear()
  db.suggestions.clear()
  db.conversations.clear()
})

describe('handleForTab on a background tab', () => {
  it('writes through commands and chains into the session state, not the view, and focus is a no-op', async () => {
    await twoTabs()
    const h = handleForTab('ta')!
    expect(h.isActive).toBe(false)
    expect(h.view).toBeNull()
    expect(h.documentId).toBe('doc-a')
    const viewTextBefore = editor.state.doc.textContent

    expect(h.commands.insertContentAt(1, 'Zed ')).toBe(true)
    expect(h.state.doc.textContent).toContain('Zed Alpha body')
    expect(getSession('ta')!.state.doc.textContent).toContain('Zed Alpha body')
    expect(editor.state.doc.textContent).toBe(viewTextBefore)

    const ok = h.chain().focus().setTextSelection({ from: 5, to: 10 }).setComment({ id: 'c-a', comment: 'bg' }).run()
    expect(ok).toBe(true)
    expect(threadsOf(h.state).map((c) => c.id)).toEqual(['c-a'])
    expect(threadsOf(editor.state)).toEqual([])
    expect(getIdentity(editor.state).documentId).toBe('doc-b')

    h.commands.addAIAnnotations([{ type: 'insertion', from: 1, to: 5, content: 'Zed ', provenance: PROV }])
    expect(annotationsOf(h.state)).toHaveLength(1)
    expect(annotationsOf(h.state)[0].documentId).toBe('doc-a')
    expect(annotationsOf(editor.state)).toEqual([])
    // Written under A's id at once (the annotation plugin's urgent write).
    await getSession('ta')!.annotationWrite
    expect(db.annotations.has('doc-a')).toBe(true)
    expect(db.annotations.has('doc-b')).toBe(false)

    expect(h.can().insertContentAt(1, 'x')).toBe(true)
    expect(h.serialize()).toContain('Zed Alpha body here.')
  })

  it('projects a background suggestion and its resolve to IndexedDB', async () => {
    vi.useFakeTimers()
    try {
      await twoTabs()
      const h = handleForTab('ta')!
      const ok = h
        .chain()
        .setTextSelection({ from: 1, to: 6 })
        .setAISuggestion({
          id: 's-a',
          type: 'edit',
          originalText: 'Alpha',
          suggestedText: 'Gamma',
          explanation: 'bg',
          documentId: 'doc-a'
        })
        .run()
      expect(ok).toBe(true)
      expect(getAISuggestions({ state: h.state }).map((s) => s.id)).toEqual(['s-a'])
      expect(db.suggestions.has('doc-a')).toBe(false)
      await vi.advanceTimersByTimeAsync(600)
      expect((db.suggestions.get('doc-a') as AISuggestionData[]).map((s) => s.id)).toEqual(['s-a'])
      // The tab record follows the background edit after the projection delay.
      expect(useTabStore.getState().getTabById('ta')!.content).toContain('Alpha body here.')

      expect(h.commands.rejectAISuggestion('s-a')).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(db.suggestions.has('doc-a')).toBe(false)
      expect(getAISuggestions({ state: h.state })).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('routes through the view once the tab is shown', async () => {
    await twoTabs()
    const h = handleForTab('ta')!
    activateSession('ta')
    expect(h.isActive).toBe(true)
    expect(h.view).toBe(editor.view)
    h.commands.insertContentAt(1, 'Live ')
    expect(editor.state.doc.textContent).toContain('Live Alpha')
    expect(h.state).toBe(editor.state)
  })
})

describe('resolveToolHandle', () => {
  it('resolves the bound tab, then the tab holding the document, and fills the binding in', async () => {
    await twoTabs()
    const binding: ToolBinding = { conversationId: 'conv', documentId: 'doc-a', path: '/docs/a.md', tabId: null }
    const h = await resolveToolHandle(binding)
    expect(isToolHandleError(h)).toBe(false)
    expect((h as { tabId: string }).tabId).toBe('ta')
    expect(binding.tabId).toBe('ta')

    const stale: ToolBinding = { conversationId: 'conv', documentId: 'doc-a', path: '/docs/a.md', tabId: 'gone' }
    const again = await resolveToolHandle(stale)
    expect((again as { tabId: string }).tabId).toBe('ta')
    expect(stale.tabId).toBe('ta')
  })

  it('opens a lazy tab\'s session, refuses a write in source mode, and names a closed untitled document', async () => {
    await twoTabs()
    tab('tl', 'doc-l', '/docs/l.md', 'Lazy body.\n')
    useTabStore.setState({ activeTabId: 'tb' })
    expect(getSessionTabIds()).not.toContain('tl')
    const lazy = await resolveToolHandle({ conversationId: 'conv', documentId: 'doc-l', path: '/docs/l.md', tabId: null })
    expect((lazy as { tabId: string }).tabId).toBe('tl')
    expect(getSessionTabIds()).toContain('tl')
    expect((lazy as { state: { doc: { textContent: string } } }).state.doc.textContent).toContain('Lazy body.')

    const closed = await resolveToolHandle({ conversationId: 'conv', documentId: 'doc-z', path: null, tabId: null })
    expect(isToolHandleError(closed)).toBe(true)
    expect(closed).toMatchObject({ code: 'DOCUMENT_CLOSED' })
    expect((closed as { error: string }).error).toContain('Untitled')
  })

  it('reopens a closed saved document in the background from disk', async () => {
    await twoTabs()
    const content = 'Alpha from disk.\n'
    ;(window as unknown as { api: unknown }).api = {
      readFile: vi.fn(async () => content),
      fileStat: vi.fn(async () => ({ createdAt: null, modifiedAt: null, size: 0, mtimeMs: 1 }))
    }
    try {
      await closeSession('ta')
      useTabStore.getState().removeTab('ta')
      const binding: ToolBinding = { conversationId: 'conv', documentId: 'doc-a', path: '/docs/a.md', tabId: 'ta' }
      const h = await resolveToolHandle(binding)
      expect(isToolHandleError(h)).toBe(false)
      const handle = h as { tabId: string; isActive: boolean; state: { doc: { textContent: string } } }
      expect(handle.isActive).toBe(false)
      expect(handle.state.doc.textContent).toContain('Alpha from disk.')
      expect(useTabStore.getState().activeTabId).toBe('tb')
      expect(useTabStore.getState().getTabById(handle.tabId)?.path).toBe('/docs/a.md')
      expect(binding.tabId).toBe(handle.tabId)
      expect(getIdentity(editor.state).documentId).toBe('doc-b')
    } finally {
      delete (window as unknown as { api?: unknown }).api
    }
  })
})

describe('executeTool with a binding', () => {
  it('acts on the bound document while another tab is shown, and on the active tab without a binding', async () => {
    await twoTabs()
    const binding: ToolBinding = { conversationId: 'conv', documentId: 'doc-a', path: '/docs/a.md', tabId: null }
    const provenance = { model: 'test', conversationId: 'conv', messageId: 'm1', documentId: 'doc-a' }

    const read = await executeTool('read_document', {}, 'create', undefined, binding)
    expect(read.success).toBe(true)
    const data = (read as { data: { markdown: string; nodes: Array<{ id: string; content: string }> } }).data
    expect(data.markdown).toContain('Alpha body here.')
    expect(data.markdown).not.toContain('Beta')
    const target = data.nodes.find((n) => n.content === 'Alpha second.')!
    expect(target).toBeTruthy()

    const edited = await executeTool('edit', { nodeId: target.id, content: 'Alpha rewritten.' }, 'create', provenance, binding)
    expect(edited.success, JSON.stringify(edited)).toBe(true)
    const a = getSession('ta')!.state
    expect(a.doc.textContent).toContain('Alpha rewritten.')
    expect(annotationsOf(a).map((r) => r.documentId)).toEqual(['doc-a'])
    expect(editor.state.doc.textContent).toBe('Beta body.')
    expect(annotationsOf(editor.state)).toEqual([])
    expect(binding.tabId).toBe('ta')

    // Without a binding the active tab (B) is the target, as for MCP clients.
    const bNode = getNodesWithIds(editor.state.doc)[0]
    const onActive = await executeTool('edit', { nodeId: bNode.nodeId, content: 'Beta rewritten.' }, 'create', { ...provenance, documentId: 'doc-b' })
    expect(onActive.success, JSON.stringify(onActive)).toBe(true)
    expect(editor.state.doc.textContent).toContain('Beta rewritten.')
    expect(getSession('ta')!.state.doc.textContent).toContain('Alpha rewritten.')

    // A frontmatter write on the background document is refused, not misdirected.
    const fm = await executeTool('edit', { nodeId: 'frontmatter', content: 'title: x' }, 'create', provenance, binding)
    expect(fm.success).toBe(false)
    expect((fm as { code?: string }).code).toBe('FRONTMATTER_BACKGROUND')
  })
})
