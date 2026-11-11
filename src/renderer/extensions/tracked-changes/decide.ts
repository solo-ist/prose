/**
 * Accepting and rejecting tracked changes (#891, design §2), as transaction
 * builders the commands, the filter and the agents' paths share.
 *
 * | Mark            | Accept                  | Reject                  |
 * |-----------------|-------------------------|-------------------------|
 * | `trackedInsert` | remove the mark         | delete the text         |
 * | `trackedDelete` | delete the text         | remove the mark         |
 *
 * A textblock whose whole text an accepted deletion removes goes with it when
 * its parent keeps other blocks (accepting the deletion of a paragraph leaves
 * no empty paragraph behind).
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { addAnnotationsTo, type AnnotationInput } from '../ai-annotations/transactions'
import { trackedChangesIn, trackedMarkTypes, type TrackedChange } from './changes'
import { TRACKED_RESOLVED_META } from './transactions'

export type TrackedDecision = 'accept' | 'reject'

interface Span {
  from: number
  to: number
}

/** Spans sorted, with touching ones joined. */
function merged(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out[out.length - 1]
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to)
    else out.push({ ...span })
  }
  return out
}

/** The textblocks every inline position of which lies in `spans`. */
function wholeBlocks(doc: PMNode, input: Span[]): Span[] {
  const spans = merged(input)
  const blocks: Span[] = []
  const covered = (from: number, to: number) => spans.some((s) => s.from <= from && s.to >= to)
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) return true
    if (node.content.size === 0 || !parent || parent.childCount < 2) return false
    if (covered(pos + 1, pos + node.nodeSize - 1)) blocks.push({ from: pos, to: pos + node.nodeSize })
    return false
  })
  return blocks
}

/**
 * Decide `ids` in `tr`, against the document `tr` holds now. Returns the
 * changes decided. An accepted insertion by an agent records an AI annotation
 * with that agent as actor (authorship highlighting, §2); the writer's own
 * accepted insertions record none.
 */
export function decideTrackedIn(tr: Transaction, ids: readonly string[], decision: TrackedDecision): TrackedChange[] {
  const wanted = new Set(ids)
  const changes = trackedChangesIn(tr.doc).filter((c) => wanted.has(c.id))
  if (changes.length === 0) return []
  const { insert, remove } = trackedMarkTypes(tr.doc.type.schema)

  const unmark: Array<Span & { type: typeof insert }> = []
  const drop: Span[] = []
  const annotate: Array<{ change: TrackedChange; span: Span; text: string }> = []
  for (const change of changes) {
    for (const range of change.ranges) {
      const keepsText = (decision === 'accept') === (range.kind === 'insert')
      if (keepsText) {
        unmark.push({ from: range.from, to: range.to, type: range.kind === 'insert' ? insert : remove })
        if (decision === 'accept' && range.kind === 'insert' && change.actor.kind !== 'human') {
          annotate.push({ change, span: range, text: range.text })
        }
      } else {
        drop.push({ from: range.from, to: range.to })
      }
    }
  }

  for (const span of unmark) tr.removeMark(span.from, span.to, span.type)
  // Whole blocks first, then the remaining spans, last first: removing marks
  // moved nothing, so the positions still hold until the first deletion. Only
  // an accepted deletion takes its paragraph along: a rejected insertion
  // leaves the paragraph it was typed into, which the file holds.
  const blocks = decision === 'accept' ? wholeBlocks(tr.doc, drop) : []
  const inBlock = (s: Span) => blocks.some((b) => b.from <= s.from && b.to >= s.to)
  const deletions = [...blocks, ...drop.filter((s) => !inBlock(s))].sort((a, b) => b.from - a.from)
  const start = tr.steps.length
  for (const span of deletions) tr.delete(span.from, span.to)
  const after = tr.mapping.slice(start)

  if (annotate.length > 0) {
    const inputs: AnnotationInput[] = annotate.map(({ change, span, text }) => ({
      type: 'insertion',
      from: after.map(span.from, 1),
      to: after.map(span.to, -1),
      content: text,
      provenance: {
        model: change.actor.kind === 'prose-agent' ? change.actor.model : change.actor.kind === 'mcp-agent' ? (change.actor.model ?? '') : '',
        conversationId: '',
        messageId: '',
        actor: change.actor,
      },
    }))
    addAnnotationsTo(tr, inputs.filter((a) => a.to > a.from))
  }
  tr.setMeta(TRACKED_RESOLVED_META, true)
  return changes
}

/** Reject the remaining ranges of `ids` (the filter's "a deletion across another actor's insertion"). */
export function rejectRemainingIn(tr: Transaction, ids: readonly string[]): TrackedChange[] {
  return decideTrackedIn(tr, ids, 'reject')
}
