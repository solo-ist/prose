/**
 * Suggesting mode's filter (#891; design: docs/architecture/suggesting-mode.md
 * §3, plan decisions 2 to 7): a pure function from a transaction to its
 * tracked form. The original transaction is never applied. Its steps are
 * replayed, one by one, onto a fresh transaction from the same state, the
 * way `@handlewithcare/prosemirror-suggest-changes` does it (docs/issues/891/
 * spike.md): each step's positions are mapped back through the earlier
 * original steps and forward through the tracked ones.
 *
 * The rules, per replace step, inside one textblock:
 * - inserted content is marked `trackedInsert` with the actor;
 * - deleted text is not deleted: it is marked `trackedDelete`;
 * - text of the actor's own pending insertion is deleted for real (fixing
 *   your own typo);
 * - text of another actor's pending insertion is deleted, and that whole
 *   change is rejected, decided by the actor;
 * - text already proposed for deletion stays as it is;
 * - an edit next to the actor's own pending change joins its id, and a
 *   replacement's deletion and insertion share one id (§2).
 *
 * Mark steps (formatting) and node-type changes pass through as they are
 * (§3). A step that would add or remove a block boundary, or change text where
 * the parent allows no marks (a code block), is refused: P3 tracks text only,
 * and nothing untracked may enter the document while Suggesting is on (the
 * file holds the original, §8.1).
 */

import { Fragment, type Mark, type Node as PMNode, type Slice } from '@tiptap/pm/model'
import { Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Mapping, ReplaceAroundStep, ReplaceStep, type Step } from '@tiptap/pm/transform'
import type { Actor } from '../../../shared/review/actor'
import { decideSuggestionsIn } from '../review-log/transactions'
import { kindOf, sameActor, trackedMarkOf, trackedMarkTypes } from './changes'
import { rejectRemainingIn } from './decide'
import { TRACKED_META } from './transactions'

export interface TrackContext {
  actor: Actor
  now: number
  newId: () => string
  /** An IME composition is running: a replacement inserts where the composition is, before the deleted text. */
  composing?: boolean
}

/** Why an edit can't be tracked in P3; the caller tells the writer. */
export type RefusalReason = 'structure' | 'no-marks'

export type TrackResult =
  | { kind: 'pass' }
  | { kind: 'tracked'; tr: Transaction; ids: string[]; rejected: string[] }
  | { kind: 'refused'; reason: RefusalReason }

class Refused extends Error {
  constructor(readonly reason: RefusalReason) {
    super(reason)
  }
}

function isTrackedMark(mark: Mark): boolean {
  return trackedMarkOf([mark]) !== null
}

/**
 * The inline content a slice puts into one textblock, or null when it carries
 * block structure: a flat inline slice, or one textblock opened on both sides
 * (a paste of part of a paragraph, from a list item or a quote included).
 */
export function flatInline(slice: Slice): Fragment | null {
  if (slice.size === 0) return Fragment.empty
  if (slice.openStart !== slice.openEnd) return null
  let content = slice.content
  let open = slice.openStart
  while (open > 0) {
    if (content.childCount !== 1) return null
    const child = content.firstChild!
    if (child.isTextblock) return open === 1 ? child.content : null
    if (child.isLeaf) return null
    content = child.content
    open--
  }
  let inline = true
  content.forEach((node) => {
    if (!node.isInline) inline = false
  })
  return inline ? content : null
}

interface ChangeAttrs {
  id: string
  actor: Actor
  createdAt: number
}

/**
 * The actor's own pending change right next to `from`..`to` in the same
 * textblock, if any: an edit there joins it (§2), with its very attributes,
 * so the new text's mark equals the old one's and the runs merge.
 */
function adjacentChange(doc: PMNode, from: number, to: number, actor: Actor): ChangeAttrs | null {
  const candidates = [doc.resolve(from).nodeBefore, doc.resolve(to).nodeAfter]
  for (const node of candidates) {
    const mark = node ? trackedMarkOf(node.marks) : null
    if (mark && sameActor(mark.attrs.actor as Actor | null, actor) && mark.attrs.id) {
      return { id: mark.attrs.id as string, actor: (mark.attrs.actor as Actor | null) ?? actor, createdAt: (mark.attrs.createdAt as number) || 0 }
    }
  }
  return null
}

function hasInline(doc: PMNode, from: number, to: number): boolean {
  if (from >= to) return false
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (found) return false
    if (node.isInline) found = true
    return !found
  })
  return found
}

interface ReplaceOutcome {
  id: string | null
  /** Where the caret goes, in the tracked transaction's document. */
  caret: number | null
}

/**
 * One replace step, tracked: `from`..`to` and `slice` are already rebased onto
 * `out.doc`. `direction` says which side of a collapsed-cursor deletion the
 * caret was on (Backspace: after the text, so it ends before it).
 */
function trackReplace(
  out: Transaction,
  from: number,
  to: number,
  slice: Slice,
  ctx: TrackContext,
  rejected: Set<string>,
  direction: 'backward' | 'forward' | null
): ReplaceOutcome {
  const doc = out.doc
  const { insert: insertType, remove: deleteType } = trackedMarkTypes(doc.type.schema)
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  const parent = $from.parent
  if (!parent.isTextblock) throw new Refused('structure')
  if (from < to && !$from.sameParent($to)) throw new Refused('structure')
  const inline = flatInline(slice)
  if (inline === null) throw new Refused('structure')
  if (from === to && inline.size === 0) return { id: null, caret: null }
  if (!parent.type.allowsMarkType(insertType) || !parent.type.allowsMarkType(deleteType)) throw new Refused('no-marks')
  if (inline.size > 0 && !parent.canReplace($from.index(), $from.index(), inline)) throw new Refused('structure')

  const attrs: ChangeAttrs = adjacentChange(doc, from, to, ctx.actor) ?? { id: ctx.newId(), actor: ctx.actor, createdAt: ctx.now }
  const id = attrs.id

  // The deleted range, inline node by inline node.
  const toMark: Array<[number, number]> = []
  const toDelete: Array<[number, number]> = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    if (start >= end) return false
    const mark = trackedMarkOf(node.marks)
    if (!mark) {
      toMark.push([start, end])
    } else if (kindOf(mark) === 'insert') {
      toDelete.push([start, end])
      if (!sameActor(mark.attrs.actor as Actor | null, ctx.actor) && mark.attrs.id) rejected.add(mark.attrs.id as string)
    }
    // Already proposed for deletion: it stays as it is.
    return false
  })
  for (const [start, end] of toMark) out.addMark(start, end, deleteType.create(attrs))
  const before = out.steps.length
  for (let i = toDelete.length - 1; i >= 0; i--) out.delete(toDelete[i][0], toDelete[i][1])
  const local = out.mapping.slice(before)
  const mappedFrom = local.map(from, -1)
  const mappedTo = local.map(to, 1)

  if (inline.size > 0) {
    // After the deleted text (a replacement reads deleted-then-inserted),
    // except while an IME composes: the composition's text is where the
    // browser put it, at the start.
    const at = ctx.composing && from < to ? mappedFrom : mappedTo
    const nodes: PMNode[] = []
    inline.forEach((node) => {
      nodes.push(node.mark(insertType.create(attrs).addToSet(node.marks.filter((m) => !isTrackedMark(m)))))
    })
    const content = Fragment.from(nodes)
    out.insert(at, content)
    return { id, caret: at + content.size }
  }
  if (toMark.length === 0 && toDelete.length === 0) return { id: null, caret: direction === 'forward' ? mappedTo : mappedFrom }
  return { id: toMark.length > 0 ? id : null, caret: direction === 'backward' ? mappedFrom : mappedTo }
}

/** Map a position of `tr.docs[index]` back to the original document and forward onto `out.doc`. */
function rebase(pos: number, original: readonly Step[], index: number, out: Transaction, assoc: number): number {
  let p = pos
  for (let i = index - 1; i >= 0; i--) p = original[i].getMap().invert().map(p, assoc)
  return out.mapping.map(p, 1)
}

/**
 * The tracked form of `tr`, a transaction built from `state` by the writer's
 * input while Suggesting mode is on. `pass` when nothing in it changes text,
 * `refused` when P3 can't track it.
 */
export function trackTransaction(state: EditorState, tr: Transaction, ctx: TrackContext): TrackResult {
  if (!tr.docChanged || tr.before !== state.doc) return { kind: 'pass' }
  const textSteps = tr.steps.some((step) => step instanceof ReplaceStep || step instanceof ReplaceAroundStep)
  if (!textSteps) return { kind: 'pass' }

  const out = state.tr
  const rejected = new Set<string>()
  const ids: string[] = []
  let caret: number | null = null
  try {
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i]
      if (step instanceof ReplaceStep) {
        const from = rebase(step.from, tr.steps, i, out, -1)
        const to = Math.max(from, rebase(step.to, tr.steps, i, out, 1))
        let direction: 'backward' | 'forward' | null = null
        if (tr.steps.length === 1 && state.selection.empty && step.slice.size === 0) {
          if (state.selection.head === step.to) direction = 'backward'
          else if (state.selection.head === step.from) direction = 'forward'
        }
        const outcome = trackReplace(out, from, to, step.slice, ctx, rejected, direction)
        if (outcome.id && !ids.includes(outcome.id)) ids.push(outcome.id)
        if (outcome.caret !== null) caret = outcome.caret
        continue
      }
      if (step instanceof ReplaceAroundStep) {
        // A wrap, a lift, a node-type change: applied directly (§3), unless it
        // would drop text on the way.
        const doc = tr.docs[i]
        if (hasInline(doc, step.from, step.gapFrom) || hasInline(doc, step.gapTo, step.to)) throw new Refused('structure')
      }
      // Formatting and every other step: rebased and applied as it is.
      let mapped: Step | null = step
      for (let j = i - 1; j >= 0 && mapped; j--) mapped = mapped.map(tr.steps[j].getMap().invert())
      if (mapped) mapped = mapped.map(out.mapping)
      if (mapped) out.step(mapped)
    }
  } catch (error) {
    if (error instanceof Refused) return { kind: 'refused', reason: error.reason }
    throw error
  }

  if (rejected.size > 0) {
    // Another actor's insertion the writer deleted across is rejected whole (§3).
    rejectRemainingIn(out, [...rejected])
    decideSuggestionsIn(out, [...rejected], 'rejected', ctx.actor)
  }

  if (caret !== null) {
    out.setSelection(TextSelection.near(out.doc.resolve(Math.min(caret, out.doc.content.size))))
  } else if (tr.selectionSet) {
    const back = new Mapping()
    for (let i = tr.steps.length - 1; i >= 0; i--) back.appendMap(tr.steps[i].getMap().invert())
    const head = out.mapping.map(back.map(tr.selection.head), 1)
    const anchor = out.mapping.map(back.map(tr.selection.anchor), 1)
    try {
      out.setSelection(TextSelection.between(out.doc.resolve(anchor), out.doc.resolve(head)))
    } catch {
      out.setSelection(Selection.near(out.doc.resolve(Math.min(head, out.doc.content.size))))
    }
  }
  if (tr.storedMarksSet) out.setStoredMarks(tr.storedMarks ? tr.storedMarks.filter((m) => !isTrackedMark(m)) : null)
  if (tr.scrolledIntoView) out.scrollIntoView()
  out.setTime(tr.time)
  // Every meta of the original rides along (addToHistory, uiEvent, the
  // composition id the history groups by), then ours.
  const meta = (tr as unknown as { meta: Record<string, unknown> }).meta
  for (const key of Object.keys(meta)) {
    if (out.getMeta(key) === undefined) out.setMeta(key, meta[key])
  }
  out.setMeta(TRACKED_META, true)
  return { kind: 'tracked', tr: out, ids, rejected: [...rejected] }
}
