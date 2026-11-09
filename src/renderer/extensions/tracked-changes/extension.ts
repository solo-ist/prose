/**
 * Tracked changes (#891): Suggesting mode's plugin state, the writer's
 * decisions, and the filter around the view's dispatch.
 */

import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { SELF, type Actor } from '../../../shared/review/actor'
import { decideSuggestionsIn, feedbackIn } from '../review-log/transactions'
import { AI_SUGGESTION_RESOLVED_META } from '../ai-suggestions/extension'
import { ACTIVATED_META, BUILD_META, IDENTITY_META, RELOAD_META } from '../../document/identity'
import { generateId } from '../../lib/persistence'
import { trackedChangesIn } from './changes'
import { decideTrackedIn } from './decide'
import { trackTransaction, type RefusalReason } from './filter'
import {
  SUGGESTING_META,
  TRACK_SKIP_META,
  TRACKED_RESOLVED_META,
  isSuggesting,
  trackedChangesPluginKey,
  type TrackedChangesPluginState,
} from './transactions'

export interface TrackedChangesOptions {
  /** The writer's edit could not be tracked (P3 tracks text within a paragraph). */
  onRefused?: (reason: RefusalReason) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    trackedChanges: {
      /** Accept a tracked change: an insertion stays, deleted text goes. */
      acceptTrackedChange: (id: string, by?: Actor) => ReturnType
      /** Reject a tracked change: inserted text goes, deleted text stays. */
      rejectTrackedChange: (id: string, by?: Actor) => ReturnType
      acceptAllTrackedChanges: (by?: Actor) => ReturnType
      rejectAllTrackedChanges: (by?: Actor) => ReturnType
      /** Feedback on a tracked change, kept in the review log (#1233). */
      replyToTrackedChange: (id: string, text: string, by?: Actor) => ReturnType
    }
  }
}

function decide(ids: string[], decision: 'accept' | 'reject', by: Actor | undefined) {
  return ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }): boolean => {
    if (ids.length === 0) return false
    if (!dispatch) return trackedChangesIn(tr.doc).some((c) => ids.includes(c.id))
    const decided = decideTrackedIn(tr, ids, decision)
    if (decided.length === 0) return false
    decideSuggestionsIn(tr, decided.map((c) => c.id), decision === 'accept' ? 'accepted' : 'rejected', by ?? SELF)
    tr.setMeta(TRACK_SKIP_META, true)
    return true
  }
}

export const TrackedChanges = Extension.create<TrackedChangesOptions>({
  name: 'trackedChanges',

  addOptions() {
    return { onRefused: undefined }
  },

  addCommands() {
    return {
      acceptTrackedChange: (id, by) => decide([id], 'accept', by),
      rejectTrackedChange: (id, by) => decide([id], 'reject', by),
      acceptAllTrackedChanges: (by) => ({ tr, dispatch }) => decide(trackedChangesIn(tr.doc).map((c) => c.id), 'accept', by)({ tr, dispatch }),
      rejectAllTrackedChanges: (by) => ({ tr, dispatch }) => decide(trackedChangesIn(tr.doc).map((c) => c.id), 'reject', by)({ tr, dispatch }),
      replyToTrackedChange:
        (id, text, by) =>
        ({ tr, dispatch }) => {
          const body = text.trim()
          if (!body || !trackedChangesIn(tr.doc).some((c) => c.id === id)) return false
          if (!dispatch) return true
          feedbackIn(tr, id, { id: generateId(), actor: by ?? SELF, text: body, createdAt: Date.now() })
          tr.setMeta(TRACK_SKIP_META, true)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<TrackedChangesPluginState>({
        key: trackedChangesPluginKey,
        state: {
          init: () => ({ suggesting: false }),
          apply(tr, prev) {
            const meta = tr.getMeta(SUGGESTING_META) as { suggesting: boolean } | undefined
            if (!meta || meta.suggesting === prev.suggesting) return prev
            return { suggesting: meta.suggesting }
          },
        },
      }),
    ]
  },
})

/** Metas that mark a transaction as not the writer's typing. */
const PROGRAMMATIC_METAS = [
  TRACK_SKIP_META,
  TRACKED_RESOLVED_META,
  AI_SUGGESTION_RESOLVED_META,
  RELOAD_META,
  BUILD_META,
  IDENTITY_META,
  ACTIVATED_META,
  'appendedTransaction',
]

/** Is this transaction the writer's input in Suggesting mode, to be rewritten? */
export function shouldTrack(tr: Transaction, suggesting: boolean): boolean {
  if (!suggesting || !tr.docChanged) return false
  // Undo and redo replay history as it was (§2: undoing reopens, it doesn't track).
  if (tr.getMeta('history$') !== undefined) return false
  if (tr.getMeta('addToHistory') === false) return false
  return !PROGRAMMATIC_METAS.some((meta) => tr.getMeta(meta) !== undefined)
}

const INSTALLED = Symbol('trackedDispatch')

/**
 * Put the filter in front of TipTap's dispatch on `editor`'s view (the
 * session layer calls this when it attaches the editor). Only the view's
 * transactions are the writer's input; a background tab's state is written by
 * tools and the session, never by typing.
 */
export function installTrackedDispatch(editor: Editor): void {
  const view = editor.view
  const base = view.props.dispatchTransaction as ((this: EditorView, tr: Transaction) => void) & { [INSTALLED]?: true }
  if (!base || base[INSTALLED]) return
  const options = editor.extensionManager.extensions.find((e) => e.name === 'trackedChanges')?.options as TrackedChangesOptions | undefined
  const wrapped = function (this: EditorView, tr: Transaction): void {
    const state = view.state
    if (shouldTrack(tr, isSuggesting(state))) {
      const result = trackTransaction(state, tr, { actor: SELF, now: Date.now(), newId: generateId, composing: view.composing })
      if (result.kind === 'refused') {
        // Dropped: the view redraws what the DOM may already show.
        options?.onRefused?.(result.reason)
        return
      }
      if (result.kind === 'tracked') tr = result.tr
    }
    base.call(this, tr)
  } as typeof base
  wrapped[INSTALLED] = true
  view.setProps({ dispatchTransaction: wrapped })
}
