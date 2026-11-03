/**
 * The annotations plugin's key, state and transaction metas (#1146).
 *
 * AI annotation records live in the plugin state of each document's
 * `EditorState`. A record enters a state only through that state's own
 * transaction, carrying one of the metas below; the plugin's `apply` maps
 * the existing records through the transaction first and then applies the
 * meta, so a command that replaces text and annotates the replacement does
 * both in one dispatch. The plugin stamps `documentId` and `anchorText` from
 * the state the record enters, which is why `AnnotationInput` has neither.
 *
 * No DOM here: the executors, the suggestion accept paths and the word-diff
 * builder import this file; `plugin.ts` holds the decorations and tooltip.
 */

import { PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'
import type { AIAnnotation } from '../../types/annotations'
import { generateId } from '../../lib/persistence'
import { pipelineLog } from '../../lib/aiPipelineLog'

export interface AIAnnotationsPluginState {
  /** Reference-stable: replaced only when at least one record object changed. */
  records: readonly AIAnnotation[]
  decorations: DecorationSet
  /** When the age-based opacity was last recomputed. */
  lastRefresh: number
  /** Bumped whenever `records` is replaced. */
  revision: number
  /**
   * The revision of the last change that must be written at once: an add, a
   * remove, a detach, a split, a re-anchoring, an identity restamp. A plain
   * move under position mapping, or an `anchorText` refresh, is not urgent.
   */
  urgentRevision: number
}

/** What a transaction asks of the record set, applied after position mapping. */
export interface AnnotationMeta {
  /** Replace the set with stored rows, re-anchored onto this document (a seed). */
  load?: AIAnnotation[]
  /** Records to append; positions are in the document after the transaction's steps. */
  add?: AIAnnotation[]
  remove?: string[]
  removeRange?: Array<{ from: number; to: number }>
}

/** A record as a caller describes it; the plugin stamps the rest. */
export type AnnotationInput = Omit<AIAnnotation, 'id' | 'createdAt' | 'documentId' | 'anchorText' | 'detached'> & {
  id?: string
  createdAt?: number
}

export const aiAnnotationsPluginKey = new PluginKey<AIAnnotationsPluginState>('aiAnnotations')

export const EMPTY_ANNOTATIONS: readonly AIAnnotation[] = Object.freeze([]) as readonly AIAnnotation[]

function metaOf(tr: Transaction): AnnotationMeta {
  const existing = tr.getMeta(aiAnnotationsPluginKey) as AnnotationMeta | undefined
  if (existing) return existing
  const meta: AnnotationMeta = {}
  tr.setMeta(aiAnnotationsPluginKey, meta)
  return meta
}

/**
 * Append records to the document this transaction is applied to. `id` and
 * `createdAt` are minted here (so a test can assert them); `documentId` and
 * `anchorText` are stamped by the plugin from the state.
 */
export function addAnnotationsTo(tr: Transaction, inputs: readonly AnnotationInput[]): Transaction {
  if (inputs.length === 0) return tr
  const records: AIAnnotation[] = inputs.map((input) => ({
    ...input,
    id: input.id ?? generateId(),
    createdAt: input.createdAt ?? Date.now(),
    documentId: ''
  }))
  for (const record of records) {
    pipelineLog('annotation:create', {
      id: record.id,
      from: record.from,
      to: record.to,
      type: record.type,
      content: record.content?.substring(0, 30)
    })
  }
  const meta = metaOf(tr)
  meta.add = meta.add ? [...meta.add, ...records] : records
  return tr
}

export function removeAnnotationFrom(tr: Transaction, id: string): Transaction {
  const meta = metaOf(tr)
  meta.remove = meta.remove ? [...meta.remove, id] : [id]
  return tr
}

export function removeAnnotationsInRangeFrom(tr: Transaction, from: number, to: number): Transaction {
  const meta = metaOf(tr)
  const range = { from, to }
  meta.removeRange = meta.removeRange ? [...meta.removeRange, range] : [range]
  return tr
}

/** Seed the set from stored rows (a session open, a disk reload, a dev remount). */
export function loadAnnotationsInto(tr: Transaction, records: readonly AIAnnotation[]): Transaction {
  metaOf(tr).load = [...records]
  return tr
}

/**
 * The plugin state of `state`. In dev, a hot-reloaded `plugin.ts` mints a
 * new key while the sessions still hold states built with the old one; the
 * fallback finds the plugin by its key's name so a remount carries the
 * records over.
 */
export function annotationPluginState(state: EditorState): AIAnnotationsPluginState | undefined {
  const direct = aiAnnotationsPluginKey.getState(state)
  if (direct) return direct
  for (const plugin of state.plugins) {
    // `Plugin.key` (the key's name) is public at runtime but absent from the typings.
    const name = (plugin as unknown as { key: string }).key
    if (name.startsWith('aiAnnotations$')) return plugin.getState(state) as AIAnnotationsPluginState | undefined
  }
  return undefined
}

/** The records of `state`'s document (a stable reference while nothing moved). */
export function annotationsOf(state: EditorState): readonly AIAnnotation[] {
  return annotationPluginState(state)?.records ?? EMPTY_ANNOTATIONS
}

/** Selector for `useActiveSession`: the active document's records, or none. */
export function selectAnnotations(state: EditorState | null): readonly AIAnnotation[] {
  return state ? annotationsOf(state) : EMPTY_ANNOTATIONS
}
