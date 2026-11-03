/**
 * Per-tab document sessions (#1145).
 *
 * One ProseMirror `EditorState` per open tab, held in a module-level map and
 * swapped into the single TipTap view with `view.updateState`. A tab switch
 * no longer serialises the leaving document and re-parses the arriving one:
 * the states persist, with their history, selection and marks, and the view
 * shows whichever one is active.
 *
 * The comment and suggestion stores are mirrors of the active session. Their
 * id-setting entry points are called only here, inside `activateSession`,
 * with id and records in one write, and every IndexedDB write of a record set
 * goes through `persistRecords`, which takes the id and the records from one
 * synchronous read. That is what closes the cross-document contamination the
 * old swap allowed (§G): there is no moment with the next document's id and
 * the previous document's records. AI annotation records live in each
 * state's own plugin state (#1146): this file seeds them on open, watches the
 * plugin state's revision after every transaction to persist them, and
 * exposes the active state to React through `subscribeActiveSession`.
 *
 * This is the only file that creates an `EditorState` for a document or calls
 * `view.updateState`, and the only importer of the record writers in
 * lib/persistence.
 */

import { flushSync } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { createDocument } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Node as PMNode } from '@tiptap/pm/model'
import type { Tab } from '../stores/tabStore'
import { useTabStore } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { useCommentStore } from '../extensions/comments/store'
import { useSuggestionStore } from '../extensions/ai-suggestions/store'
import {
  applyCommentMarks,
  reconcileAnchorLost,
  commentMarkIds,
  mergeCommentsForPersistence
} from '../extensions/comments/extension'
import {
  applySuggestionMarks,
  getAISuggestions,
  AI_SUGGESTION_RESOLVED_META
} from '../extensions/ai-suggestions/extension'
import { annotationsOf, annotationPluginState, loadAnnotationsInto } from '../extensions/ai-annotations/transactions'
import {
  getIdentity,
  isPlainTextPath,
  IDENTITY_META,
  ACTIVATED_META,
  RELOAD_META,
  BUILD_META,
  type IdentityState
} from './identity'
import { parseMarkdown, serializeMarkdown } from '../lib/markdown'
import { getContentWithoutFrontmatter, getFrontmatterRaw } from '../components/editor/FrontmatterDisplay'
import { editorScrollContainer, selectionFromViewState, type EditorViewState } from '../lib/editorViewState'
import { isRemarkableOcrPath } from '../lib/remarkablePath'
import {
  loadAnnotations,
  saveAnnotations,
  deleteAnnotations,
  loadComments,
  saveComments,
  deleteComments,
  loadSuggestions,
  saveSuggestions,
  deleteSuggestions,
  deleteConversations
} from '../lib/persistence'
import type { AIAnnotation } from '../types/annotations'
import type { CommentData } from '../extensions/comments/types'
import type { AISuggestionData } from '../extensions/ai-suggestions/types'
import { pipelineLog } from '../lib/aiPipelineLog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordKind = 'annotations' | 'comments' | 'suggestions'

export interface SessionRecords {
  annotations: AIAnnotation[]
  comments: CommentData[]
  suggestions: AISuggestionData[]
}

/** The record sets a session holds beside its state; annotations live in the state (#1146). */
export type SessionRecordSets = Omit<SessionRecords, 'annotations'>

export interface Session {
  tabId: string
  state: EditorState
  /** Comment threads and suggestions. For the active session the stores mirror these. */
  records: SessionRecordSets
  /**
   * The store content as loaded, and what the loaded document serialised to.
   * While the document still serialises to `serialized` (marks and
   * decorations change no byte) the projection emits `content` unchanged, so
   * an untouched document saves byte for byte (#1102).
   */
  baseline: { content: string; serialized: string } | null
  /** The raw frontmatter block the content carried ('' once the frontmatter editor took over). */
  frontmatterRaw: string
  projectionTimer: ReturnType<typeof setTimeout> | null
  suggestionTimer: ReturnType<typeof setTimeout> | null
  /** An accept or reject happened since the last suggestion persist (#1126). */
  suggestionResolved: boolean
  /** A pending annotation write scheduled by a plain position move (#1146). */
  annotationTimer: ReturnType<typeof setTimeout> | null
  /** The annotation plugin state's revision last written to IndexedDB. */
  annotationsPersisted: number
  /** The in-flight annotation write; an identity change awaits it. */
  annotationWrite: Promise<void> | null
}

interface SourceSurface {
  tabId: string
  getContent: () => string
  /** The text shown on entering; unchanged on exit means nothing to write back (#1125). */
  entryText: string
}

interface Registry {
  sessions: Map<string, Session>
  /** Sessions being built, so two callers racing on one tab share the build. */
  pending: Map<string, Promise<Session>>
  activeTabId: string | null
}

// ---------------------------------------------------------------------------
// Module state (kept across an HMR of this file)
// ---------------------------------------------------------------------------

const hot = import.meta.hot
const registry: Registry = (hot?.data.sessionRegistry as Registry | undefined) ?? {
  sessions: new Map(),
  pending: new Map(),
  activeTabId: null
}
registry.pending ??= new Map()
if (hot) hot.data.sessionRegistry = registry

let editor: Editor | null = null
let editorWaiters: Array<(editor: Editor) => void> = []
let detachEditor: (() => void) | null = null
let sourceSurface: SourceSurface | null = null
/** React readers of the active state (`useActiveSession`). */
const activeListeners = new Set<() => void>()

const stats = {
  opens: 0,
  activations: 0,
  serializations: 0,
  projections: 0,
  persists: 0
}

const PROJECTION_DELAY_MS = 500

// ---------------------------------------------------------------------------
// Editor attachment
// ---------------------------------------------------------------------------

function requireEditor(): Editor {
  if (!editor) throw new Error('[session] no editor attached')
  return editor
}

function whenEditorAttached(): Promise<Editor> {
  if (editor) return Promise.resolve(editor)
  return new Promise((resolve) => {
    editorWaiters.push(resolve)
  })
}

/**
 * The single TipTap editor whose view shows the active session. Registered by
 * the Editor component on mount; `null` on unmount. On a dev remount the
 * sessions are rebuilt against the new schema and the active one is put back.
 */
export function attachEditor(next: Editor | null): void {
  if (detachEditor) {
    detachEditor()
    detachEditor = null
  }
  editor = next
  if (!next) {
    notifyActiveSession()
    return
  }

  const onTransaction = ({ transaction }: { editor: Editor; transaction: Transaction }) => {
    const session = activeSession()
    if (!session) return
    const prev = session.state
    session.state = next.view.state
    afterTransaction(session, prev)
    notifyActiveSession()
    if (!transaction.docChanged) return
    if (useEditorStore.getState().sourceMode) return
    scheduleMarkdownProjection(session, transaction.getMeta(RELOAD_META) === true ? 0 : PROJECTION_DELAY_MS)
    if (transaction.getMeta(AI_SUGGESTION_RESOLVED_META) === true) {
      session.suggestionResolved = true
      if (session.suggestionTimer) clearTimeout(session.suggestionTimer)
      session.suggestionTimer = null
      projectSuggestions(session)
    } else {
      if (session.suggestionTimer) clearTimeout(session.suggestionTimer)
      session.suggestionTimer = setTimeout(() => projectSuggestions(session), PROJECTION_DELAY_MS)
    }
  }
  next.on('transaction', onTransaction)

  // The comment store mirrors the active session; a store change belongs to
  // it. Activation sets `activeTabId` before it writes the store, so this
  // copies into the session the threads belong to; the id check is the
  // invariant made explicit.
  const unsubscribeComments = useCommentStore.subscribe((state) => {
    const session = activeSession()
    if (session && state.documentId === getIdentity(session.state).documentId) {
      session.records.comments = state.pendingComments
    }
  })

  detachEditor = () => {
    next.off('transaction', onTransaction)
    unsubscribeComments()
  }

  // Dev remount: the schema object changed; carry every state over.
  for (const session of registry.sessions.values()) {
    if (session.state.schema !== next.schema) rebuildForSchema(session, next)
  }
  if (registry.activeTabId && registry.sessions.has(registry.activeTabId)) {
    activateSession(registry.activeTabId, { reattach: true })
  }

  const waiters = editorWaiters
  editorWaiters = []
  for (const resolve of waiters) resolve(next)
  notifyActiveSession()
}

export function getAttachedEditor(): Editor | null {
  return editor
}

function rebuildForSchema(session: Session, next: Editor): void {
  const identity = getIdentity(session.state)
  const doc = PMNode.fromJSON(next.schema, session.state.doc.toJSON())
  const { from, to } = session.state.selection
  let state = EditorState.create({
    schema: next.schema,
    plugins: next.state.plugins,
    doc,
    selection: selectionFromViewState(doc, { selection: { from, to }, scrollTop: 0 })
  })
  // applyTransaction, as openSession does: the appended normalisers (node ids,
  // the table trailing paragraph) run on the rebuilt document too. The
  // annotation records ride over in a `load` (the old key may differ from the
  // new plugin's; `annotationsOf` finds them either way), already anchored,
  // and the rebuilt revision counts as persisted: a remount writes nothing.
  const tr = state.tr.setMeta(IDENTITY_META, identity).setMeta(BUILD_META, true).setMeta('addToHistory', false)
  loadAnnotationsInto(tr, annotationsOf(session.state))
  state = state.applyTransaction(tr).state
  session.state = state
  session.annotationsPersisted = annotationPluginState(state)?.revision ?? 0
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getSession(tabId: string): Session | null {
  return registry.sessions.get(tabId) ?? null
}

export function hasSession(tabId: string): boolean {
  return registry.sessions.has(tabId)
}

export function getActiveSession(): Session | null {
  return activeSession()
}

function activeSession(): Session | null {
  return registry.activeTabId ? (registry.sessions.get(registry.activeTabId) ?? null) : null
}

function requireSession(tabId: string): Session {
  const session = registry.sessions.get(tabId)
  if (!session) throw new Error(`[session] no session for tab ${tabId}`)
  return session
}

function sessionForDocument(documentId: string): Session | null {
  for (const session of registry.sessions.values()) {
    if (getIdentity(session.state).documentId === documentId) return session
  }
  return null
}

/** Test seam: the tabs that hold a session, in insertion order. */
export function getSessionTabIds(): string[] {
  return [...registry.sessions.keys()]
}

/** Test seam: how much work the sessions have done since launch. */
export function getProjectionStats(): typeof stats {
  return { ...stats }
}

// ---------------------------------------------------------------------------
// The active state for React (document/useActiveSession.ts)
// ---------------------------------------------------------------------------

/** The active session's state, or null when no document is open. */
export function activeSessionState(): EditorState | null {
  return activeSession()?.state ?? null
}

/**
 * Called after every transaction on the active session, after an activation,
 * when the active tab closes, and when the editor attaches or detaches.
 */
export function subscribeActiveSession(listener: () => void): () => void {
  activeListeners.add(listener)
  return () => {
    activeListeners.delete(listener)
  }
}

function notifyActiveSession(): void {
  for (const listener of activeListeners) listener()
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

interface MarkdownStorage {
  parser: { parse: (content: string) => string }
  serializer: { serialize: (content: PMNode) => string }
}

function markdownStorage(e: Editor): MarkdownStorage {
  return e.storage.markdown as MarkdownStorage
}

function serializeDoc(e: Editor, doc: PMNode): string {
  stats.serializations++
  return markdownStorage(e).serializer.serialize(doc)
}

/**
 * Parse a markdown body into a normalised document: node ids assigned, a
 * trailing paragraph after a table, plain text flattened for a `.txt`. The
 * normalisation runs as one doc-changing transaction on a scratch state so
 * every `appendTransaction` sees it; the final state is created from the
 * result, which is what keeps its history empty.
 */
function buildDocument(e: Editor, body: string, identity: IdentityState): PMNode {
  const html = markdownStorage(e).parser.parse(body)
  const parsed = createDocument(html, e.schema)
  const scratch = EditorState.create({ schema: e.schema, plugins: e.state.plugins })
  const tr = scratch.tr
    .replaceWith(0, scratch.doc.content.size, parsed.content)
    .setMeta(IDENTITY_META, identity)
    .setMeta(BUILD_META, true)
    .setMeta('addToHistory', false)
  return scratch.applyTransaction(tr).state.doc
}

/** The markdown the session's document projects to, with the baseline substitution. */
function projectedContent(e: Editor, session: Session): string {
  const body = serializeDoc(e, session.state.doc)
  if (session.baseline && session.baseline.serialized === body) return session.baseline.content
  return session.frontmatterRaw + body
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function scheduleMarkdownProjection(session: Session, delay: number): void {
  if (session.projectionTimer) clearTimeout(session.projectionTimer)
  session.projectionTimer = null
  if (delay === 0) {
    projectMarkdown(session)
    return
  }
  session.projectionTimer = setTimeout(() => projectMarkdown(session), delay)
}

/** Write the session's document to the editor store (active) or the tab record (background). */
function projectMarkdown(session: Session): void {
  session.projectionTimer = null
  const e = editor
  if (!e || !registry.sessions.has(session.tabId)) return
  stats.projections++
  const content = projectedContent(e, session)
  if (session.tabId === registry.activeTabId) {
    // Today's dirty semantics: the store marks dirty only when the bytes changed.
    useEditorStore.getState().setContent(content)
  } else {
    const tab = useTabStore.getState().getTabById(session.tabId)
    if (tab && tab.content !== content) {
      useTabStore.getState().updateTab(session.tabId, { content, isDirty: true })
    }
  }
}

/** Persist the live suggestion marks; an empty set only after a resolve (#1126). */
function projectSuggestions(session: Session): void {
  session.suggestionTimer = null
  if (!registry.sessions.has(session.tabId)) return
  const documentId = getIdentity(session.state).documentId
  const live = getAISuggestions({ state: session.state })
  const resolved = session.suggestionResolved
  session.suggestionResolved = false
  if (live.length === 0) {
    // NEVER overwrite the stored set with an empty one from a routine
    // transaction, only when the writer resolved the last suggestion.
    if (resolved) void deleteRecords('suggestions', documentId)
    return
  }
  void persistRecords('suggestions', documentId, live)
}

/** Land the session's pending projections now (the leaving step, a save). */
export function flushProjections(session: Session): void {
  if (session.tabId === registry.activeTabId && sourceSurface?.tabId === session.tabId) {
    // Source mode: the source editor's text is the document; project it.
    updateFromSource(sourceSurface.getContent())
  }
  if (session.projectionTimer) {
    clearTimeout(session.projectionTimer)
    projectMarkdown(session)
  }
  if (session.suggestionTimer) {
    clearTimeout(session.suggestionTimer)
    projectSuggestions(session)
  }
  if (session.annotationTimer) {
    clearTimeout(session.annotationTimer)
    session.annotationTimer = null
    persistAnnotationsNow(session)
  }
}

export function flushActiveProjections(): void {
  const session = activeSession()
  if (session) flushProjections(session)
}

// ---------------------------------------------------------------------------
// Persistence (the only IndexedDB writers for record sets)
// ---------------------------------------------------------------------------

/**
 * Write a record set under `documentId`. When a session holds that document
 * its records follow, so a write for a background document (share pull,
 * artifact import) is honoured; both arguments come from the caller's single
 * synchronous read.
 */
export async function persistRecords<K extends RecordKind>(
  kind: K,
  documentId: string,
  records: SessionRecords[K]
): Promise<void> {
  if (!documentId) {
    console.warn(`[session] persistRecords(${kind}) without a documentId; skipped`)
    return
  }
  const session = sessionForDocument(documentId)
  // Annotations are read from the state, never written into the session.
  if (session && kind !== 'annotations') (session.records as Record<string, unknown>)[kind] = records
  stats.persists++
  switch (kind) {
    case 'annotations':
      await saveAnnotations(documentId, records as AIAnnotation[])
      pipelineLog('annotation:save', { documentId, count: records.length })
      break
    case 'comments':
      await saveComments(documentId, records as CommentData[])
      break
    case 'suggestions':
      await saveSuggestions(documentId, records as AISuggestionData[])
      break
  }
}

export async function deleteRecords(kind: RecordKind, documentId: string): Promise<void> {
  const session = sessionForDocument(documentId)
  if (session && kind !== 'annotations') (session.records as Record<string, unknown>)[kind] = []
  if (session && session.tabId === registry.activeTabId && kind === 'comments') {
    useCommentStore.setState({ pendingComments: [] })
  }
  switch (kind) {
    case 'annotations':
      await deleteAnnotations(documentId)
      break
    case 'comments':
      await deleteComments(documentId)
      break
    case 'suggestions':
      await deleteSuggestions(documentId)
      break
  }
}

/** Every stored set of an untitled document that is being discarded. */
export async function deleteDocumentRecords(documentId: string): Promise<void> {
  await deleteConversations(documentId)
  await deleteRecords('annotations', documentId)
  await deleteRecords('suggestions', documentId)
  await deleteRecords('comments', documentId)
}

/**
 * Persist all three sets of a session under its own id. Positions drift with
 * every edit and are written only here (leave, close) and by the stores'
 * own mutators, as before. The suggestion set is written empty only when
 * `allowEmptySuggestions` says so (close).
 */
async function persistSession(session: Session, opts: { allowEmptySuggestions?: boolean } = {}): Promise<void> {
  const { documentId } = getIdentity(session.state)
  const editorLike = { state: session.state }
  if (session.annotationTimer) {
    clearTimeout(session.annotationTimer)
    session.annotationTimer = null
  }
  // The set as it is: plugin state is never transiently stripped (the seed
  // loads before a state is shown; a reload re-anchors in the same apply).
  session.annotationsPersisted = annotationPluginState(session.state)?.revision ?? 0
  await persistRecords('annotations', documentId, [...annotationsOf(session.state)])
  const comments = mergeCommentsForPersistence(editorLike, session.records.comments)
  await persistRecords('comments', documentId, comments)
  const suggestions = getAISuggestions(editorLike)
  if (suggestions.length > 0 || opts.allowEmptySuggestions) {
    await persistRecords('suggestions', documentId, suggestions)
  }
}

/**
 * After a transaction on a session (through the view or `applyToSession`):
 * an urgent annotation change (add, remove, detach, split, re-anchor,
 * restamp) is written now; a plain move or anchor refresh waits for the
 * projection delay, flushed by the leaving step, a close or a save. A seed
 * bumps the revision but is marked persisted by its caller, so it writes
 * nothing.
 */
function afterTransaction(session: Session, prev: EditorState): void {
  const next = annotationPluginState(session.state)
  if (!next) return
  const before = annotationPluginState(prev)?.revision ?? 0
  if (next.revision === before) return
  if (next.urgentRevision > session.annotationsPersisted) {
    persistAnnotationsNow(session)
  } else if (next.revision > session.annotationsPersisted) {
    if (session.annotationTimer) clearTimeout(session.annotationTimer)
    session.annotationTimer = setTimeout(() => {
      session.annotationTimer = null
      if (registry.sessions.has(session.tabId)) persistAnnotationsNow(session)
    }, PROJECTION_DELAY_MS)
  }
}

/** Write the session's annotation set under its own id, from one synchronous read of the state. */
function persistAnnotationsNow(session: Session): void {
  if (session.annotationTimer) {
    clearTimeout(session.annotationTimer)
    session.annotationTimer = null
  }
  const pluginState = annotationPluginState(session.state)
  if (!pluginState) return
  const { documentId } = getIdentity(session.state)
  session.annotationsPersisted = pluginState.revision
  const write = persistRecords('annotations', documentId, [...pluginState.records]).finally(() => {
    if (session.annotationWrite === write) session.annotationWrite = null
  })
  session.annotationWrite = write
}

/** The leaving step's persistence for a tab, a no-op without a session. */
export async function persistSessionRecords(tabId: string): Promise<void> {
  const session = registry.sessions.get(tabId)
  if (!session) return
  flushProjections(session)
  await persistSession(session)
}

// ---------------------------------------------------------------------------
// Open, activate, close
// ---------------------------------------------------------------------------

/**
 * Build the session for `tab` from `content` (the tab's cached text or the
 * file as read): records loaded first, the body parsed and normalised, the
 * state created with an empty history and the saved selection, then one
 * seed transaction that stamps the identity and re-applies comment and
 * suggestion marks. Returns the existing session when there is one.
 */
export function openSession(
  tab: Tab,
  content: string,
  opts: { viewState?: EditorViewState } = {}
): Promise<Session> {
  const existing = registry.sessions.get(tab.id)
  if (existing) return Promise.resolve(existing)
  // One build per tab at a time: two callers racing on the same tab (a switch
  // and a reopen, say) await the same promise instead of each registering a
  // session after its own IndexedDB reads.
  const pending = registry.pending.get(tab.id)
  if (pending) return pending
  const promise = openSessionNow(tab, content, opts).finally(() => registry.pending.delete(tab.id))
  registry.pending.set(tab.id, promise)
  return promise
}

async function openSessionNow(
  tab: Tab,
  content: string,
  opts: { viewState?: EditorViewState }
): Promise<Session> {
  const e = await whenEditorAttached()
  const documentId = tab.documentId
  const [annotations, comments, suggestions] = await Promise.all([
    loadAnnotations(documentId),
    loadComments(documentId),
    loadSuggestions(documentId)
  ])
  const raced = registry.sessions.get(tab.id)
  if (raced) return raced

  const identity: IdentityState = { documentId, path: tab.path, plain: isPlainTextPath(tab.path) }
  const frontmatterRaw = getFrontmatterRaw(content)
  const body = getContentWithoutFrontmatter(content)
  const doc = buildDocument(e, body, identity)

  let state = EditorState.create({
    schema: e.schema,
    plugins: e.state.plugins,
    doc,
    selection: opts.viewState ? selectionFromViewState(doc, opts.viewState) : undefined
  })
  const seed = state.tr
    .setMeta(IDENTITY_META, identity)
    .setMeta(BUILD_META, true)
    .setMeta('addToHistory', false)
  const outcome = applyCommentMarks(seed, comments)
  applySuggestionMarks(seed, suggestions)
  // The stored annotation rows, re-anchored onto this document by their text
  // inside the plugin's apply (#1138); nothing is written back at load.
  loadAnnotationsInto(seed, annotations)
  state = state.applyTransaction(seed).state

  const session: Session = {
    tabId: tab.id,
    state,
    records: { comments: reconcileAnchorLost(comments, outcome), suggestions },
    baseline: { content, serialized: serializeDoc(e, state.doc) },
    frontmatterRaw,
    projectionTimer: null,
    suggestionTimer: null,
    suggestionResolved: false,
    annotationTimer: null,
    annotationsPersisted: annotationPluginState(state)?.revision ?? 0,
    annotationWrite: null
  }
  registry.sessions.set(tab.id, session)
  stats.opens++
  // The pipeline log's vocabulary (#672): the record sets were loaded for
  // this document, as the stores used to report.
  pipelineLog('annotation:load', { documentId, count: annotations.length })
  pipelineLog('session:open', {
    tabId: tab.id,
    documentId,
    annotations: annotations.length,
    comments: comments.length,
    suggestions: suggestions.length
  })
  return session
}

/** The leaving half of a switch: source mode closed, projections landed, scroll kept. */
function leaveSession(session: Session, e: Editor): void {
  exitSourceModeFor(session)
  flushProjections(session)
  session.state = e.view.state
  const { from, to } = session.state.selection
  useTabStore.getState().updateTab(session.tabId, {
    viewState: { selection: { from, to }, scrollTop: editorScrollContainer(e)?.scrollTop ?? 0 }
  })
}

/**
 * Put a session's state into the view. Synchronous: the leaving session is
 * flushed, the state swapped, the stores set to the arriving records (id and
 * records in one write each), the editor store written inside `flushSync` so
 * the frontmatter block is committed before the scroll offset is restored,
 * then one `ACTIVATED` transaction so every plugin sees the new state under
 * the mirrored records.
 */
export function activateSession(tabId: string, opts: { reattach?: boolean } = {}): void {
  const session = requireSession(tabId)
  const e = requireEditor()
  const view = e.view
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) throw new Error(`[session] no tab ${tabId}`)

  const leaving = activeSession()
  if (leaving && leaving.tabId !== tabId) leaveSession(leaving, e)
  registry.activeTabId = tabId
  // The tab store's active tab follows the view, before anything below
  // reads it (the store→tab mirror keys on it).
  useTabStore.getState().setActiveTab(tabId)
  stats.activations++

  if (view.state !== session.state) view.updateState(session.state)
  session.state = view.state
  const identity = getIdentity(session.state)
  e.setEditable(!tab.isPreview && !isRemarkableOcrPath(tab.path), false)

  useCommentStore.setState({ documentId: identity.documentId, pendingComments: session.records.comments })
  useSuggestionStore.setState({ documentId: identity.documentId })

  if (!opts.reattach) {
    flushSync(() => {
      const store = useEditorStore.getState()
      store.setDocument({
        documentId: identity.documentId,
        path: tab.path,
        content: tab.content ?? '',
        frontmatter: tab.frontmatter ?? {},
        isDirty: tab.isDirty
      })
      store.setPreviewTab(tab.isPreview ?? false)
      store.setSourceMode(false)
    })
    const container = editorScrollContainer(e)
    if (container) container.scrollTop = tab.viewState?.scrollTop ?? 0
  }

  view.dispatch(view.state.tr.setMeta(ACTIVATED_META, true).setMeta('addToHistory', false))
  session.state = view.state
  // An equal selection fires no selectionUpdate; the status bar and the
  // session save listen for it.
  e.emit('selectionUpdate', { editor: e, transaction: view.state.tr })
  notifyActiveSession()
  pipelineLog('session:activate', { tabId, documentId: identity.documentId })
}

/**
 * Drop a session. Its records are written one last time (the one path where
 * an empty set is written on purpose), or deleted for a discarded untitled
 * document. Returns false when the tab had no session.
 */
export async function closeSession(tabId: string, opts: { discard?: boolean } = {}): Promise<boolean> {
  const session = registry.sessions.get(tabId)
  if (!session) return false
  const wasActive = tabId === registry.activeTabId
  if (wasActive) {
    exitSourceModeFor(session)
    registry.activeTabId = null
  }
  flushProjections(session)
  registry.sessions.delete(tabId)
  if (session.annotationTimer) {
    clearTimeout(session.annotationTimer)
    session.annotationTimer = null
  }
  if (wasActive) notifyActiveSession()
  const { documentId } = getIdentity(session.state)
  if (opts.discard) {
    await deleteDocumentRecords(documentId)
  } else {
    await persistSession(session, { allowEmptySuggestions: true })
  }
  pipelineLog('session:close', { tabId, documentId, discarded: opts.discard === true })
  return true
}

// ---------------------------------------------------------------------------
// Transactions on a session
// ---------------------------------------------------------------------------

/** Dispatch through the view for the active session, apply to the state otherwise. */
export function applyToSession(tabId: string, build: (state: EditorState) => Transaction): void {
  const session = requireSession(tabId)
  if (tabId === registry.activeTabId) {
    const view = requireEditor().view
    view.dispatch(build(view.state))
    session.state = view.state
    return
  }
  const prev = session.state
  const tr = build(prev)
  session.state = prev.applyTransaction(tr).state
  afterTransaction(session, prev)
  if (tr.docChanged) projectMarkdown(session)
}

/**
 * Replace a session's document. `keepHistory: true` (source-mode exit) is one
 * undo step: a whole-document replace with the comment and suggestion marks
 * re-applied in the same transaction; the annotation plugin re-anchors its
 * records by their text inside that same transaction (and inside the undo of
 * it). `keepHistory: false` (disk reload, reMarkable sync, a conversion)
 * re-opens the session from the new text under the same tab; the stored
 * annotation rows are re-anchored by the seed.
 */
export async function replaceSessionDocument(
  tabId: string,
  next: { content: string; body: string; frontmatter: Record<string, unknown> },
  opts: { keepHistory: boolean }
): Promise<void> {
  const session = requireSession(tabId)
  const e = requireEditor()
  const isActive = tabId === registry.activeTabId

  if (opts.keepHistory) {
    const identity = getIdentity(session.state)
    const doc = buildDocument(e, next.body, identity)

    // The baseline first: the projection runs inside the dispatch and must
    // emit the typed bytes, not a re-serialisation (#1102).
    session.baseline = { content: next.content, serialized: serializeDoc(e, doc) }
    session.frontmatterRaw = getFrontmatterRaw(next.content)

    let outcome = { anchored: [] as string[], lost: [] as string[] }
    applyToSession(tabId, (state) => {
      const tr = state.tr
        .replaceWith(0, state.doc.content.size, doc.content)
        .setMeta(RELOAD_META, true)
      outcome = applyCommentMarks(tr, session.records.comments)
      applySuggestionMarks(tr, session.records.suggestions)
      return tr
    })
    const comments = reconcileAnchorLost(session.records.comments, outcome)
    session.records.comments = comments
    if (isActive) useCommentStore.setState({ pendingComments: comments })
    pipelineLog('session:reload', { tabId, keepHistory: true, lost: outcome.lost.length })
    return
  }

  // Re-open under the same tab id from the new text.
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) return
  flushProjections(session)
  await persistSession(session)
  const viewState: EditorViewState = isActive
    ? { selection: selectionOf(e.view.state), scrollTop: editorScrollContainer(e)?.scrollTop ?? 0 }
    : { selection: selectionOf(session.state), scrollTop: tab.viewState?.scrollTop ?? 0 }
  registry.sessions.delete(tabId)
  if (isActive) registry.activeTabId = null
  await openSession(tab, next.content, { viewState })
  if (isActive) activateSession(tabId)
  pipelineLog('session:reload', { tabId, keepHistory: false })
}

function selectionOf(state: EditorState): { from: number; to: number } {
  return { from: state.selection.from, to: state.selection.to }
}

/**
 * Merge comment threads into a document (a share pull, an artifact
 * re-import). When a session holds the document the new threads' marks are
 * applied in place, in one history-free transaction, and the mirror follows;
 * otherwise only IndexedDB is written, as the import path already did.
 */
export async function mergeThreads(documentId: string, merged: CommentData[]): Promise<void> {
  const session = sessionForDocument(documentId)
  if (!session) {
    await saveComments(documentId, merged)
    return
  }
  const present = commentMarkIds(session.state.doc)
  const fresh = merged.filter((c) => !c.resolved && !present.has(c.id))
  let result = merged
  if (fresh.length > 0) {
    let outcome = { anchored: [] as string[], lost: [] as string[] }
    applyToSession(session.tabId, (state) => {
      const tr = state.tr.setMeta('addToHistory', false)
      outcome = applyCommentMarks(tr, fresh)
      return tr
    })
    result = reconcileAnchorLost(merged, outcome)
  }
  session.records.comments = result
  if (session.tabId === registry.activeTabId) useCommentStore.setState({ pendingComments: result })
  await persistRecords('comments', documentId, result)
}

/**
 * Restamp a session after a rename, move, Save As or conversion: the state's
 * identity (the annotation plugin restamps its records in the same
 * transition and the write under the new id starts at once), the mirrors,
 * and the comment and suggestion sets written under the new id (old keys
 * stay, as before). Resolves once the rows are under the new key.
 */
export async function setSessionIdentity(tabId: string, identity: IdentityState): Promise<void> {
  const session = requireSession(tabId)
  const previous = getIdentity(session.state)
  const isActive = tabId === registry.activeTabId
  if (isActive) {
    useCommentStore.setState({ documentId: identity.documentId })
    useSuggestionStore.setState({ documentId: identity.documentId })
  }
  applyToSession(tabId, (state) =>
    state.tr.setMeta(IDENTITY_META, identity).setMeta('addToHistory', false)
  )
  if (identity.documentId !== previous.documentId) {
    const editorLike = { state: session.state }
    const comments = mergeCommentsForPersistence(editorLike, session.records.comments)
    const suggestions = getAISuggestions(editorLike)
    await Promise.all([
      session.annotationWrite ?? Promise.resolve(),
      comments.length > 0 ? persistRecords('comments', identity.documentId, comments) : Promise.resolve(),
      suggestions.length > 0 ? persistRecords('suggestions', identity.documentId, suggestions) : Promise.resolve()
    ])
  }
  pipelineLog('session:identity', { tabId, from: previous.documentId, to: identity.documentId })
}

/** The markdown the session's document projects to (what the store holds), pending projections landed. */
export function projectSessionContent(tabId: string): string {
  const session = requireSession(tabId)
  const e = requireEditor()
  flushProjections(session)
  return projectedContent(e, session)
}

/** The full document text as a save writes it, after pending projections land. */
export function serializeSession(tabId: string): string {
  const session = requireSession(tabId)
  const e = requireEditor()
  flushProjections(session)
  const content = projectedContent(e, session)
  const frontmatter =
    tabId === registry.activeTabId
      ? useEditorStore.getState().document.frontmatter
      : (useTabStore.getState().getTabById(tabId)?.frontmatter ?? {})
  return serializeMarkdown(getContentWithoutFrontmatter(content), frontmatter)
}

// ---------------------------------------------------------------------------
// Frontmatter and source mode (the active session only, until PRs 6 and 7)
// ---------------------------------------------------------------------------

/**
 * The frontmatter editor took over the block: the store's object is the
 * truth from here, the raw block leaves the projected content, and the
 * projection lands now so the store holds the body alone.
 */
export function setActiveFrontmatterRaw(raw: string): void {
  const session = activeSession()
  if (!session) return
  if (session.baseline) {
    session.baseline = {
      content: raw + getContentWithoutFrontmatter(session.baseline.content),
      serialized: session.baseline.serialized
    }
  }
  session.frontmatterRaw = raw
  scheduleMarkdownProjection(session, 0)
}

/**
 * Source mode is opening: the document as text, byte for byte when nothing
 * serialisable changed since the load (#1102). `getContent` reads the source
 * editor's live text for the exit and for a switch while it is open.
 */
export function enterSourceMode(getContent: () => string): string {
  const session = activeSession()
  const e = editor
  if (!session || !e) return ''
  flushProjections(session)
  const content = projectedContent(e, session)
  const frontmatter = useEditorStore.getState().document.frontmatter ?? {}
  const text = serializeMarkdown(getContentWithoutFrontmatter(content), frontmatter)
  sourceSurface = { tabId: session.tabId, getContent, entryText: text }
  return text
}

/**
 * Source mode is closing (the toggle, or a switch away): the typed text
 * becomes the document in one undo step when it changed; an untouched toggle
 * dispatches nothing (#1125).
 */
export function exitSourceMode(): void {
  const surface = sourceSurface
  sourceSurface = null
  if (!surface) return
  const session = registry.sessions.get(surface.tabId)
  if (!session) return
  const live = surface.getContent()
  if (live === surface.entryText) return
  const { content: body, frontmatter } = parseMarkdown(live)
  // `content` is what the baseline substitutes on the next projection: the body
  // alone here, because the frontmatter editor owns the raw block after a source
  // exit and saves add it back from the store (see replaceSessionDocument).
  void replaceSessionDocument(surface.tabId, { content: body, body, frontmatter }, { keepHistory: true })
  if (surface.tabId === registry.activeTabId) {
    const store = useEditorStore.getState()
    store.setFrontmatter(frontmatter)
    store.setContent(body)
  }
}

function exitSourceModeFor(session: Session): void {
  if (sourceSurface?.tabId !== session.tabId) return
  exitSourceMode()
  useEditorStore.getState().setSourceMode(false)
}

/** True while the source editor shows `tabId`'s document. */
export function isSourceSurfaceFor(tabId: string): boolean {
  return sourceSurface?.tabId === tabId
}

/**
 * Typing in source mode: the store and the tab follow the text; the
 * session's state stays as it was until the exit (#1102). A late write from
 * a source editor that no longer shows the active document is ignored.
 */
export function updateFromSource(text: string): void {
  const session = activeSession()
  if (!session || sourceSurface?.tabId !== session.tabId) return
  const { content: body, frontmatter } = parseMarkdown(text)
  const store = useEditorStore.getState()
  store.setContent(body)
  store.setDocument({ frontmatter })
}
