/**
 * The editor store is a mirror of the active tab plus UI flags (#1151). The
 * per-document extras it keeps are cleared when the document changes (#1152).
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/persistence', () => ({
  generateId: () => 'id',
  saveDraft: vi.fn(async () => {}),
  clearDraft: vi.fn(async () => {})
}))

import { useEditorStore } from './editorStore'

describe('editorStore.setDocument', () => {
  it('clears the cached selection and the pending frontmatter when the document id changes, keeps them otherwise', () => {
    const store = useEditorStore.getState()
    store.setDocument({ documentId: 'doc-a', path: '/a.md' })
    store.setLastSelection({ text: 'from A', from: 1, to: 7 })
    store.setPendingFrontmatter({ title: 'A' })

    store.setDocument({ content: 'typed' })
    expect(useEditorStore.getState().getLastSelection()).toEqual({ text: 'from A', from: 1, to: 7 })
    expect(useEditorStore.getState().pendingFrontmatter).toEqual({ title: 'A' })

    store.setDocument({ documentId: 'doc-b', path: '/b.md' })
    expect(useEditorStore.getState().getLastSelection()).toBeNull()
    expect(useEditorStore.getState().pendingFrontmatter).toBeNull()
  })
})
