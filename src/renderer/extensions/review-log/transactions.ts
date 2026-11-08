/**
 * The review log's key, its intent meta and the helpers producers use to say
 * what a transaction did (#1233). A producer adds the intent to the
 * transaction that does the work, so the log changes with the document
 * (editor-state rule 3).
 */

import { PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { Actor } from '../../../shared/review/actor'
import type { FeedbackEntry, ReviewIntent, StoredReviewLog, SuggestionMarkInfo } from './log'
import { EMPTY_STORED } from './log'

export interface ReviewLogPluginState {
  log: StoredReviewLog
  /** The live suggestion marks, by id. */
  marks: ReadonlyMap<string, SuggestionMarkInfo>
  /** Bumped whenever `log` is replaced; every change is written at once. */
  revision: number
}

export const reviewLogPluginKey = new PluginKey<ReviewLogPluginState>('reviewLog')

function withIntent(tr: Transaction, patch: (intent: ReviewIntent) => ReviewIntent): Transaction {
  const current = (tr.getMeta(reviewLogPluginKey) as ReviewIntent | undefined) ?? {}
  return tr.setMeta(reviewLogPluginKey, patch(current))
}

/** These suggestions leave the document as `status`, decided by `by`. */
export function decideSuggestionsIn(tr: Transaction, ids: string[], status: 'accepted' | 'rejected', by: Actor): Transaction {
  if (ids.length === 0) return tr
  return withIntent(tr, (i) => ({ ...i, decided: [...(i.decided ?? []), { ids, status, by }] }))
}

/** The suggestion `to` replaces `from` (a revision by `by`). */
export function reviseSuggestionIn(tr: Transaction, from: string, to: string, by: Actor): Transaction {
  return withIntent(tr, (i) => ({ ...i, revised: [...(i.revised ?? []), { from, to, by }] }))
}

/** A feedback entry on a suggestion. */
export function feedbackIn(tr: Transaction, suggestionId: string, entry: FeedbackEntry): Transaction {
  return withIntent(tr, (i) => ({ ...i, feedback: [...(i.feedback ?? []), { suggestionId, entry }] }))
}

/** Who resolved or reopened the threads this transaction toggles. */
export function threadActorIn(tr: Transaction, by: Actor): Transaction {
  return withIntent(tr, (i) => ({ ...i, threadBy: by }))
}

/** Replace the log with stored rows (the seed, a dev remount). */
export function loadReviewLogInto(tr: Transaction, stored: StoredReviewLog | null | undefined): Transaction {
  return withIntent(tr, (i) => ({ ...i, load: stored ?? EMPTY_STORED }))
}

export function reviewLogPluginState(state: EditorState): ReviewLogPluginState | undefined {
  return reviewLogPluginKey.getState(state)
}

/** The document's review log, as stored. */
export function reviewLogOf(state: EditorState): StoredReviewLog {
  return reviewLogPluginState(state)?.log ?? EMPTY_STORED
}

/** For `useActiveSession`: the active document's log, reference-stable between changes; empty with no document. */
export function selectReviewLog(state: EditorState | null): StoredReviewLog {
  return state ? reviewLogOf(state) : EMPTY_STORED
}
