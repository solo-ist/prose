/**
 * The comment threads plugin's key, state and transaction metas (#1147).
 *
 * Comment marks stay in the document; the thread metadata the marks do not
 * carry (replies, resolved, anchorLost, author, share ids) lives in the
 * plugin state of each document's `EditorState`. A thread enters or changes
 * in a state only through that state's own transaction, carrying one of the
 * metas below; the plugin's `apply` runs the metas, then reconciles the
 * threads against the marks of the document being applied (`plugin.ts`).
 *
 * No DOM here: the popover, the review panel, the executors and the share
 * paths import this file; `plugin.ts` holds the decorations.
 */

import { PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'
import type { CommentData } from './types'

/** One comment mark's footprint in a document: every text node carrying it, and the aggregate range. */
export interface MarkSpan {
  id: string
  from: number
  to: number
  spans: ReadonlyArray<{ from: number; to: number }>
  comment: string
  createdAt: number
  occurrenceIndex: number
}

/** A share push a transition asks for; the session layer performs it (lib/sharePush.ts). */
export type SharePush =
  | { kind: 'thread'; threadId: string }
  | { kind: 'reply'; threadId: string; replyId: string }
  | { kind: 'resolve'; threadId: string }
  | { kind: 'remove'; thread: CommentData }

export interface CommentThreadsPluginState {
  /** Reference-stable: replaced only when at least one thread object changed. */
  threads: readonly CommentData[]
  /** The comment marks of the document, by thread id; rescanned on every document change. */
  marks: ReadonlyMap<string, MarkSpan>
  /** `comment-mark--pending` on the marks of open threads without replies. */
  decorations: DecorationSet
  /** Bumped whenever `threads` is replaced. */
  revision: number
  /** The revision of the last change that must reach IndexedDB at once: everything but a seed. */
  urgentRevision: number
  /** The pushes this transition produced; empty for every other transition. */
  pushes: readonly SharePush[]
  /** Bumped whenever `pushes` is non-empty, so the session layer performs each batch once. */
  pushRevision: number
}

/** What a transaction asks of the thread set, applied before the marks are reconciled. */
export interface ThreadMeta {
  /** Replace the set with stored rows (a seed, a dev remount). Not urgent; no pushes. */
  load?: CommentData[]
  /** Replace the set with a merged list (a share pull, an artifact import). Urgent; no pushes. */
  merge?: CommentData[]
  /** Threads to append; an id already present is superseded. */
  add?: CommentData[]
  update?: Array<{ id: string; patch: Partial<CommentData> }>
  remove?: string[]
  /** A share write-back (shareId, publishRev, a pulled edit): no push for this transition. */
  quiet?: boolean
}

export const commentThreadsPluginKey = new PluginKey<CommentThreadsPluginState>('commentThreads')

export const EMPTY_THREADS: readonly CommentData[] = Object.freeze([]) as readonly CommentData[]
export const EMPTY_PUSHES: readonly SharePush[] = Object.freeze([]) as readonly SharePush[]
export const EMPTY_MARKS: ReadonlyMap<string, MarkSpan> = new Map()

function metaOf(tr: Transaction): ThreadMeta {
  const existing = tr.getMeta(commentThreadsPluginKey) as ThreadMeta | undefined
  if (existing) return existing
  const meta: ThreadMeta = {}
  tr.setMeta(commentThreadsPluginKey, meta)
  return meta
}

/** Append threads to the document this transaction is applied to (their marks ride in the same transaction). */
export function addThreadsTo(tr: Transaction, threads: readonly CommentData[]): Transaction {
  if (threads.length === 0) return tr
  const meta = metaOf(tr)
  meta.add = meta.add ? [...meta.add, ...threads] : [...threads]
  return tr
}

export function updateThreadIn(
  tr: Transaction,
  id: string,
  patch: Partial<CommentData>,
  opts: { quiet?: boolean } = {}
): Transaction {
  const meta = metaOf(tr)
  meta.update = meta.update ? [...meta.update, { id, patch }] : [{ id, patch }]
  if (opts.quiet) meta.quiet = true
  return tr
}

export function removeThreadFrom(tr: Transaction, id: string, opts: { quiet?: boolean } = {}): Transaction {
  const meta = metaOf(tr)
  meta.remove = meta.remove ? [...meta.remove, id] : [id]
  if (opts.quiet) meta.quiet = true
  return tr
}

/** Replace the set with a merged list (a share pull, an artifact import); the caller marks the new threads. */
export function mergeThreadsInto(tr: Transaction, merged: readonly CommentData[]): Transaction {
  metaOf(tr).merge = [...merged]
  return tr
}

/** Seed the set from stored rows (a session open, a disk reload, a dev remount). */
export function loadThreadsInto(tr: Transaction, threads: readonly CommentData[]): Transaction {
  metaOf(tr).load = [...threads]
  return tr
}

/**
 * The plugin state of `state`. In dev, a hot-reloaded `plugin.ts` mints a
 * new key while the sessions still hold states built with the old one; the
 * fallback finds the plugin by its key's name so a remount carries the
 * threads over.
 */
export function threadPluginState(state: EditorState): CommentThreadsPluginState | undefined {
  const direct = commentThreadsPluginKey.getState(state)
  if (direct) return direct
  for (const plugin of state.plugins) {
    // `Plugin.key` (the key's name) is public at runtime but absent from the typings.
    const name = (plugin as unknown as { key: string }).key
    if (name.startsWith('commentThreads$')) return plugin.getState(state) as CommentThreadsPluginState | undefined
  }
  return undefined
}

/** The threads of `state`'s document (a stable reference while nothing changed). */
export function threadsOf(state: EditorState): readonly CommentData[] {
  return threadPluginState(state)?.threads ?? EMPTY_THREADS
}

/** Selector for `useActiveSession`: the active document's threads, or none. */
export function selectThreads(state: EditorState | null): readonly CommentData[] {
  return state ? threadsOf(state) : EMPTY_THREADS
}

/**
 * Open (unresolved) comment threads. The one predicate every counting
 * surface (status bar, chat chips, Comment Review, the share popover)
 * derives from, so the UI cannot render contradictory totals (#830). An
 * anchor-lost thread is open: the reviewer's comment outlives its text.
 */
export function countOpenThreads(threads: readonly CommentData[]): number {
  let n = 0
  for (const c of threads) if (!c.resolved) n++
  return n
}

/** Selector for `useActiveSession`: the active document's open-thread count. */
export function selectOpenThreadCount(state: EditorState | null): number {
  return countOpenThreads(selectThreads(state))
}
