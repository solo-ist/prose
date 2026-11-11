/**
 * suggest_insert and suggest_delete (#891): an agent's tracked change, with
 * the agent as actor, against the node's original text; never the writer's
 * caret; listed and decided like any suggestion, and never decided by a tool.
 */

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { createEditorExtensions } from '../../../components/editor/extensions'
import { IDENTITY_META } from '../../../document/identity'
import type { DocumentHandle, MarkdownCodec } from '../../../document/handle'
import { reviewLogOf } from '../../../extensions/review-log'
import { trackedChangesIn } from '../../../extensions/tracked-changes/changes'
import type { Actor } from '../../../../shared/review/actor'
import type { ToolContext } from '../context'
import { executeSuggestInsert, executeSuggestDelete } from './tracked'
import { executeListSuggestions, executeGetReviewStatus, executeReplyToSuggestion, executeReviseSuggestion } from './review'
import { getToolsForMCP, isMcpToolName } from '../../../../shared/tools/registry'

const MCP: Actor = { kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex laptop' }

function setup(html: string) {
  const editor = new Editor({ extensions: createEditorExtensions(), content: html })
  editor.view.dispatch(editor.state.tr.setMeta(IDENTITY_META, { documentId: 'doc', path: '/doc.md', plain: false }).setMeta('addToHistory', false))
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
    get commands() {
      return editor.commands
    },
    chain: () => editor.chain(),
    can: () => editor.can(),
    markdown: (editor.storage as unknown as { markdown: MarkdownCodec }).markdown,
    serialize: () => '',
    apply: (tr) => editor.view.dispatch(tr),
  }
  const ctx: ToolContext = { handle, provenance: { model: '', conversationId: '', messageId: '', documentId: 'doc', actor: MCP }, preserveView: true }
  return { editor, ctx }
}

const TWO = '<p data-node-id="pA">Alpha one.</p><p data-node-id="pB">Bravo two, three.</p>'

const text = (editor: Editor) => editor.state.doc.textContent

describe('suggest_insert', () => {
  it('inserts tracked text after a phrase, by the calling agent', () => {
    const { editor, ctx } = setup(TWO)
    const result = executeSuggestInsert({ nodeId: 'pB', search: 'two', text: ' and a half' }, ctx)
    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(text(editor)).toBe('Alpha one.Bravo two and a half, three.')
    const [change] = trackedChangesIn(editor.state.doc)
    expect(change).toMatchObject({ type: 'insertion', insertedText: ' and a half', actor: MCP })
  })

  it('takes before, start and end, and finds the paragraph from search alone', () => {
    const { editor, ctx } = setup(TWO)
    expect(executeSuggestInsert({ search: 'three', text: 'only ', position: 'before' }, ctx).success).toBe(true)
    expect(executeSuggestInsert({ nodeId: 'pA', text: 'So: ', position: 'start' }, ctx).success).toBe(true)
    expect(executeSuggestInsert({ nodeId: 'pA', text: ' Indeed.' }, ctx).success).toBe(true)
    expect(text(editor)).toBe('So: Alpha one. Indeed.Bravo two, only three.')
  })

  it('never moves the writer’s caret, even when it sits at the insertion point', () => {
    const { editor, ctx } = setup(TWO)
    let caret = -1
    editor.state.doc.descendants((n, pos) => {
      if (caret === -1 && n.isText && n.text!.includes('two')) caret = pos + n.text!.indexOf('two') + 3
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)))
    executeSuggestInsert({ nodeId: 'pB', search: 'two', text: ' and a half' }, ctx)
    expect(editor.state.selection.from).toBe(caret)
  })

  it('refuses a line break, an unknown node, a phrase that is not there or appears twice', () => {
    const { ctx } = setup('<p data-node-id="p1">one one</p>')
    expect(executeSuggestInsert({ nodeId: 'p1', text: 'a\nb' }, ctx)).toMatchObject({ success: false, code: 'INVALID_INPUT' })
    expect(executeSuggestInsert({ nodeId: 'nope', text: 'x' }, ctx)).toMatchObject({ success: false, code: 'NODE_NOT_FOUND' })
    expect(executeSuggestInsert({ nodeId: 'p1', search: 'two', text: 'x' }, ctx)).toMatchObject({ success: false, code: 'TEXT_NOT_FOUND' })
    expect(executeSuggestInsert({ nodeId: 'p1', search: 'one', text: 'x' }, ctx)).toMatchObject({ success: false, code: 'AMBIGUOUS_MATCH' })
    expect(executeSuggestInsert({ text: 'x' }, ctx)).toMatchObject({ success: false, code: 'INVALID_INPUT' })
  })

  it('refuses a code block and a plain-text document', () => {
    const { ctx } = setup('<pre data-node-id="c1"><code>code</code></pre>')
    expect(executeSuggestInsert({ search: 'code', text: 'x' }, ctx)).toMatchObject({ success: false, code: 'TRACKED_NOT_SUPPORTED' })
    const plain = setup(TWO)
    ;(plain.ctx.handle as { plain: boolean }).plain = true
    expect(executeSuggestInsert({ nodeId: 'pA', text: 'x' }, plain.ctx)).toMatchObject({ success: false, code: 'PLAIN_TEXT_DOCUMENT' })
  })
})

describe('suggest_delete', () => {
  it('marks the phrase deleted, by the calling agent; the text stays', () => {
    const { editor, ctx } = setup(TWO)
    const result = executeSuggestDelete({ nodeId: 'pB', search: ', three' }, ctx)
    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(text(editor)).toBe('Alpha one.Bravo two, three.')
    expect(trackedChangesIn(editor.state.doc)[0]).toMatchObject({ type: 'deletion', deletedText: ', three', actor: MCP })
  })

  it('matches the original text: a pending insertion is not part of it, and a pending change can’t be overlapped', () => {
    const { editor, ctx } = setup(TWO)
    executeSuggestInsert({ nodeId: 'pB', search: 'two', text: ' and a half' }, ctx)
    // "two, three" is the original text around the insertion.
    expect(executeSuggestDelete({ nodeId: 'pB', search: 'two, three' }, ctx)).toMatchObject({ success: false, code: 'OVERLAPS_CHANGE' })
    expect(executeSuggestDelete({ nodeId: 'pB', search: 'Bravo' }, ctx).success).toBe(true)
    expect(trackedChangesIn(editor.state.doc).map((c) => c.type)).toEqual(['deletion', 'insertion'])
  })
})

describe('the review tools over tracked changes', () => {
  it('list them with their type, report them pending, take feedback, and refuse to revise them', () => {
    const { editor, ctx } = setup(TWO)
    const insert = executeSuggestInsert({ nodeId: 'pB', search: 'two', text: ' and a half' }, ctx)
    const id = (insert as { data: { suggestionId: string } }).data.suggestionId
    const listed = executeListSuggestions({}, ctx) as { data: { suggestions: Array<Record<string, unknown>> } }
    expect(listed.data.suggestions).toEqual([
      expect.objectContaining({ id, type: 'insertion', tracked: true, status: 'pending', originalText: '', suggestedText: ' and a half', by: 'Codex laptop', byKind: 'mcp-agent' }),
    ])
    expect((executeGetReviewStatus(ctx) as { data: { pending: string[] } }).data.pending).toEqual([id])
    expect(executeReplyToSuggestion({ id, text: 'Half reads better.' }, ctx).success).toBe(true)
    expect(reviewLogOf(editor.state).suggestions[0].feedback[0]).toMatchObject({ text: 'Half reads better.', actor: MCP })
    expect(executeReviseSuggestion({ id, content: 'x' }, ctx)).toMatchObject({ success: false, code: 'TRACKED_CHANGE' })

    editor.commands.rejectTrackedChange(id)
    const all = executeListSuggestions({ include: 'all' }, ctx) as { data: { suggestions: Array<Record<string, unknown>> } }
    expect(all.data.suggestions).toEqual([expect.objectContaining({ id, type: 'insertion', tracked: true, status: 'rejected', decidedBy: 'the writer' })])
  })

  it('are on the MCP surface, and no accept or reject is', () => {
    const names = getToolsForMCP().map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['suggest_insert', 'suggest_delete']))
    for (const forbidden of ['accept_diff', 'reject_diff', 'acceptTrackedChange', 'rejectTrackedChange']) expect(isMcpToolName(forbidden)).toBe(false)
  })
})
