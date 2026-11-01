/**
 * Per-tab document sessions (#1145).
 *
 * One ProseMirror `EditorState` per open tab, held in a module-level map and
 * swapped into the single TipTap view with `view.updateState`. A tab switch
 * no longer serialises the leaving document and re-parses the arriving one:
 * the states persist, with their history, selection and marks, and the view
 * shows whichever one is active.
 *
 * The three record stores (AI annotations, comment threads, suggestions) are
 * mirrors of the active session. Their id-setting entry points are called
 * only here, inside `activateSession`, with id and records in one write, and
 * every IndexedDB write of a record set goes through `persistRecords`, which
 * takes the id and the records from one synchronous read. That is what closes
 * the cross-document contamination the old swap allowed (§G): there is no
 * moment with the next document's id and the previous document's records.
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
import { useAnnotationStore } from '../extensions/ai-annotations/store'
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
import { textIndex, snapshotAnchors, reanchorMapping } from '../extensions/ai-annotations/reanchor'
import { aiAnnotationsPluginKey } from '../extensions/ai-annotations/plugin'
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

export interface Session {
  tabId: string
  state: EditorState
  /** The document's record sets. For the active session the stores mirror these. */
  records: SessionRecords
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
}

interface SourceSurface {
  tabId: string
  getContent: () => string
  /** The text shown on entering; unchanged on exit means nothing to write back (#1125). */
  entryText: string
}

interface Registry {
  sessions: Map<string, Session>
  activeTabId: string | null
}

// ---------------------------------------------------------------------------
// Module state (kept across an HMR of this file)
// ---------------------------------------------------------------------------

const hot = import.meta.hot
const registry: Registry = (hot?.data.sessionRegistry as Registry | undefined) ?? {
  sessions: new Map(),
  activeTabId: null
}
if (hot) hot.data.sessionRegistry = registry

let editor: Editor | null = null
let editorWaiters: Array<(editor: Editor) => void> = []
let detachEditor: (() => void) | null = null
let sourceSurface: SourceSurface | null = null

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
  if (!next) return

  const onTransaction = ({ transaction }: { editor: Editor; transaction: Transaction }) => {
    const session = activeSession()
    if (!session) return
    session.state = next.view.state
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

  // The stores mirror the active session; a store change belongs to it.
  // Activation sets `activeTabId` before it writes the stores, so these copy
  // into the session the records belong to; the id check is the invariant
  // made explicit.
  const unsubscribeAnnotations = useAnnotationStore.subscribe((state) => {
    const session = activeSession()
    if (session && state.documentId === getIdentity(session.state).documentId) {
      session.records.annotations = state.annotations
    }
  })
  const unsubscribeComments = useCommentStore.subscribe((state) => {
    const session = activeSession()
    if (session && state.documentId === getIdentity(session.state).documentId) {
      session.records.comments = state.pendingComments
    }
  })

  detachEditor = () => {
    next.off('transaction', onTransaction)
    unsubscribeAnnotations()
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
  state = state.apply(
    state.tr.setMeta(IDENTITY_META, identity).setMeta(BUILD_META, true).setMeta('addToHistory', false)
  )
  session.state = state
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
  if (session) (session.records as Record<RecordKind, unknown>)[kind] = records
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
  if (session) (session.records as Record<RecordKind, unknown>)[kind] = []
  if (session && session.tabId === registry.activeTabId) {
    if (kind === 'comments') useCommentStore.setState({ pendingComments: [] })
    if (kind === 'annotations') useAnnotationStore.setState({ annotations: [] })
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
  await persistRecords('annotations', documentId, session.records.annotations)
  const comments = mergeCommentsForPersistence(editorLike, session.records.comments)
  await persistRecords('comments', documentId, comments)
  const suggestions = getAISuggestions(editorLike)
  if (suggestions.length > 0 || opts.allowEmptySuggestions) {
    await persistRecords('suggestions', documentId, suggestions)
  }
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
export async function openSession(
  tab: Tab,
  content: string,
  opts: { viewState?: EditorViewState } = {}
): Promise<Session> {
  const existing = registry.sessions.get(tab.id)
  if (existing) return existing
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
  state = state.applyTransaction(seed).state

  const session: Session = {
    tabId: tab.id,
    state,
    records: { annotations, comments: reconcileAnchorLost(comments, outcome), suggestions },
    baseline: { content, serialized: serializeDoc(e, state.doc) },
    frontmatterRaw,
    projectionTimer: null,
    suggestionTimer: null,
    suggestionResolved: false
  }
  registry.sessions.set(tab.id, session)
  stats.opens++
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

  useAnnotationStore.setState({
    documentId: identity.documentId,
    annotations: session.records.annotations,
    createdThisSession: new Set(),
    isLoadingDocument: false
  })
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
  if (tabId === registry.activeTabId) {
    exitSourceModeFor(session)
    registry.activeTabId = null
  }
  flushProjections(session)
  registry.sessions.delete(tabId)
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
  const tr = build(session.state)
  session.state = session.state.applyTransaction(tr).state
  if (tr.docChanged) projectMarkdown(session)
}

/**
 * Replace a session's document. `keepHistory: true` (source-mode exit) is one
 * undo step: a whole-document replace with the comment and suggestion marks
 * re-applied in the same transaction and the annotations re-anchored by their
 * text. `keepHistory: false` (disk reload, reMarkable sync, a conversion)
 * re-opens the session from the new text under the same tab.
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
    const before = textIndex(session.state.doc)
    const anchors = snapshotAnchors(before, session.records.annotations)

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

    // Annotations: mapped through the one changed region, not the replace.
    if (anchors.length > 0) {
      const mapping = reanchorMapping(before, textIndex(session.state.doc), anchors)
      if (isActive) {
        useAnnotationStore.getState().updatePositions(mapping)
      } else {
        session.records.annotations = remapAnnotations(session.records.annotations, mapping)
      }
    }
    if (isActive) {
      const view = e.view
      view.dispatch(view.state.tr.setMeta(aiAnnotationsPluginKey, { rebuildDecorations: true }))
      session.state = view.state
    }
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

function remapAnnotations(
  annotations: AIAnnotation[],
  mapping: (from: number, to: number) => { from: number; to: number } | null
): AIAnnotation[] {
  return annotations.map((a) => {
    if (a.detached) return a
    const range = mapping(a.from, a.to)
    return range ? { ...a, from: range.from, to: range.to } : { ...a, detached: true }
  })
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
 * identity, the mirrors, and the records written under the new id (old keys
 * stay, as before).
 */
export async function setSessionIdentity(tabId: string, identity: IdentityState): Promise<void> {
  const session = requireSession(tabId)
  const previous = getIdentity(session.state)
  const isActive = tabId === registry.activeTabId
  const rekeyed = session.records.annotations.map((a) => ({ ...a, documentId: identity.documentId }))
  session.records.annotations = rekeyed
  if (isActive) {
    const annotationStore = useAnnotationStore.getState()
    if (annotationStore.pendingSave) await annotationStore.pendingSave
    useAnnotationStore.setState({ annotations: rekeyed, documentId: identity.documentId })
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
      rekeyed.length > 0 ? persistRecords('annotations', identity.documentId, rekeyed) : Promise.resolve(),
      comments.length > 0 ? persistRecords('comments', identity.documentId, comments) : Promise.resolve(),
      suggestions.length > 0 ? persistRecords('suggestions', identity.documentId, suggestions) : Promise.resolve()
    ])
  }
  pipelineLog('session:identity', { tabId, from: previous.documentId, to: identity.documentId })
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
