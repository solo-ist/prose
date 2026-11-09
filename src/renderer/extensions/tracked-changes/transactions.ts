/**
 * The tracked-changes plugin's key, state and metas (#891). The plugin state
 * is one flag: whether the writer's edits in this document are rewritten into
 * tracked changes (Suggesting mode, design §3). It lives in the `EditorState`
 * so the filter reads it from the state it rewrites, and it is per tab because
 * every tab has its own state. The session layer seeds it from the tab record
 * and is the only writer of the record (`setSessionSuggesting`).
 */

import { PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

export interface TrackedChangesPluginState {
  suggesting: boolean
}

export const trackedChangesPluginKey = new PluginKey<TrackedChangesPluginState>('trackedChanges')

/** Meta: `{ suggesting: boolean }` switches Suggesting mode for the document. */
export const SUGGESTING_META = 'trackedSuggesting'

/**
 * Meta on a transaction the filter must pass untouched: a tool's write through
 * a `DocumentHandle`, an agent's proposal, a decision. Only the writer's own
 * input is rewritten.
 */
export const TRACK_SKIP_META = 'trackedSkip'

/** Meta on a transaction the filter produced (the session persists at once when a change appears or goes). */
export const TRACKED_META = 'trackedRewritten'

/** Meta set by the accept and reject commands: a decision, persisted at once (an empty set included). */
export const TRACKED_RESOLVED_META = 'trackedResolved'

export function setSuggestingIn(tr: Transaction, suggesting: boolean): Transaction {
  return tr.setMeta(SUGGESTING_META, { suggesting }).setMeta('addToHistory', false).setMeta(TRACK_SKIP_META, true)
}

export function trackedChangesPluginState(state: EditorState): TrackedChangesPluginState | undefined {
  return trackedChangesPluginKey.getState(state)
}

/** Is Suggesting mode on in this document? */
export function isSuggesting(state: EditorState | null | undefined): boolean {
  return state ? trackedChangesPluginState(state)?.suggesting === true : false
}
