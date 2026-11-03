/**
 * DocumentHandle (#1145, #1148): what a tool executor holds on a document.
 *
 * Executors used to reach for the live TipTap editor, which is whatever tab
 * is in front of the user. A handle names a document: its identity, its
 * state, and the ways to change it. One shape serves the active tab and a
 * background one: `state`, `isActive` and `view` read the session registry
 * on every access, `apply` goes through `applyToSession` (the view when the
 * tab is shown, the stored state otherwise), and `commands` / `chain()` /
 * `can()` are the editor's when the tab is shown and a command run over the
 * session's own state otherwise (`focus`, `blur` and `scrollIntoView` are
 * no-ops there: nothing is shown). A turn that starts on the active tab and
 * goes background mid-way, or the reverse, keeps the same handle.
 *
 * `resolveDocumentHandle` is the active document's handle (MCP clients, the
 * slash commands, the specs: everything without a binding).
 * `resolveToolHandle` resolves a chat turn's binding: its tab, else the tab
 * holding its document id, else a background reopen of its path, else the
 * document is closed and the call fails naming it (design §4.14).
 */

import { CommandManager } from '@tiptap/core'
import type { CanCommands, ChainedCommands, Editor, SingleCommands } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Schema, Node as PMNode } from '@tiptap/pm/model'
import { useTabStore } from '../stores/tabStore'
import { getIdentity } from './identity'
import {
  applyToSession,
  getActiveSession,
  getAttachedEditor,
  getSession,
  isSourceSurfaceFor,
  isTabClosing,
  openSessionForTab,
  projectSessionContent,
  tabIdForDocument
} from './session'
import { openInBackground } from '../tabs/actions'

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
 * What a chat turn is bound to (#1148): its conversation's document. The
 * object belongs to the turn and is updated in place when the tab is
 * resolved (or re-resolved after a close) and when a tab-changing tool moves
 * the turn to another document.
 */
export interface ToolBinding {
  conversationId: string
  documentId: string
  path: string | null
  tabId: string | null
}

export type ToolHandleError = {
  error: string
  code: 'EDITOR_NOT_AVAILABLE' | 'DOCUMENT_CLOSED' | 'SOURCE_MODE'
}

/** The document's own `.focus()` / `.blur()` / `.scrollIntoView()` do nothing while it is not shown. */
const VIEW_ONLY_COMMANDS = ['focus', 'blur', 'scrollIntoView'] as const

type RawCommands = CommandManager['rawCommands']

/**
 * Commands over a session's state. TipTap's `CommandManager` can run a
 * command over a custom state, but its own `commands` getter drops the
 * transaction and its chain never dispatches, so the chain and the one-shot
 * commands are built here over the manager's public `rawCommands` and
 * `buildProps`; `run()` (and each one-shot command) applies the transaction
 * to the session, whatever the callbacks returned, as the view path
 * dispatches regardless.
 */
function commandsOverState(editor: Editor, tabId: string) {
  const manager = (state: EditorState): CommandManager => {
    const m = new CommandManager({ editor, state })
    const raw: RawCommands = { ...m.rawCommands }
    for (const name of VIEW_ONLY_COMMANDS) raw[name] = () => () => true
    m.rawCommands = raw
    return m
  }
  const current = (): EditorState => {
    const session = getSession(tabId)
    if (!session) throw new Error(`[handle] no session for tab ${tabId}`)
    return session.state
  }
  const apply = (tr: Transaction): void => applyToSession(tabId, () => tr)

  const chain = (): ChainedCommands => {
    const state = current()
    const m = manager(state)
    const tr = state.tr
    const callbacks: boolean[] = []
    const proxy = new Proxy(
      {},
      {
        get: (_target, name: string) => {
          if (name === 'run') {
            return () => {
              const ok = callbacks.every((cb) => cb === true)
              apply(tr)
              return ok
            }
          }
          const command = m.rawCommands[name as keyof RawCommands]
          if (!command) return undefined
          return (...args: unknown[]) => {
            callbacks.push((command as (...a: unknown[]) => (props: unknown) => boolean)(...args)(m.buildProps(tr, true)))
            return proxy
          }
        }
      }
    ) as ChainedCommands
    return proxy
  }

  const commands = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        return (...args: unknown[]) => {
          const state = current()
          const m = manager(state)
          const command = m.rawCommands[name as keyof RawCommands]
          if (!command) throw new Error(`[handle] unknown command ${name}`)
          const tr = state.tr
          const ok = (command as (...a: unknown[]) => (props: unknown) => boolean)(...args)(m.buildProps(tr, true))
          apply(tr)
          return ok
        }
      }
    }
  ) as SingleCommands

  const can = (): CanCommands => manager(current()).can()
  return { chain, commands, can }
}

/** The handle of an open tab's document, active or not; null without an editor or a session. */
export function handleForTab(tabId: string): DocumentHandle | null {
  const editor = getAttachedEditor()
  if (!editor || editor.isDestroyed || !getSession(tabId)) return null
  const isActive = (): boolean => getActiveSession()?.tabId === tabId
  // While the tab is shown, the view's state is the truth (a chain in flight
  // may be ahead of the session record); otherwise the session's.
  const state = (): EditorState => (isActive() ? editor.state : getSession(tabId)?.state ?? editor.state)
  const over = commandsOverState(editor, tabId)
  return {
    tabId,
    get documentId() {
      return getIdentity(state()).documentId
    },
    get path() {
      return getIdentity(state()).path
    },
    get plain() {
      return getIdentity(state()).plain
    },
    get state() {
      return state()
    },
    schema: editor.schema,
    get isActive() {
      return isActive()
    },
    get view() {
      return isActive() ? editor.view : null
    },
    // Getters: TipTap builds the commands' transaction from the state at
    // access time, so a snapshot taken here would dispatch a transaction
    // built before any earlier write through this handle (#1146).
    get commands() {
      return isActive() ? editor.commands : over.commands
    },
    chain: () => (isActive() ? editor.chain() : over.chain()),
    can: () => (isActive() ? editor.can() : over.can()),
    markdown: editor.storage.markdown as MarkdownCodec,
    serialize: () => projectSessionContent(tabId),
    apply: (tr) => applyToSession(tabId, () => tr)
  }
}

/**
 * The active document's handle, or null when no document is open (or source
 * mode is open and a write was asked for).
 */
export function resolveDocumentHandle(opts: ResolveHandleOptions = {}): DocumentHandle | null {
  const session = getActiveSession()
  if (!session) return null
  if (opts.forWrite && isSourceSurfaceFor(session.tabId)) return null
  return handleForTab(session.tabId)
}

/** The tab a binding names today, or null when it has to be re-resolved. */
function boundTab(binding: ToolBinding): string | null {
  if (binding.tabId && useTabStore.getState().getTabById(binding.tabId) && !isTabClosing(binding.tabId)) {
    return binding.tabId
  }
  const byDocument = tabIdForDocument(binding.documentId)
  if (byDocument && !isTabClosing(byDocument)) return byDocument
  return null
}

/**
 * The handle of a chat turn's document (#1148): the bound tab, else the tab
 * that holds the bound document, else a background reopen of the bound path
 * from disk; an untitled document that was closed is gone, and the call
 * fails naming it. A lazy tab (restored at launch, never shown) gets its
 * session here. Updates `binding.tabId` / `documentId` in place.
 */
export async function resolveToolHandle(
  binding: ToolBinding,
  opts: ResolveHandleOptions = {}
): Promise<DocumentHandle | ToolHandleError> {
  const editor = getAttachedEditor()
  if (!editor || editor.isDestroyed) return { error: 'Editor not available', code: 'EDITOR_NOT_AVAILABLE' }

  let tabId = boundTab(binding)
  if (!tabId && binding.path) {
    const reopened = await openInBackground(binding.path)
    if (reopened) tabId = reopened.tabId
  }
  if (!tabId) {
    const name = binding.path ? binding.path.split('/').pop() : 'Untitled'
    return {
      error: `The document this conversation belongs to (${name}) was closed; open it again to continue.`,
      code: 'DOCUMENT_CLOSED'
    }
  }
  if (!getSession(tabId)) await openSessionForTab(tabId)
  // The close window: a tab that started closing while the session opened.
  if (isTabClosing(tabId) || !useTabStore.getState().getTabById(tabId)) {
    return resolveToolHandle({ ...binding, tabId: null }, opts)
  }
  if (opts.forWrite && isSourceSurfaceFor(tabId)) {
    return { error: 'Document is open in source mode; writes are refused until it is closed', code: 'SOURCE_MODE' }
  }
  const handle = handleForTab(tabId)
  if (!handle) return { error: 'Editor not available', code: 'EDITOR_NOT_AVAILABLE' }
  binding.tabId = tabId
  binding.documentId = handle.documentId
  binding.path = handle.path
  return handle
}

export function isToolHandleError(value: DocumentHandle | ToolHandleError): value is ToolHandleError {
  return 'code' in value && !('tabId' in value)
}
