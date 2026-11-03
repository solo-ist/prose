/**
 * DocumentHandle (#1145): what a tool executor holds on a document.
 *
 * Executors used to reach for the live TipTap editor, which is whatever tab
 * is in front of the user. A handle names a document: its identity, its
 * state, and the ways to change it. In this PR every handle is the active
 * session's, backed by the live editor; PR 4 of the editor-state series adds
 * handles for background documents (a CommandManager over the session's
 * state), which is why executors read `handle.state`, write through
 * `handle.commands` / `handle.chain()` / `handle.apply()`, and touch
 * `handle.view` only inside `if (handle.isActive)` for scroll, focus and
 * DOM measurement.
 */

import type { CanCommands, ChainedCommands, SingleCommands } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Schema, Node as PMNode } from '@tiptap/pm/model'
import { useEditorStore } from '../stores/editorStore'
import { getIdentity } from './identity'
import { getActiveSession, getAttachedEditor, projectSessionContent } from './session'

export interface MarkdownCodec {
  parser: { parse: (content: string) => string }
  serializer: { serialize: (content: PMNode) => string }
}

export interface DocumentHandle {
  tabId: string
  documentId: string
  path: string | null
  /** A `.txt` document: plain-text mode flattens structure and strips marks. */
  plain: boolean
  /** The document's current state; read it fresh after every write. */
  readonly state: EditorState
  schema: Schema
  /** The document is the one in the view. */
  isActive: boolean
  /** The live view, only when active: scroll, focus and DOM measurement. */
  view: EditorView | null
  commands: SingleCommands
  chain: () => ChainedCommands
  can: () => CanCommands
  /** The markdown parser and serializer the document was built with. */
  markdown: MarkdownCodec
  /** The document as markdown (the body, as a save would write it), pending projections landed. */
  serialize: () => string
  /** Dispatch a transaction built from `state`. */
  apply: (tr: Transaction) => void
}

export interface ResolveHandleOptions {
  /**
   * The executor writes to the document. Source mode owns the document while
   * it is open (the hidden TipTap state is stale until the exit), so a write
   * handle is refused there; reads keep working.
   */
  forWrite?: boolean
}

/**
 * The active document's handle, or null when no document is open (or source
 * mode is open and a write was asked for).
 */
export function resolveDocumentHandle(opts: ResolveHandleOptions = {}): DocumentHandle | null {
  const session = getActiveSession()
  const editor = getAttachedEditor()
  if (!session || !editor || editor.isDestroyed) return null
  if (opts.forWrite && useEditorStore.getState().sourceMode) return null

  const identity = getIdentity(editor.state)
  const tabId = session.tabId
  return {
    tabId,
    documentId: identity.documentId,
    path: identity.path,
    plain: identity.plain,
    get state() {
      return editor.state
    },
    schema: editor.schema,
    isActive: true,
    view: editor.view,
    commands: editor.commands,
    chain: () => editor.chain(),
    can: () => editor.can(),
    markdown: editor.storage.markdown as MarkdownCodec,
    serialize: () => projectSessionContent(tabId),
    apply: (tr) => editor.view.dispatch(tr)
  }
}
