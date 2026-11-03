/**
 * Document identity as ProseMirror plugin state (#1145).
 *
 * Every per-tab `EditorState` carries the id, path and plain-text flag of the
 * document it holds. Plugins that mirror or mutate a global store compare this
 * against the store's own id, so a transaction on one document can never read
 * or write another document's records, whatever the timing. The session layer
 * (document/session.ts) stamps it when a state is created and restamps it on
 * rename or Save As; nothing else writes it.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

export interface IdentityState {
  documentId: string
  path: string | null
  /** A `.txt` document: plain-text mode flattens structure and strips marks. */
  plain: boolean
}

export const identityKey = new PluginKey<IdentityState>('documentIdentity')

/** Transaction meta carrying an `IdentityState`: stamps or restamps the document. */
export const IDENTITY_META = 'documentIdentity'
/** Meta on the transaction dispatched once a session's state is in the view. */
export const ACTIVATED_META = 'sessionActivated'
/**
 * Meta on a whole-document replace inside a kept session (source-mode exit):
 * records are re-anchored by text after it, not mapped through it.
 */
export const RELOAD_META = 'sessionReload'
/**
 * Meta on a transaction that builds a session's state outside the view (the
 * normalisation on a scratch state, the seed that re-applies marks): the
 * document is not in the view and the stores do not mirror it, so a plugin
 * that mirrors a store must neither read it nor move its records.
 */
export const BUILD_META = 'sessionBuild'

const EMPTY: IdentityState = { documentId: '', path: null, plain: false }

export const Identity = Extension.create({
  name: 'documentIdentity',

  // TipTap orders plugins by priority, highest first. A plugin's `apply`
  // receives the partially built next state, so the identity must already be
  // applied when any other plugin reads it.
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin<IdentityState>({
        key: identityKey,
        state: {
          init: () => EMPTY,
          apply: (tr: Transaction, prev: IdentityState) => {
            const next = tr.getMeta(IDENTITY_META) as IdentityState | undefined
            return next ?? prev
          }
        }
      })
    ]
  }
})

/** The identity of the document `state` holds; empty before the first stamp. */
export function getIdentity(state: EditorState): IdentityState {
  return identityKey.getState(state) ?? EMPTY
}

export function isPlainTextPath(path: string | null | undefined): boolean {
  return !!path?.endsWith('.txt')
}
