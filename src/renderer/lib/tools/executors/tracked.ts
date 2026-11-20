/**
 * `suggest_insert` and `suggest_delete` (#891, carried from #890 and #854): an
 * agent proposes a pure insertion or a pure deletion inside a paragraph, as a
 * tracked change with the agent as actor. The writer accepts or rejects in
 * Prose (#607): no tool decides. The file keeps the original until they accept
 * (design §5), so these tools never dirty the document.
 *
 * Both read the node's original text, as `read_document` reports it: a
 * pending insertion is not part of it and a pending deletion is. Neither moves
 * the writer's caret or takes focus (M3, #1237): the change is one
 * transaction on the document's state, and the selection is carried across it
 * so a caret at the insertion point stays in front of the new text.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { ToolResult } from '../../../../shared/tools/types'
import { toolError, toolSuccess } from '../../../../shared/tools/types'
import type { Actor } from '../../../../shared/review/actor'
import type { ToolContext } from '../context'
import type { DocumentHandle } from '../../../document/handle'
import { findNodeById } from '../../../extensions/node-ids'
import { trackedMarkOf, trackedMarkTypes, kindOf, inlineText } from '../../../extensions/tracked-changes/changes'
import { generateId } from '../../persistence'
import { pipelineLog } from '../../aiPipelineLog'
import { isEditorReadOnly } from './editor'

const AGENT_FALLBACK: Actor = { kind: 'unattributed', label: 'AI' }

const NODE_HINT = 'Call read_document for the node ids and the text as it stands.'

/** A textblock's original text and the document position of the gap before each of its characters. */
interface OriginalBlock {
  node: PMNode
  pos: number
  text: string
  /** gap[k]: the position before original character k; gap[text.length] is the end. */
  gap: number[]
}

function originalBlock(node: PMNode, pos: number): OriginalBlock {
  let text = ''
  const gap: number[] = []
  let end = pos + 1
  node.forEach((child, offset) => {
    const at = pos + 1 + offset
    const tracked = trackedMarkOf(child.marks)
    if (tracked && kindOf(tracked) === 'insert') return
    const t = inlineText(child)
    for (let i = 0; i < t.length; i++) {
      text += t[i]
      gap.push(at + i)
    }
    end = at + child.nodeSize
  })
  gap.push(gap.length > 0 ? end : pos + 1)
  return { node, pos, text, gap }
}

/** Every textblock in `node` (itself when it is one), with its position. */
function textblocksIn(node: PMNode, pos: number): Array<{ node: PMNode; pos: number }> {
  if (node.isTextblock) return [{ node, pos }]
  const out: Array<{ node: PMNode; pos: number }> = []
  node.descendants((child, offset) => {
    if (child.isTextblock) {
      out.push({ node: child, pos: pos + 1 + offset })
      return false
    }
    return true
  })
  return out
}

function occurrences(text: string, needle: string): number[] {
  const found: number[] = []
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) found.push(i)
  return found
}

type Target = { block: OriginalBlock; at: number | null } | { error: ToolResult }

/**
 * The textblock a call means and, with `search`, where the phrase is in its
 * original text: the node `nodeId` names (its one textblock holding `search`),
 * else the one textblock in the document holding `search`.
 */
function resolveTarget(handle: DocumentHandle, nodeId: string | undefined, search: string | undefined, edge: 'start' | 'end' | null): Target {
  const doc = handle.state.doc
  let candidates: Array<{ node: PMNode; pos: number }>
  if (nodeId) {
    const found = findNodeById(doc, nodeId)
    if (!found) return { error: toolError(`Node "${nodeId}" not found. ${NODE_HINT}`, 'NODE_NOT_FOUND') }
    candidates = textblocksIn(found.node, found.pos)
  } else {
    candidates = textblocksIn(doc, -1)
  }
  const blocks = candidates.map((c) => originalBlock(c.node, c.pos))
  if (search === undefined || search === '') {
    if (blocks.length === 0) return { error: toolError(`Node "${nodeId}" holds no text. ${NODE_HINT}`, 'NODE_NOT_FOUND') }
    return { block: edge === 'start' ? blocks[0] : blocks[blocks.length - 1], at: null }
  }
  const hits = blocks.flatMap((block) => occurrences(block.text, search).map((at) => ({ block, at })))
  if (hits.length === 0) {
    return { error: toolError(`"${search}" is not in ${nodeId ? `node "${nodeId}"` : 'the document'}. ${NODE_HINT}`, 'TEXT_NOT_FOUND') }
  }
  if (hits.length > 1) {
    return {
      error: toolError(
        `"${search}" appears ${hits.length} times in ${nodeId ? `node "${nodeId}"` : 'the document'}. Pass a longer phrase${nodeId ? '' : ', or the nodeId'}.`,
        'AMBIGUOUS_MATCH'
      )
    }
  }
  return hits[0]
}

function common(handle: DocumentHandle | null): { handle: DocumentHandle } | { error: ToolResult } {
  if (!handle) return { error: toolError('Editor not available', 'EDITOR_NOT_AVAILABLE') }
  if (isEditorReadOnly(handle)) return { error: toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY') }
  if (handle.plain) {
    return {
      error: toolError(
        'This document is a plain-text (.txt) file, which can’t hold tracked changes. Create a markdown copy with create_and_open_file and suggest there.',
        'PLAIN_TEXT_DOCUMENT'
      )
    }
  }
  return { handle }
}

/** The writer's selection carried across `tr`, a caret at the change point staying before it. */
function keepSelection(handle: DocumentHandle, tr: import('@tiptap/pm/state').Transaction): void {
  const { anchor, head } = handle.state.selection
  if (!(handle.state.selection instanceof TextSelection)) return
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(anchor, -1), tr.mapping.map(head, -1)))
}

export function executeSuggestInsert(
  args: { nodeId?: string; search?: string; text: string; position?: 'before' | 'after' | 'start' | 'end' },
  ctx: ToolContext
): ToolResult {
  const checked = common(ctx.handle)
  if ('error' in checked) return checked.error
  const { handle } = checked
  const text = args.text ?? ''
  if (!text) return toolError('text is required', 'INVALID_INPUT')
  if (/[\r\n]/.test(text)) {
    return toolError(
      'suggest_insert adds text within a paragraph, without line breaks. For a new paragraph or a rewrite, use suggest_edit on the node.',
      'INVALID_INPUT'
    )
  }
  if (!args.nodeId && !args.search) return toolError('Give nodeId, search, or both.', 'INVALID_INPUT')
  const position = args.position ?? (args.search ? 'after' : 'end')
  if ((position === 'before' || position === 'after') && !args.search) {
    return toolError(`position "${position}" needs search: the phrase to insert ${position}.`, 'INVALID_INPUT')
  }
  const target = resolveTarget(handle, args.nodeId, args.search, position === 'start' ? 'start' : 'end')
  if ('error' in target) return target.error
  const { block } = target
  const { insert } = trackedMarkTypes(handle.state.schema)
  if (!block.node.type.allowsMarkType(insert)) {
    return toolError('This node can’t hold tracked changes (a code block). Use suggest_edit, or comment instead.', 'TRACKED_NOT_SUPPORTED')
  }
  let offset: number
  if (position === 'start') offset = 0
  else if (position === 'end') offset = block.text.length
  else offset = target.at! + (position === 'after' ? args.search!.length : 0)
  // After a phrase: right behind its last character; before one, or at the
  // start: right in front of the first.
  const at = position === 'after' || position === 'end'
    ? offset === 0 ? block.gap[0] : block.gap[offset - 1] + 1
    : block.gap[offset]

  const id = generateId()
  const actor = ctx.provenance?.actor ?? AGENT_FALLBACK
  const mark = insert.create({ id, actor, createdAt: Date.now() })
  const tr = handle.state.tr.insert(at, handle.state.schema.text(text, [mark]))
  keepSelection(handle, tr)
  handle.apply(tr)
  pipelineLog('suggest_insert:result', { suggestionId: id, position, length: text.length })
  return toolSuccess({ suggested: true, suggestionId: id, type: 'insertion' as const })
}

export function executeSuggestDelete(
  args: { nodeId: string; search: string },
  ctx: ToolContext
): ToolResult {
  const checked = common(ctx.handle)
  if ('error' in checked) return checked.error
  const { handle } = checked
  if (!args.nodeId) return toolError(`nodeId is required. ${NODE_HINT}`, 'INVALID_INPUT')
  if (!args.search) return toolError('search is required: the phrase to delete.', 'INVALID_INPUT')
  const target = resolveTarget(handle, args.nodeId, args.search, null)
  if ('error' in target) return target.error
  const { block } = target
  const { remove } = trackedMarkTypes(handle.state.schema)
  if (!block.node.type.allowsMarkType(remove)) {
    return toolError('This node can’t hold tracked changes (a code block). Use suggest_edit, or comment instead.', 'TRACKED_NOT_SUPPORTED')
  }
  const from = block.gap[target.at!]
  const to = block.gap[target.at! + args.search.length - 1] + 1
  let overlaps = false
  handle.state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && trackedMarkOf(node.marks)) overlaps = true
    return !overlaps
  })
  if (overlaps) {
    return toolError(
      `"${args.search}" overlaps a pending change. Choose text outside it, or follow that change with list_suggestions.`,
      'OVERLAPS_CHANGE'
    )
  }
  const id = generateId()
  const actor = ctx.provenance?.actor ?? AGENT_FALLBACK
  const tr = handle.state.tr.addMark(from, to, remove.create({ id, actor, createdAt: Date.now() }))
  keepSelection(handle, tr)
  handle.apply(tr)
  pipelineLog('suggest_delete:result', { suggestionId: id, length: args.search.length })
  return toolSuccess({ suggested: true, suggestionId: id, type: 'deletion' as const })
}
