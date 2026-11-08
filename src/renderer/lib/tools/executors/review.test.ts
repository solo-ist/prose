/**
 * revise_suggestion on a suggestion that has left the document (#1266): the
 * real executors over a headless editor built from the app's extension list.
 * A rejected suggestion is revised on its node and stays rejected; an accepted
 * one is refused; the node is found by its stored id, else by its text, else
 * the caller names it.
 */

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '../../../components/editor/extensions'
import { IDENTITY_META } from '../../../document/identity'
import type { DocumentHandle, MarkdownCodec } from '../../../document/handle'
import { reviewLogOf } from '../../../extensions/review-log'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { SELF, type Actor } from '../../../../shared/review/actor'
import type { ToolContext } from '../context'
import { executeSuggestEdit } from './editor'
import { executeListSuggestions, executeReviseSuggestion } from './review'

const MCP: Actor = { kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex laptop' }

function setup(html: string) {
  const editor = new Editor({ extensions: createEditorExtensions(), content: html })
  editor.view.dispatch(
    editor.state.tr.setMeta(IDENTITY_META, { documentId: 'doc', path: '/doc.md', plain: false }).setMeta('addToHistory', false)
  )
  const handle: DocumentHandle = {
    tabId: 'tab',
    documentId: 'doc',
    path: '/doc.md',
    plain: false,
    get state() {
      return editor.state
    },
    schema: editor.schema,
    isActive: false,
    view: null,
    commands: editor.commands,
    chain: () => editor.chain(),
    can: () => editor.can(),
    markdown: (editor.storage as unknown as { markdown: MarkdownCodec }).markdown,
    serialize: () => '',
    apply: (tr) => editor.view.dispatch(tr),
  }
  const ctx: ToolContext = {
    handle,
    provenance: { model: '', conversationId: '', messageId: '', documentId: 'doc', actor: MCP },
    preserveView: true,
  }
  const suggest = (nodeId: string, content: string): string => {
    const result = executeSuggestEdit({ nodeId, content }, ctx)
    if (!result.success) throw new Error(result.error)
    return result.data.suggestionId
  }
  const revise = (args: { id: string; content: string; nodeId?: string }) => executeReviseSuggestion(args, ctx)
  const row = (id: string) => reviewLogOf(editor.state).suggestions.find((s) => s.id === id)
  const pending = () => getAISuggestions({ state: editor.state }).map((s) => ({ id: s.id, originalText: s.originalText }))
  /** What reopening a document does to node ids: every one is new. */
  const renumber = () => {
    const tr = editor.state.tr
    editor.state.doc.descendants((node, pos) => {
      if (typeof node.attrs.nodeId === 'string' && node.attrs.nodeId) tr.setNodeMarkup(pos, undefined, { ...node.attrs, nodeId: `${node.attrs.nodeId}-2` })
    })
    editor.view.dispatch(tr)
  }
  return { editor, ctx, suggest, revise, row, pending, renumber }
}

const TWO = '<p data-node-id="pA">Alpha one.</p><p data-node-id="pB">Bravo two.</p>'

describe('revise_suggestion on a rejected suggestion', () => {
  it('proposes again on the same node; the rejection stands and the two are linked', () => {
    const { editor, ctx, suggest, revise, row, pending } = setup(TWO)
    const first = suggest('pB', 'Bravo, improved.')
    expect(row(first)?.nodeId).toBe('pB')
    editor.commands.rejectAISuggestion(first)

    const revised = revise({ id: first, content: 'Bravo two, improved.' })
    expect(revised.success, JSON.stringify(revised)).toBe(true)
    const next = (revised as { data: { suggestionId: string; revises: string } }).data
    expect(next.revises).toBe(first)
    expect(pending()).toEqual([{ id: next.suggestionId, originalText: 'Bravo two.' }])
    expect(row(first)).toMatchObject({ status: 'rejected', decidedBy: SELF, supersededBy: next.suggestionId })
    expect(row(next.suggestionId)).toMatchObject({ status: 'pending', supersedes: first, actor: MCP, nodeId: 'pB' })
    expect(reviewLogOf(editor.state).events.at(-1)).toMatchObject({ kind: 'suggestion:revised', suggestionId: next.suggestionId, previousId: first })

    const all = executeListSuggestions({ include: 'all' }, ctx)
    expect(all.success && (all.data as { suggestions: unknown[] }).suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: next.suggestionId, status: 'pending', revises: first }),
        expect.objectContaining({ id: first, status: 'rejected', supersededBy: next.suggestionId, decidedBy: 'the writer' }),
      ])
    )
  })

  it('finds the node by its text once the stored id is stale (a reopened document)', () => {
    const { editor, suggest, revise, pending, renumber } = setup(TWO)
    const first = suggest('pB', 'Bravo, improved.')
    editor.commands.rejectAISuggestion(first)
    renumber()
    const revised = revise({ id: first, content: 'Bravo two, improved.' })
    expect(revised.success, JSON.stringify(revised)).toBe(true)
    expect(pending().map((s) => s.originalText)).toEqual(['Bravo two.'])
  })

  it('counts a list item and its paragraph as one place', () => {
    const { editor, suggest, revise, renumber } = setup('<ul><li data-node-id="li1"><p data-node-id="p1">Item text.</p></li></ul><p data-node-id="p2">Other.</p>')
    const first = suggest('li1', 'Item text, better.')
    editor.commands.rejectAISuggestion(first)
    renumber()
    expect(revise({ id: first, content: 'Item text, best.' }).success).toBe(true)
  })

  it('asks for a nodeId when the text appears twice, and takes the one it is given', () => {
    const { editor, suggest, revise, pending, renumber } = setup('<p data-node-id="p1">Same text.</p><p data-node-id="p2">Same text.</p>')
    const first = suggest('p2', 'Other text.')
    editor.commands.rejectAISuggestion(first)
    renumber()
    const ambiguous = revise({ id: first, content: 'Other text, again.' })
    expect(ambiguous).toMatchObject({ success: false, code: 'AMBIGUOUS_MATCH' })
    expect((ambiguous as { error: string }).error).toContain('read_document')
    expect(revise({ id: first, content: 'Other text, again.', nodeId: 'p2-2' }).success).toBe(true)
    expect(pending()).toHaveLength(1)
  })

  it('reports NODE_NOT_FOUND when the text is gone or the given node is not in the document', () => {
    const { editor, suggest, revise, renumber } = setup(TWO)
    const first = suggest('pB', 'Bravo, improved.')
    editor.commands.rejectAISuggestion(first)
    renumber()
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Changed.')
    expect(revise({ id: first, content: 'Bravo again.' })).toMatchObject({ success: false, code: 'NODE_NOT_FOUND' })
    expect(revise({ id: first, content: 'Bravo again.', nodeId: 'nope' })).toMatchObject({ success: false, code: 'NODE_NOT_FOUND' })
  })
})

describe('revise_suggestion refusals', () => {
  it('refuses an accepted suggestion: it is in the text now', () => {
    const { editor, suggest, revise, pending } = setup(TWO)
    const first = suggest('pA', 'Alpha, improved.')
    editor.commands.acceptAISuggestion(first)
    const refused = revise({ id: first, content: 'Alpha, again.' })
    expect(refused).toMatchObject({ success: false, code: 'SUGGESTION_ACCEPTED' })
    expect((refused as { error: string }).error).toContain('suggest_edit')
    expect(pending()).toEqual([])
  })

  it('refuses a second revision of the same rejected suggestion, naming the first', () => {
    const { editor, suggest, revise } = setup(TWO)
    const first = suggest('pA', 'Alpha, improved.')
    editor.commands.rejectAISuggestion(first)
    const revised = revise({ id: first, content: 'Alpha one, improved.' })
    const next = (revised as { data: { suggestionId: string } }).data.suggestionId
    const again = revise({ id: first, content: 'Alpha one, once more.' })
    expect(again).toMatchObject({ success: false, code: 'SUGGESTION_SUPERSEDED' })
    expect((again as { error: string }).error).toContain(next)
  })

  it('an unknown id is SUGGESTION_NOT_FOUND', () => {
    const { revise } = setup(TWO)
    expect(revise({ id: 'nope', content: 'x' })).toMatchObject({ success: false, code: 'SUGGESTION_NOT_FOUND' })
  })
})

describe('revise_suggestion on a pending suggestion', () => {
  it('replaces it as before: superseded, linked both ways', () => {
    const { suggest, revise, row, pending } = setup(TWO)
    const first = suggest('pA', 'Alpha, improved.')
    const revised = revise({ id: first, content: 'Alpha one, improved.' })
    const next = (revised as { data: { suggestionId: string; revises: string } }).data
    expect(next.revises).toBe(first)
    expect(pending().map((s) => s.id)).toEqual([next.suggestionId])
    expect(row(first)).toMatchObject({ status: 'superseded', supersededBy: next.suggestionId, decidedBy: MCP })
  })
})
