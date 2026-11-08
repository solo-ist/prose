/**
 * The review-log plugin (#1233): runs after the comment, suggestion and
 * annotation plugins (priority 10), so `apply` reads the next document and the
 * next thread set, and folds them into the log through `nextLog`.
 */

import { Plugin } from '@tiptap/pm/state'
import { BUILD_META } from '../../document/identity'
import { threadPluginState, commentThreadsPluginKey, type ThreadMeta } from '../comments/transactions'
import { EMPTY_STORED, nextLog, scanSuggestionMarks, stepsMayAddSuggestion, type ReviewIntent } from './log'
import { reviewLogPluginKey, type ReviewLogPluginState } from './transactions'
import type { CommentData } from '../comments/types'

const NO_THREADS: readonly CommentData[] = []

export function createReviewLogPlugin(): Plugin<ReviewLogPluginState> {
  return new Plugin<ReviewLogPluginState>({
    key: reviewLogPluginKey,
    state: {
      init: (_config, state) => ({ log: EMPTY_STORED, marks: scanSuggestionMarks(state.doc), revision: 0 }),
      apply(tr, prev, oldState, newState) {
        const intent = tr.getMeta(reviewLogPluginKey) as ReviewIntent | undefined
        const threadMeta = tr.getMeta(commentThreadsPluginKey) as ThreadMeta | undefined
        // A seed, a dev remount or a stored-thread load derives no events.
        const quiet = tr.getMeta(BUILD_META) === true || intent?.load !== undefined || threadMeta?.load !== undefined

        // Rescan the marks only when it can matter: the document changed and
        // marks existed, or a step may have carried one in, or the
        // transaction says what it did (or loads the log).
        const rescan =
          intent !== undefined ||
          (tr.docChanged && (prev.marks.size > 0 || stepsMayAddSuggestion(tr)))
        const marks = rescan ? scanSuggestionMarks(newState.doc) : prev.marks

        const threadsBefore = threadPluginState(oldState)?.threads ?? NO_THREADS
        const threadsAfter = threadPluginState(newState)?.threads ?? NO_THREADS

        const log = nextLog({
          stored: prev.log,
          marksBefore: quiet ? marks : prev.marks,
          marksAfter: marks,
          threadsBefore,
          threadsAfter,
          intent,
          quiet,
          now: Date.now(),
        })
        // A seed backfills marks that have no history row (suggestions from
        // before 1.9.1) as pending, silently.
        const backfilled = quiet ? backfill(log, marks) : log
        if (backfilled === prev.log && marks === prev.marks) return prev
        return { log: backfilled, marks, revision: backfilled === prev.log ? prev.revision : prev.revision + 1 }
      },
    },
  })
}

function backfill(log: ReviewLogPluginState['log'], marks: ReviewLogPluginState['marks']): ReviewLogPluginState['log'] {
  if (marks.size === 0) return log
  const known = new Set(log.suggestions.map((s) => s.id))
  const missing = [...marks.values()].filter((m) => !known.has(m.id))
  if (missing.length === 0) return log
  const added = nextLog({
    stored: { ...log, suggestions: log.suggestions },
    marksBefore: new Map(),
    marksAfter: new Map(missing.map((m) => [m.id, m])),
    threadsBefore: NO_THREADS,
    threadsAfter: NO_THREADS,
    intent: undefined,
    quiet: true,
    now: Date.now(),
  })
  return added
}
