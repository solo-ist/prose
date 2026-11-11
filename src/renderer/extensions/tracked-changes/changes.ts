/**
 * Reading the tracked changes of a document (#891): pure functions over a
 * ProseMirror document. A change is every range carrying its id, insertions
 * and deletions together.
 */

import type { Mark, Node as PMNode, Schema } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { SELF, type Actor } from '../../../shared/review/actor'
import { TRACKED_DELETE, TRACKED_INSERT } from './marks'

export type TrackedKind = 'insert' | 'delete'

export interface TrackedRange {
  from: number
  to: number
  kind: TrackedKind
  text: string
}

export interface TrackedChange {
  id: string
  actor: Actor
  createdAt: number
  /** In document order. */
  ranges: TrackedRange[]
  /** The proposal as the review log types it (`edit` = a replacement). */
  type: 'insertion' | 'deletion' | 'edit'
  /** The deleted text, joined; '' for a pure insertion. */
  deletedText: string
  /** The inserted text, joined; '' for a pure deletion. */
  insertedText: string
  from: number
  to: number
}

/** Placeholder for a non-text inline node (an image, a hard break) in change text. */
export const ATOM = '￼'

export function trackedMarkOf(marks: readonly Mark[]): Mark | null {
  for (const mark of marks) {
    const name = mark.type.name
    if (name === TRACKED_INSERT || name === TRACKED_DELETE) return mark
  }
  return null
}

export function kindOf(mark: Mark): TrackedKind {
  return mark.type.name === TRACKED_INSERT ? 'insert' : 'delete'
}

export function inlineText(node: PMNode): string {
  return node.isText ? (node.text ?? '') : ATOM
}

/** Two actors are the same author: the writer, or the same agent on the same connection or model. */
export function sameActor(a: Actor | null | undefined, b: Actor | null | undefined): boolean {
  const x = a ?? SELF
  const y = b ?? SELF
  if (x.kind !== y.kind) return false
  switch (x.kind) {
    case 'human':
      return y.kind === 'human' && x.self === y.self && (x.self || x.name === y.name)
    case 'prose-agent':
      return y.kind === 'prose-agent' && x.provider === y.provider && x.model === y.model
    case 'mcp-agent':
      return y.kind === 'mcp-agent' && x.connectionId === y.connectionId && (x.client ?? '') === (y.client ?? '')
    case 'unattributed':
      return y.kind === 'unattributed' && x.label === y.label
  }
}

const cache = new WeakMap<PMNode, TrackedChange[]>()

/** Every tracked change of `doc`, in document order of their first range. Cached per document. */
export function trackedChangesIn(doc: PMNode): TrackedChange[] {
  const hit = cache.get(doc)
  if (hit) return hit
  const byId = new Map<string, TrackedChange>()
  doc.descendants((node, pos) => {
    if (!node.isInline) return true
    const mark = trackedMarkOf(node.marks)
    if (!mark) return false
    const id = mark.attrs.id as string | null
    if (!id) return false
    const kind = kindOf(mark)
    let change = byId.get(id)
    if (!change) {
      change = {
        id,
        actor: (mark.attrs.actor as Actor | null) ?? SELF,
        createdAt: (mark.attrs.createdAt as number) || 0,
        ranges: [],
        type: kind === 'insert' ? 'insertion' : 'deletion',
        deletedText: '',
        insertedText: '',
        from: pos,
        to: pos + node.nodeSize,
      }
      byId.set(id, change)
    }
    const text = inlineText(node)
    const last = change.ranges[change.ranges.length - 1]
    if (last && last.kind === kind && last.to === pos) {
      last.to = pos + node.nodeSize
      last.text += text
    } else {
      change.ranges.push({ from: pos, to: pos + node.nodeSize, kind, text })
    }
    if (kind === 'insert') change.insertedText += text
    else change.deletedText += text
    change.to = Math.max(change.to, pos + node.nodeSize)
    return false
  })
  const changes = [...byId.values()]
  for (const change of changes) {
    const kinds = new Set(change.ranges.map((r) => r.kind))
    change.type = kinds.size === 2 ? 'edit' : kinds.has('insert') ? 'insertion' : 'deletion'
  }
  cache.set(doc, changes)
  return changes
}

export function trackedChangeById(doc: PMNode, id: string): TrackedChange | null {
  return trackedChangesIn(doc).find((c) => c.id === id) ?? null
}

/** Does `doc` hold any tracked change? (Cheap after the first call per document.) */
export function hasTrackedChanges(doc: PMNode): boolean {
  return trackedChangesIn(doc).length > 0
}

export function trackedMarkTypes(schema: Schema) {
  const insert = schema.marks[TRACKED_INSERT]
  const remove = schema.marks[TRACKED_DELETE]
  if (!insert || !remove) throw new Error('[tracked-changes] marks missing from the schema')
  return { insert, remove }
}

/** For `useActiveSession`: how many tracked changes the active document holds. */
export function selectTrackedCount(state: EditorState | null): number {
  return state ? trackedChangesIn(state.doc).length : 0
}

/** For `useActiveSession`: the active document's tracked changes (reference-stable per document). */
export function selectTrackedChanges(state: EditorState | null): TrackedChange[] {
  return state ? trackedChangesIn(state.doc) : NO_CHANGES
}

const NO_CHANGES: TrackedChange[] = []
