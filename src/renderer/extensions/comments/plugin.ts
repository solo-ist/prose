/**
 * Comment threads ProseMirror plugin (#1147).
 *
 * Owns the thread metadata of its document and paints the pending-state
 * decoration on the marks of open threads without replies. `apply` is the
 * one place the thread set changes: the transaction's metas run first
 * (load, merge, add, update, remove), then the threads are reconciled
 * against the marks of the document being applied. A user's edit that
 * deletes a comment's text resolves the thread (#928); an AI replacement
 * that drops the mark leaves the thread open as anchor-lost (#1099); a mark
 * that comes back (an undo) reopens and re-anchors; the seed, a reload and a
 * merge only set anchor-lost. Share pushes are recorded on the state by
 * diff and performed by the session layer (document/session.ts); nothing
 * here touches the network.
 */

import { Plugin } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ACTIVATED_META, BUILD_META, RELOAD_META } from '../../document/identity'
import type { CommentData } from './types'
import {
  commentThreadsPluginKey,
  EMPTY_MARKS,
  EMPTY_PUSHES,
  EMPTY_THREADS,
  type CommentThreadsPluginState,
  type MarkSpan,
  type ThreadMeta
} from './transactions'
import {
  applyThreadMetas,
  diffPushes,
  marksEqual,
  reconcileThreads,
  scanMarks,
  transactionInsertsCommentMarks
} from './threads'

export { commentThreadsPluginKey } from './transactions'

/**
 * Transaction meta marking a programmatic AI replacement — an accepted
 * suggestion or an `edit`/`insert` tool write (#1099). Those build mark-free
 * content, so any comment anchored in the replaced range vanishes without the
 * writer having deleted anything; the thread stays open as anchor-lost
 * instead of resolving.
 */
export const AI_REPLACEMENT_META = 'aiReplacement'

function buildDecorations(doc: PMNode, threads: readonly CommentData[], marks: ReadonlyMap<string, MarkSpan>): DecorationSet {
  if (marks.size === 0) return DecorationSet.empty
  const byId = new Map(threads.map((c) => [c.id, c]))
  const decorations: Decoration[] = []
  for (const span of marks.values()) {
    const thread = byId.get(span.id)
    const pending = thread ? !thread.resolved && (thread.replies?.length ?? 0) === 0 : true
    if (!pending) continue
    for (const s of span.spans) decorations.push(Decoration.inline(s.from, s.to, { class: 'comment-mark--pending' }))
  }
  return DecorationSet.create(doc, decorations)
}

export function createCommentThreadsPlugin() {
  return new Plugin<CommentThreadsPluginState>({
    key: commentThreadsPluginKey,

    state: {
      // Every state starts empty; threads arrive through a `load` meta on the
      // session's seed transaction (document/session.ts).
      init() {
        return {
          threads: EMPTY_THREADS,
          marks: EMPTY_MARKS,
          decorations: DecorationSet.empty,
          revision: 0,
          urgentRevision: 0,
          pushes: EMPTY_PUSHES,
          pushRevision: 0
        }
      },

      apply(tr: Transaction, prev, _oldState, newState) {
        const meta = tr.getMeta(commentThreadsPluginKey) as ThreadMeta | undefined
        if (!tr.docChanged && !meta) return prev
        const doc = newState.doc

        let threads = prev.threads
        if (meta) threads = applyThreadMetas(threads, meta)

        // The marks are rescanned when the document changed and there is
        // anything to reconcile: threads, marks, or steps that bring a mark
        // in (pasted commented text). A document without comments pays
        // nothing for a keystroke.
        let marks = prev.marks
        const scan =
          tr.docChanged && (threads.length > 0 || prev.marks.size > 0 || transactionInsertsCommentMarks(tr))
        if (scan) marks = scanMarks(doc)

        if (scan || meta) {
          const swap =
            tr.getMeta(RELOAD_META) === true || tr.getMeta(ACTIVATED_META) === true || tr.getMeta(BUILD_META) === true
          const mode = tr.docChanged && !swap && !meta?.load && !meta?.merge ? 'edit' : 'reconcile'
          const outcome = reconcileThreads(
            threads,
            prev.marks,
            marks,
            mode,
            tr.getMeta(AI_REPLACEMENT_META) === true,
            doc
          )
          threads = outcome.threads
        }

        const changed = threads !== prev.threads
        const marksChanged = marks !== prev.marks && !marksEqual(prev.marks, marks)
        // Nothing to carry: no thread changed, the marks are where they were
        // (or there are none, so there is nothing to map).
        if (!changed && !marksChanged && (!tr.docChanged || prev.marks.size === 0)) return prev

        const decorations =
          changed || marksChanged ? buildDecorations(doc, threads, marks) : prev.decorations.map(tr.mapping, doc)
        const revision = changed ? prev.revision + 1 : prev.revision
        const quiet = meta?.quiet === true || meta?.load !== undefined || meta?.merge !== undefined
        const pushes = changed && !quiet ? diffPushes(prev.threads, threads) : []
        // A transaction with no pushes of its own carries the previous ones:
        // they belong to `prev.pushRevision`, which the session reads once
        // per revision (document/session.ts afterTransaction). An appended
        // transaction (node ids after a paste, say) landing in the same
        // applyTransaction must not drop what the main one recorded (#1152).
        return {
          threads,
          marks: marksChanged ? marks : prev.marks,
          decorations,
          revision,
          urgentRevision: changed && !meta?.load ? revision : prev.urgentRevision,
          pushes: pushes.length > 0 ? pushes : prev.pushes,
          pushRevision: pushes.length > 0 ? prev.pushRevision + 1 : prev.pushRevision
        }
      }
    },

    props: {
      decorations(state) {
        return commentThreadsPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      }
    }
  })
}
