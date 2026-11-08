/**
 * The review log (#1233): a headless TipTap editor built from the app's own
 * extension list runs the real commands, and the log records what became of
 * each suggestion and thread, and who decided.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { undo } from '@tiptap/pm/history'
import { createEditorExtensions } from '../../components/editor/extensions'
import { BUILD_META, IDENTITY_META } from '../../document/identity'
import { SELF, type Actor } from '../../../shared/review/actor'
import { loadThreadsInto, mergeThreadsInto } from '../comments/transactions'
import type { CommentData } from '../comments/types'
import { reviewLogOf, loadReviewLogInto, reviewLogPluginState, reviseSuggestionIn } from './transactions'
import { MAX_EVENTS, MAX_FEEDBACK, type StoredReviewLog } from './log'

const DOC = '<p>Alpha sentence here.</p><p>Bravo sentence here.</p><p>Charlie sentence here.</p>'
const AGENT: Actor = { kind: 'prose-agent', provider: 'anthropic', model: 'claude-opus-5-5' }
const MCP: Actor = { kind: 'mcp-agent', connectionId: 'c1', connectionLabel: 'Codex laptop' }

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

function suggest(needle: string, id: string, suggestedText: string, actor: Actor | null = AGENT): void {
  editor.chain().setTextSelection(rangeOf(needle)).setAISuggestion({
    id, type: 'edit', originalText: needle, suggestedText, explanation: 'tighten', provenanceModel: 'claude-opus-5-5', actor,
  }).run()
}

const log = () => reviewLogOf(editor.state)
const row = (id: string) => log().suggestions.find((s) => s.id === id)
const kinds = () => log().events.map((e) => e.kind)

describe('suggestions', () => {
  it('logs a proposal with its actor', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    expect(row('s1')).toMatchObject({ status: 'pending', actor: AGENT, suggestedText: 'Alpha line' })
    expect(log().events).toEqual([expect.objectContaining({ seq: 1, kind: 'suggestion:proposed', actor: AGENT, suggestionId: 's1' })])
  })

  it('records who accepted (an agent through its tool call) and who rejected (the writer by default)', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    suggest('Bravo sentence', 's2', 'Bravo line')
    editor.commands.acceptAISuggestion('s1', MCP)
    editor.commands.rejectAISuggestion('s2')
    expect(row('s1')).toMatchObject({ status: 'accepted', decidedBy: MCP })
    expect(row('s2')).toMatchObject({ status: 'rejected', decidedBy: SELF })
    expect(kinds()).toEqual(['suggestion:proposed', 'suggestion:proposed', 'suggestion:accepted', 'suggestion:rejected'])
  })

  it('accept-all and reject-all record every id', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    suggest('Bravo sentence', 's2', 'Bravo line')
    editor.commands.acceptAllAISuggestions(AGENT)
    expect(row('s1')?.status).toBe('accepted')
    expect(row('s2')?.status).toBe('accepted')
    expect(log().events.filter((e) => e.kind === 'suggestion:accepted').map((e) => e.actor)).toEqual([AGENT, AGENT])
  })

  it('reads deleting a suggestion’s text as the writer rejecting it', () => {
    suggest('Charlie sentence', 's3', 'Charlie line')
    const { from, to } = rangeOf('Charlie sentence here.')
    editor.chain().deleteRange({ from, to }).run()
    expect(row('s3')).toMatchObject({ status: 'rejected', decidedBy: SELF })
  })

  it('keeps every feedback entry with who gave it, and the latest on the mark', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    editor.commands.setAISuggestionReply('s1', 'Too terse')
    editor.commands.setAISuggestionReply('s1', 'Better, but keep "sentence"', MCP)
    expect(row('s1')?.feedback.map((f) => [f.text, f.actor.kind])).toEqual([['Too terse', 'human'], ['Better, but keep "sentence"', 'mcp-agent']])
    expect(kinds().filter((k) => k === 'suggestion:feedback')).toHaveLength(2)
    expect(row('s1')?.status).toBe('pending')
  })

  it('a revision supersedes the old suggestion and links both ways', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    editor.commands.reviseAISuggestion('s1', { suggestedText: 'Alpha sentence, tightened', by: MCP, newId: 's1b' })
    expect(row('s1')).toMatchObject({ status: 'superseded', supersededBy: 's1b', decidedBy: MCP })
    expect(row('s1b')).toMatchObject({ status: 'pending', supersedes: 's1', actor: MCP, suggestedText: 'Alpha sentence, tightened' })
    expect(log().events.at(-1)).toMatchObject({ kind: 'suggestion:revised', suggestionId: 's1b', previousId: 's1', actor: MCP })
    editor.commands.acceptAISuggestion('s1b')
    expect(row('s1b')?.status).toBe('accepted')
  })

  it('records the node a suggestion is on (#1266)', () => {
    editor = new Editor({ extensions: createEditorExtensions(), content: '<p data-node-id="pA">Alpha sentence here.</p><p data-node-id="pB">Bravo sentence here.</p>' })
    suggest('Bravo sentence', 's2', 'Bravo line')
    expect(row('s2')?.nodeId).toBe('pB')
  })

  it('revising a rejected suggestion links both ways and keeps the rejection (#1266)', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    editor.commands.rejectAISuggestion('s1')
    const rejected = row('s1')!
    // What revise_suggestion's transaction does: name the rejected one, mark the node anew.
    editor
      .chain()
      .command(({ tr }) => {
        reviseSuggestionIn(tr, 's1', 's1b', MCP)
        return true
      })
      .setTextSelection(rangeOf('Alpha sentence'))
      .setAISuggestion({ id: 's1b', type: 'edit', originalText: 'Alpha sentence', suggestedText: 'Alpha, again', explanation: '', actor: MCP })
      .run()
    expect(row('s1')).toEqual({ ...rejected, supersededBy: 's1b' })
    expect(row('s1')).toMatchObject({ status: 'rejected', decidedBy: SELF })
    expect(row('s1b')).toMatchObject({ status: 'pending', supersedes: 's1', actor: MCP })
    expect(log().events.at(-1)).toMatchObject({ kind: 'suggestion:revised', suggestionId: 's1b', previousId: 's1', actor: MCP })
    expect(kinds()).toEqual(['suggestion:proposed', 'suggestion:rejected', 'suggestion:revised'])
  })

  it('undoing an accept reopens the suggestion; the accept stays in the events', () => {
    suggest('Bravo sentence', 's2', 'Bravo line')
    editor.commands.acceptAISuggestion('s2')
    expect(row('s2')?.status).toBe('accepted')
    undo(editor.state, editor.view.dispatch)
    expect(row('s2')?.status).toBe('pending')
    expect(kinds()).toEqual(['suggestion:proposed', 'suggestion:accepted', 'suggestion:reopened'])
  })

  it('a transaction that touches no suggestion leaves the log and its revision alone', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    const before = reviewLogPluginState(editor.state)
    editor.chain().setTextSelection(rangeOf('Charlie')).insertContent('Mighty ').run()
    expect(reviewLogPluginState(editor.state)?.revision).toBe(before?.revision)
    expect(reviewLogOf(editor.state)).toBe(before?.log)
  })
})

describe('threads', () => {
  it('logs a comment, a reply, a resolve by an agent and a reopen by the writer', () => {
    editor.chain().setTextSelection(rangeOf('Bravo sentence')).setComment({ id: 't1', comment: 'Why?' }).run()
    editor.commands.replyToThread('t1', { id: 'r1', author: 'ai', actor: AGENT, text: 'Because.', createdAt: 1 })
    editor.commands.resolveThread('t1', AGENT)
    editor.commands.reopenThread('t1')
    expect(log().events.map((e) => [e.kind, e.actor.kind])).toEqual([
      ['comment:added', 'human'],
      ['comment:replied', 'prose-agent'],
      ['comment:resolved', 'prose-agent'],
      ['comment:reopened', 'human'],
    ])
  })

  it('a share merge logs the reviewer’s new thread under their name', () => {
    const thread: CommentData = {
      id: 'srv', markedText: 'Charlie sentence', comment: 'From a reviewer', createdAt: 1, author: 'user', authorName: 'Dana',
      occurrenceIndex: 0, from: 0, to: 0, replies: [], resolved: false,
    }
    editor.view.dispatch(mergeThreadsInto(editor.state.tr, [thread]))
    expect(log().events.at(-1)).toMatchObject({ kind: 'comment:added', threadId: 'srv', actor: { kind: 'human', self: false, name: 'Dana' } })
  })
})

describe('load', () => {
  it('a seed loads the stored log, derives no events, and backfills marks from before 1.9.1', () => {
    suggest('Alpha sentence', 'old', 'Alpha line', null)
    const stored: StoredReviewLog = {
      suggestions: [{ id: 'gone', type: 'edit', originalText: 'x', suggestedText: 'y', explanation: '', actor: AGENT, createdAt: 1, status: 'accepted', feedback: [] }],
      events: [{ seq: 7, at: 1, kind: 'suggestion:accepted', actor: SELF, suggestionId: 'gone' }],
      nextSeq: 8,
    }
    const tr = editor.state.tr.setMeta(BUILD_META, true).setMeta('addToHistory', false)
    loadReviewLogInto(tr, stored)
    loadThreadsInto(tr, [])
    editor.view.dispatch(tr)
    expect(log().events).toEqual(stored.events)
    expect(log().nextSeq).toBe(8)
    // The pre-1.9.1 mark had no row: backfilled as pending, its actor read from the model.
    expect(row('old')).toMatchObject({ status: 'pending', actor: { kind: 'prose-agent', model: 'claude-opus-5-5' } })
    editor.commands.rejectAISuggestion('old')
    expect(log().events.at(-1)).toMatchObject({ seq: 8, kind: 'suggestion:rejected' })
  })
})

describe('caps', () => {
  it('keeps the last 5,000 events and the last 200 feedback entries', () => {
    suggest('Alpha sentence', 's1', 'Alpha line')
    const tr = editor.state.tr.setMeta(BUILD_META, true)
    loadReviewLogInto(tr, {
      suggestions: log().suggestions,
      events: Array.from({ length: MAX_EVENTS }, (_, i) => ({ seq: i + 1, at: 1, kind: 'comment:added' as const, actor: SELF, threadId: `t${i}` })),
      nextSeq: MAX_EVENTS + 1,
    })
    editor.view.dispatch(tr)
    for (let i = 0; i < MAX_FEEDBACK + 5; i++) editor.commands.setAISuggestionReply('s1', `note ${i}`)
    expect(log().events).toHaveLength(MAX_EVENTS)
    expect(log().events.at(-1)?.seq).toBe(MAX_EVENTS + MAX_FEEDBACK + 5)
    expect(row('s1')?.feedback).toHaveLength(MAX_FEEDBACK)
    expect(row('s1')?.feedback.at(-1)?.text).toBe(`note ${MAX_FEEDBACK + 4}`)
  })
})
