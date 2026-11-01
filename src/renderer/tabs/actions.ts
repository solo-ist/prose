/**
 * Tab lifecycle actions (#1145, per-tab document sessions, part 1).
 *
 * Every way a document enters a tab, leaves it, or changes identity goes
 * through one of these functions: the tab bar, the menus, the explorer, the
 * reMarkable buttons, the chat tools (`select_tab`, `open_file`, `new_file`,
 * `save_file`), the converters and the launch restore. `useTabs` is a thin
 * React binding over them so components keep their names.
 *
 * Every flow has the same two halves. The *leaving* step runs for the tab the
 * editor currently holds: flush the editor's debounced store write, save the
 * conversation, persist the three record sets under the leaving tab's own id,
 * cache content and view into the tab record. The *arriving* step runs for the
 * tab that becomes active: activate it, load its document into the editor
 * store, load its conversation and records, derive preview and read-only
 * state from the tab, reveal it in the explorer. The leaving step always names
 * the tab it flushes, so closing the active tab can no longer write the closed
 * tab's state into its neighbour (the old `removeTab`-then-`switchToTab`
 * order did exactly that).
 *
 * Part 2 of the PR replaces the arriving step's `setDocument` + loads with
 * `openSession` / `activateSession` (document/session.ts). The flows and
 * their callers do not change again.
 */

import type { Editor } from '@tiptap/core'
import { useTabStore, generateUntitledTitle, type Tab, type ClosedTabSnapshot } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditorInstanceStore } from '../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../stores/chatStore'
import { useAnnotationStore } from '../extensions/ai-annotations'
import { useSuggestionStore } from '../extensions/ai-suggestions/store'
import { getAISuggestions } from '../extensions/ai-suggestions'
import { useCommentStore } from '../extensions/comments/store'
import { mergeCommentsForPersistence } from '../extensions/comments'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'
import { parseMarkdown, prepareTextContent, serializeMarkdown } from '../lib/markdown'
import { resolveOpenedFileContent } from '../lib/openDocument'
import { getApi } from '../lib/browserApi'
import { pipelineLog } from '../lib/aiPipelineLog'
import { handleMissingPath, isMissingPathFileError } from '../lib/stalePath'
import { captureEditorViewState } from '../lib/editorViewState'
import {
  recordDiskBaseline,
  clearDiskBaseline,
  transferDiskBaseline,
  readDocumentFromDisk
} from '../lib/diskSync'
import {
  generateId,
  generateIdFromPath,
  loadConversations,
  saveConversations,
  deleteConversations,
  loadAnnotations,
  saveAnnotations,
  deleteAnnotations,
  loadSuggestions,
  saveSuggestions,
  deleteSuggestions,
  loadComments,
  saveComments,
  deleteComments
} from '../lib/persistence'
import type { DraftState, TabDraft } from '../lib/persistence'
import type { FileAccessOptions } from '../../shared/fileAccess'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenFileOptions {
  /** Open as a transient preview tab (single-click / arrow-key browsing). */
  preview?: boolean
  /** Containment for the read: model-supplied paths pass `TOOL_FILE_ACCESS`. */
  access?: FileAccessOptions
  /** File bytes already in hand (the Open dialog returns them); skips the read. */
  content?: string
}

export interface OpenResult {
  tabId: string
  documentId: string
  /** The document has content but no chat history yet (auto-describe cue). */
  shouldDescribe: boolean
}

export interface NewTabInit {
  content?: string
  frontmatter?: Record<string, unknown>
  isDirty?: boolean
}

/** A session tab after App's stale-file resolution, ready to add. */
export interface RestoredTab {
  draft: TabDraft
  path: string | null
  isDirty: boolean
  content: string
  frontmatter?: Record<string, unknown>
  /** The content agrees with the file on disk (record a baseline). */
  fromDisk: boolean
}

interface ParsedDocument {
  content: string
  frontmatter: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleFromPath(path: string): string {
  const fullFileName = path.split('/').pop() || 'Untitled'
  const hasExtension = fullFileName.includes('.')
  return hasExtension ? fullFileName.substring(0, fullFileName.lastIndexOf('.')) : fullFileName
}

function snapshotOf(tab: Tab): ClosedTabSnapshot {
  return {
    path: tab.path,
    title: tab.title,
    baseTitle: tab.baseTitle,
    isDirty: tab.isDirty,
    content: tab.content,
    frontmatter: tab.frontmatter,
    cursorPosition: tab.cursorPosition,
    viewState: tab.viewState
  }
}

function liveEditor(): Editor | null {
  return useEditorInstanceStore.getState().editor
}

/** The editor's pending debounced store write, applied now (#1127). */
function flushEditorWrite(): void {
  useEditorInstanceStore.getState().flushPendingUpdate?.()
}

/**
 * Read and resolve a file for a tab: artifact extraction + comment import
 * (#768), `.txt` preparation, frontmatter split. A missing path is reported
 * (recent files pruned) before the error propagates to the caller.
 */
async function readDocument(
  path: string,
  documentId: string,
  opts: { access?: FileAccessOptions; content?: string }
): Promise<ParsedDocument> {
  if (!window.api) throw new Error('File API not available')
  let raw: string
  try {
    raw = opts.content ?? (await window.api.readFile(path, opts.access))
  } catch (error) {
    if (isMissingPathFileError(error)) handleMissingPath(path, 'open')
    throw error
  }
  const resolved = await resolveOpenedFileContent(path, raw, documentId)
  const parsed = parseMarkdown(resolved.content ?? raw)
  return { content: parsed.content, frontmatter: parsed.frontmatter }
}

function shouldDescribe(content: string): boolean {
  return content.trim().length > 0 && useChatStore.getState().conversations.length === 0
}

/**
 * An untitled tab with nothing in it: the one case where opening a file
 * replaces the tab instead of adding one. The active tab is read from the
 * editor store after a flush, since the tab cache lags the editor.
 */
function isEmptyUntitled(tab: Tab | null): boolean {
  if (!tab || tab.path !== null) return false
  let content = tab.content ?? ''
  if (tab.id === useTabStore.getState().activeTabId) {
    flushEditorWrite()
    const current = useEditorStore.getState().document
    if (current.documentId === tab.documentId) content = current.content
  }
  const trimmed = content.trim()
  if (trimmed === '') return true
  // TipTap may leave empty content as empty tags like <p></p>
  return trimmed.replace(/<[^>]*>/g, '').trim() === ''
}

async function deleteDocumentRecords(documentId: string): Promise<void> {
  await deleteConversations(documentId)
  await deleteAnnotations(documentId)
  await deleteSuggestions(documentId)
  await deleteComments(documentId)
}

// ---------------------------------------------------------------------------
// Preview browsing
// ---------------------------------------------------------------------------

// Chat panel state before preview browsing began, restored when it ends.
let chatPanelStateBeforePreview: boolean | null = null

/**
 * Derive the global preview flag from the active tab and the chat panel from
 * whether a preview tab exists at all. Preview browsing (single-click, arrow
 * keys) hides the chat panel while a preview tab is open and brings it back
 * when the preview is promoted, replaced by a permanent open, or closed. Every
 * activation runs this, so the flag can no longer stick to a previous tab.
 */
function syncPreviewMode(): void {
  const { tabs, activeTabId } = useTabStore.getState()
  const active = tabs.find((t) => t.id === activeTabId) ?? null
  useEditorStore.getState().setPreviewTab(active?.isPreview ?? false)
  const browsing = tabs.some((t) => t.isPreview)
  if (browsing) {
    if (chatPanelStateBeforePreview === null) {
      chatPanelStateBeforePreview = useChatStore.getState().isPanelOpen
      useChatStore.getState().setPanelOpen(false)
    }
  } else if (chatPanelStateBeforePreview !== null) {
    useChatStore.getState().setPanelOpen(chatPanelStateBeforePreview)
    chatPanelStateBeforePreview = null
  }
}

/** Make the preview tab permanent (click into it, double-click, type, explicit open). */
export function promotePreview(): void {
  const store = useTabStore.getState()
  const previewTab = store.getPreviewTab()
  if (previewTab) store.promotePreviewTab(previewTab.id)
  syncPreviewMode()
}

// ---------------------------------------------------------------------------
// Leaving and arriving
// ---------------------------------------------------------------------------

/**
 * Persist the three record sets the editor holds for `tab`, each under the
 * tab's own id. The stores' ids are checked against the tab, never assumed:
 * a store keyed to another document is skipped with a warning rather than
 * written under the wrong key (the §G failure).
 */
async function persistTabRecords(tab: Tab): Promise<void> {
  const annotationStore = useAnnotationStore.getState()
  // Await any in-flight annotation write first (#674 save race).
  if (annotationStore.pendingSave) await annotationStore.pendingSave
  if (useAnnotationStore.getState().documentId === tab.documentId) {
    await useAnnotationStore.getState().saveAnnotations()
  } else {
    console.warn('[tabs] annotation store keyed to another document; not persisted', {
      tabDocumentId: tab.documentId,
      storeDocumentId: useAnnotationStore.getState().documentId
    })
  }

  const editor = liveEditor()
  if (!editor) return

  // Never overwrite the stored set with an empty one: an empty editor here is
  // almost always a transient strip (a load or a source-mode toggle), not a
  // real "user cleared all". Genuine empties clear on tab close.
  const suggestions = getAISuggestions(editor)
  if (suggestions.length > 0) {
    await useSuggestionStore.getState().saveSuggestions(tab.documentId, suggestions)
  }

  const commentStore = useCommentStore.getState()
  if (commentStore.documentId === tab.documentId) {
    // Merge live mark positions with the store's rich data (replies +
    // resolved) so a switch doesn't clobber threads with marks-only data (#699).
    const comments = mergeCommentsForPersistence(editor, commentStore.pendingComments)
    await useCommentStore.getState().saveComments(tab.documentId, comments)
  } else {
    console.warn('[tabs] comment store keyed to another document; not persisted', {
      tabDocumentId: tab.documentId,
      storeDocumentId: commentStore.documentId
    })
  }
}

/**
 * The leaving step for the tab the editor currently holds. A no-op for any
 * other tab (a background tab has nothing to flush) and when the editor store
 * holds a different document than the tab says (never cache one document's
 * text into another tab). `persist: false` skips the conversation and record
 * writes for a tab whose stored data is about to be deleted.
 */
async function leaveTab(tab: Tab, opts: { persist?: boolean } = {}): Promise<void> {
  const persist = opts.persist ?? true
  if (tab.id !== useTabStore.getState().activeTabId) return
  flushEditorWrite()
  const current = useEditorStore.getState().document
  if (current.documentId !== tab.documentId) {
    console.warn('[tabs] leaveTab: editor document does not match the tab', {
      tabId: tab.id,
      tabDocumentId: tab.documentId,
      editorDocumentId: current.documentId
    })
    return
  }

  if (persist) {
    await useChatStore.getState().saveCurrentConversation(tab.documentId)
    await persistTabRecords(tab)
  }

  // Cache what the editor holds now; typing may have continued through the awaits.
  flushEditorWrite()
  const fresh = useEditorStore.getState()
  if (fresh.document.documentId !== tab.documentId) return
  useTabStore.getState().updateTab(tab.id, {
    content: fresh.document.content,
    frontmatter: fresh.document.frontmatter,
    cursorPosition: fresh.cursorPosition,
    viewState: captureEditorViewState(liveEditor()),
    isDirty: fresh.document.isDirty
  })
}

interface ArriveOptions {
  /** A brand-new untitled document: nothing stored to load, reset the chat. */
  fresh?: boolean
  /** Launch restore: the conversation that was open in this tab. */
  activeChatId?: string | null
  /** The tab's content was just read from disk: record the disk baseline (#843). */
  fromDisk?: boolean
  /** Add the path to the recent-files list. */
  recent?: boolean
}

/**
 * The arriving step. Activates `tab`, loads its document into the editor
 * store (the Editor's content-sync effect loads it into TipTap), then its
 * conversation and records. Read-only state is derived from the path inside
 * `setDocument`; preview state from the tab record.
 */
async function arriveTab(tab: Tab, opts: ArriveOptions = {}): Promise<void> {
  const annotationStore = useAnnotationStore.getState()
  // Pause annotation position mapping while the editor swaps documents.
  annotationStore.setLoadingDocument(true)
  if (opts.fresh) {
    // Id and (empty) records in one write: nothing of the previous document
    // can be read under the new id.
    useAnnotationStore.setState({ annotations: [], documentId: tab.documentId, createdThisSession: new Set() })
  } else {
    // Pre-set the id so the Editor's recovery effect does not fire a
    // competing load while the awaited one below runs (#674).
    annotationStore.setDocumentId(tab.documentId)
  }

  useTabStore.getState().setActiveTab(tab.id)

  const editorStore = useEditorStore.getState()
  editorStore.setDocument({
    documentId: tab.documentId,
    path: tab.path,
    content: tab.content ?? '',
    frontmatter: tab.frontmatter ?? {},
    isDirty: tab.isDirty
  })
  const cursor = tab.cursorPosition ?? { line: 1, column: 1 }
  editorStore.setCursorPosition(cursor.line, cursor.column)
  setCurrentDocumentId(tab.documentId)

  if (opts.fresh) {
    useChatStore.setState({ conversations: [], activeConversationId: null, messages: [], context: null })
    useSuggestionStore.getState().setDocumentId(tab.documentId)
    useCommentStore.getState().setDocumentId(tab.documentId)
  } else {
    await useChatStore.getState().loadForDocument(tab.documentId)
    if (opts.activeChatId) {
      const conversation = useChatStore.getState().conversations.find((c) => c.id === opts.activeChatId)
      if (conversation) {
        useChatStore.setState({ activeConversationId: conversation.id, messages: conversation.messages })
      }
    }
    await useAnnotationStore.getState().loadAnnotations(tab.documentId)
    await useSuggestionStore.getState().loadSuggestions(tab.documentId)
    await useCommentStore.getState().loadComments(tab.documentId)
  }

  syncPreviewMode()
  useEditorStore.getState().setEditing(true)

  if (tab.path) {
    useFileListStore.getState().revealAndSelectPath(tab.path)
    if (opts.recent) useSettingsStore.getState().addRecentFile(tab.path)
    if (opts.fromDisk) void recordDiskBaseline(tab.path)
  }

  // Resume position mapping once the editor has settled on the new document.
  setTimeout(() => {
    useAnnotationStore.getState().setLoadingDocument(false)
  }, 100)
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

/**
 * Open a file. Already open: switch to its tab (an explicit open of the
 * previewed file promotes the preview). Preview requested and a preview tab
 * exists: replace that tab's document. Active tab an empty untitled: replace
 * it in place. Otherwise: a new tab. Throws when the read fails.
 */
export async function openFile(path: string, opts: OpenFileOptions = {}): Promise<OpenResult> {
  const preview = opts.preview ?? false
  const tabStore = useTabStore.getState()

  const existing = tabStore.getTabByPath(path)
  if (existing) {
    if (!preview && existing.isPreview) tabStore.promotePreviewTab(existing.id)
    await switchToTab(existing.id)
    const current = useTabStore.getState().getTabById(existing.id)
    return {
      tabId: existing.id,
      documentId: existing.documentId,
      shouldDescribe: shouldDescribe(current?.content ?? '')
    }
  }

  const documentId = await generateIdFromPath(path)
  const parsed = await readDocument(path, documentId, opts)
  const title = titleFromPath(path)
  const placed = {
    documentId,
    path,
    title,
    isDirty: false,
    isPreview: preview,
    content: parsed.content,
    frontmatter: parsed.frontmatter,
    cursorPosition: { line: 1, column: 1 },
    viewState: undefined
  }

  const activeTab = useTabStore.getState().getActiveTab()
  const previewTab = preview ? useTabStore.getState().getPreviewTab() : null
  let tabId: string
  if (previewTab) {
    if (activeTab) await leaveTab(activeTab)
    useTabStore.getState().updateTab(previewTab.id, placed)
    tabId = previewTab.id
  } else if (activeTab && isEmptyUntitled(activeTab)) {
    useTabStore.getState().updateTab(activeTab.id, placed)
    tabId = activeTab.id
  } else {
    if (activeTab) await leaveTab(activeTab)
    tabId = useTabStore.getState().addTab(placed)
  }

  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) throw new Error('Tab vanished while opening')
  await arriveTab(tab, { fromDisk: true, recent: true })
  return { tabId, documentId, shouldDescribe: shouldDescribe(parsed.content) }
}

/**
 * Replace the document in an existing tab with a file: the reMarkable Edit /
 * View Original buttons swap the OCR copy and the editable copy inside one
 * tab. A path already open elsewhere switches there instead.
 */
export async function openInTab(
  tabId: string,
  path: string,
  opts: { access?: FileAccessOptions } = {}
): Promise<OpenResult> {
  const tabStore = useTabStore.getState()
  const tab = tabStore.getTabById(tabId)
  if (!tab) throw new Error(`Tab not found: ${tabId}`)
  const existing = tabStore.getTabByPath(path)
  if (existing && existing.id !== tabId) return openFile(path, opts)

  const documentId = await generateIdFromPath(path)
  const parsed = await readDocument(path, documentId, opts)
  await leaveTab(tab)
  useTabStore.getState().updateTab(tabId, {
    documentId,
    path,
    title: titleFromPath(path),
    isDirty: false,
    content: parsed.content,
    frontmatter: parsed.frontmatter,
    cursorPosition: { line: 1, column: 1 },
    viewState: undefined
  })
  const next = useTabStore.getState().getTabById(tabId)
  if (!next) throw new Error('Tab vanished while opening')
  await arriveTab(next, { fromDisk: true, recent: true })
  return { tabId, documentId, shouldDescribe: shouldDescribe(parsed.content) }
}

/**
 * A new untitled tab. `init` pre-populates it (the prose:// handler, the
 * `new_file` tool); content is in the tab and the store before the editor
 * reads it. Tolerates a click event as `init` (explorer button).
 */
export async function newTab(init?: NewTabInit): Promise<string> {
  const content = typeof init?.content === 'string' ? init.content : ''
  const frontmatter =
    init?.frontmatter && typeof init.frontmatter === 'object' ? init.frontmatter : {}
  const isDirty = init?.isDirty === true

  const activeTab = useTabStore.getState().getActiveTab()
  if (activeTab) await leaveTab(activeTab)

  const documentId = generateId()
  const title = generateUntitledTitle()
  const tabId = useTabStore.getState().addTab({
    documentId,
    path: null,
    title,
    baseTitle: title,
    isDirty,
    content,
    frontmatter,
    cursorPosition: { line: 1, column: 1 }
  })
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) throw new Error('Tab vanished while creating')
  await arriveTab(tab, { fresh: true })
  return tabId
}

/** Switch to an open tab. Already active: re-derive preview state and return. */
export async function switchToTab(tabId: string): Promise<void> {
  const tabStore = useTabStore.getState()
  const target = tabStore.getTabById(tabId)
  if (!target) return
  if (tabId === tabStore.activeTabId) {
    syncPreviewMode()
    return
  }

  const activeTab = tabStore.getActiveTab()
  if (activeTab) await leaveTab(activeTab)

  pipelineLog('tab:switch', {
    toTabId: tabId,
    toDocId: target.documentId,
    fromDocId: useAnnotationStore.getState().documentId,
    annotationCountBefore: useAnnotationStore.getState().annotations.length
  })

  const tab = useTabStore.getState().getTabById(tabId)
  if (tab) await arriveTab(tab)
}

/**
 * Close a tab. Returns false when the tab is dirty and `force` is not set
 * (the caller confirms). The closing tab is flushed and persisted under its
 * own id before it leaves the store; its neighbour then arrives with no
 * leaving step of its own.
 */
export async function closeTab(tabId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const tabStore = useTabStore.getState()
  let tab = tabStore.getTabById(tabId)
  if (!tab) return true
  if (tab.isDirty && !opts.force) return false

  const wasActive = tabId === tabStore.activeTabId
  const untitled = tab.path === null
  if (wasActive) {
    await leaveTab(tab, { persist: !untitled })
    tab = useTabStore.getState().getTabById(tabId) ?? tab
  }

  if (!tab.isPreview) useTabStore.getState().pushClosedTab(snapshotOf(tab))
  useTabStore.getState().removeTab(tabId)
  if (untitled) await deleteDocumentRecords(tab.documentId)

  const after = useTabStore.getState()
  if (after.tabs.length === 0) {
    await newTab()
  } else if (wasActive && after.activeTabId) {
    const next = after.getTabById(after.activeTabId)
    if (next) await arriveTab(next)
  } else {
    syncPreviewMode()
  }
  return true
}

/** Close every tab but one (dirty tabs included; the caller confirms). */
export async function closeOtherTabs(keepTabId: string): Promise<void> {
  const tabStore = useTabStore.getState()
  const keep = tabStore.getTabById(keepTabId)
  if (!keep) return

  const activeTab = tabStore.getActiveTab()
  const activeLeaves = activeTab !== null && activeTab.id !== keepTabId
  if (activeTab && activeLeaves) {
    await leaveTab(activeTab, { persist: !(activeTab.path === null && !activeTab.isDirty) })
  }

  const removing = useTabStore.getState().tabs.filter((t) => t.id !== keepTabId)
  // Oldest to newest so the newest lands on top of the reopen stack.
  for (const tab of removing) {
    if (!tab.isPreview) useTabStore.getState().pushClosedTab(snapshotOf(tab))
  }
  for (const tab of removing) {
    if (!tab.isDirty && !tab.path) await deleteDocumentRecords(tab.documentId)
  }

  useTabStore.getState().closeOtherTabs(keepTabId)
  if (activeLeaves) {
    const next = useTabStore.getState().getTabById(keepTabId)
    if (next) await arriveTab(next)
  } else {
    syncPreviewMode()
  }
}

/** Close every tab and open a fresh untitled one. */
export async function closeAllTabs(): Promise<void> {
  const activeTab = useTabStore.getState().getActiveTab()
  if (activeTab) {
    await leaveTab(activeTab, { persist: !(activeTab.path === null && !activeTab.isDirty) })
  }
  const tabs = useTabStore.getState().tabs
  for (const tab of tabs) {
    if (!tab.isPreview) useTabStore.getState().pushClosedTab(snapshotOf(tab))
  }
  for (const tab of tabs) {
    if (!tab.isDirty && !tab.path) await deleteDocumentRecords(tab.documentId)
  }
  useTabStore.getState().closeAllTabs()
  await newTab()
}

/**
 * Reopen the most recently closed tab. The snapshot is popped before any
 * await so rapid presses each consume a distinct entry. A clean snapshot of a
 * file re-reads the file (it may have changed since the close) and records
 * the baseline; a dirty one keeps its unsaved text.
 */
export async function reopenLastClosedTab(): Promise<void> {
  const snapshot = useTabStore.getState().popClosedTab()
  if (!snapshot) return

  if (snapshot.path) {
    const existing = useTabStore.getState().getTabByPath(snapshot.path)
    if (existing) {
      await switchToTab(existing.id)
      return
    }
  }

  const documentId = snapshot.path ? await generateIdFromPath(snapshot.path) : generateId()
  let content = snapshot.content
  let frontmatter = snapshot.frontmatter
  let fromDisk = false
  if (snapshot.path && !snapshot.isDirty) {
    const disk = await readDocumentFromDisk(snapshot.path)
    if (disk) {
      content = disk.content
      frontmatter = disk.frontmatter
      fromDisk = true
    }
  }

  const activeTab = useTabStore.getState().getActiveTab()
  if (activeTab) await leaveTab(activeTab)

  const tabId = useTabStore.getState().reopenLastClosedTab({ ...snapshot, content, frontmatter }, documentId)
  const tab = useTabStore.getState().getTabById(tabId)
  if (tab) await arriveTab(tab, { fromDisk, recent: snapshot.path !== null })
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface IdentityChange {
  path: string | null
  /** Defaults to the path-derived id (SHA-256 of the path). */
  documentId?: string
  /**
   * What happens to the old path's disk baseline. `transfer` for a rename or
   * move on disk (the content still agrees with the file); `clear` (default)
   * when the caller writes the file itself and records the new baseline.
   */
  baseline?: 'transfer' | 'clear'
}

/**
 * Give a tab a new path and identity: rename, move, Save As, quick save,
 * `save_file`, the converters. The tab record, the editor store, the chat
 * store and the three record stores all follow, and the stored records move
 * to the new key (old keys stay, as before). For the active tab the live
 * records are the source; for a background tab they are copied in IndexedDB.
 */
export async function setTabIdentity(tabId: string, next: IdentityChange): Promise<string> {
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) throw new Error(`Tab not found: ${tabId}`)
  const oldPath = tab.path
  const oldDocumentId = tab.documentId
  const documentId =
    next.documentId ?? (next.path ? await generateIdFromPath(next.path) : oldDocumentId)
  const isActive = tabId === useTabStore.getState().activeTabId

  pipelineLog('tab:identity', {
    tabId,
    oldPath,
    newPath: next.path,
    oldDocId: oldDocumentId,
    newDocId: documentId
  })

  if (documentId !== oldDocumentId) {
    if (isActive) {
      const editor = liveEditor()
      const annotationStore = useAnnotationStore.getState()
      if (annotationStore.pendingSave) await annotationStore.pendingSave
      const annotations = useAnnotationStore
        .getState()
        .annotations.map((a) => ({ ...a, documentId }))
      useAnnotationStore.setState({ annotations, documentId })
      if (annotations.length > 0) await saveAnnotations(documentId, annotations)

      useSuggestionStore.setState({ documentId })
      const suggestions = editor ? getAISuggestions(editor) : []
      if (suggestions.length > 0) await saveSuggestions(documentId, suggestions)

      const comments = editor
        ? mergeCommentsForPersistence(editor, useCommentStore.getState().pendingComments)
        : useCommentStore.getState().pendingComments
      useCommentStore.setState({ documentId })
      if (comments.length > 0) await saveComments(documentId, comments)

      const conversations = useChatStore
        .getState()
        .conversations.map((c) => ({ ...c, documentId }))
      useChatStore.setState({ conversations })
      setCurrentDocumentId(documentId)
      if (conversations.length > 0) await saveConversations(documentId, conversations)
    } else {
      const [annotations, conversations, suggestions, comments] = await Promise.all([
        loadAnnotations(oldDocumentId),
        loadConversations(oldDocumentId),
        loadSuggestions(oldDocumentId),
        loadComments(oldDocumentId)
      ])
      await Promise.all([
        annotations.length > 0
          ? saveAnnotations(documentId, annotations.map((a) => ({ ...a, documentId })))
          : Promise.resolve(),
        conversations.length > 0
          ? saveConversations(documentId, conversations.map((c) => ({ ...c, documentId })))
          : Promise.resolve(),
        suggestions.length > 0 ? saveSuggestions(documentId, suggestions) : Promise.resolve(),
        comments.length > 0 ? saveComments(documentId, comments) : Promise.resolve()
      ])
    }
    pipelineLog('tab:identity:migrated', { oldDocId: oldDocumentId, newDocId: documentId })
  }

  useTabStore.getState().updateTab(tabId, {
    path: next.path,
    documentId,
    title: next.path ? titleFromPath(next.path) : tab.title
  })
  if (isActive) {
    useEditorStore.getState().setDocument({ documentId, path: next.path })
  }

  if (oldPath && oldPath !== next.path) {
    if (next.path && next.baseline === 'transfer') transferDiskBaseline(oldPath, next.path)
    else clearDiskBaseline(oldPath)
    if (next.path) {
      // Keep share-sync metadata pointing at the renamed file (#768). A miss
      // only means the ShareDialog loses the association until the next publish.
      void getApi().shareUpdateLocalPath(oldPath, next.path, documentId).catch(() => {})
    }
  }

  return documentId
}

/**
 * A save just wrote the active tab's document to `path`: the tab adopts the
 * path (identity and records follow when it changed), the dirty flag clears
 * and the disk baseline is recorded (#843).
 */
export async function markActiveTabSaved(path: string): Promise<void> {
  const activeTabId = useTabStore.getState().activeTabId
  if (!activeTabId) return
  const tab = useTabStore.getState().getTabById(activeTabId)
  if (tab && tab.path !== path) await setTabIdentity(activeTabId, { path })
  useEditorStore.getState().setDirty(false)
  useTabStore.getState().updateTab(activeTabId, { isDirty: false })
  void recordDiskBaseline(path)
}

/**
 * Rename a tab's file in place (tab bar double-click). Returns the new path,
 * or null when the name is invalid, taken, or the rename fails.
 */
export async function renameTab(tabId: string, newTitle: string): Promise<string | null> {
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab || !tab.path) return null

  // Windows-safe, blocks path traversal
  const sanitized = newTitle.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
  if (!sanitized) return null

  const dir = tab.path.substring(0, tab.path.lastIndexOf('/'))
  const oldExt = tab.path.match(/\.(md|markdown|txt)$/)?.[0] || '.md'
  const newName = `${sanitized}${oldExt}`
  const newPath = `${dir}/${newName}`
  if (newPath === tab.path) return tab.path

  try {
    if (!window.api) return null
    if (await window.api.fileExists(newPath)) {
      console.warn(`Cannot rename: file "${newName}" already exists`)
      return null
    }
    await window.api.renameFile(tab.path, newPath)
    await setTabIdentity(tabId, { path: newPath, baseline: 'transfer' })
    await useFileListStore.getState().loadFiles()
    useFileListStore.getState().selectFile(newPath)
    return newPath
  } catch (error) {
    console.error('Error renaming tab file:', error)
    return null
  }
}

/**
 * The explorer renamed or moved a file (or a folder above it) on disk: point
 * every open tab under `oldPath` at its new location.
 */
export async function relocateOpenTabs(oldPath: string, newPath: string): Promise<void> {
  const remap = (p: string): string | null => {
    if (p === oldPath) return newPath
    if (p.startsWith(`${oldPath}/`)) return `${newPath}${p.slice(oldPath.length)}`
    return null
  }
  for (const tab of useTabStore.getState().tabs) {
    if (!tab.path) continue
    const migrated = remap(tab.path)
    if (migrated && migrated !== tab.path) {
      await setTabIdentity(tab.id, { path: migrated, baseline: 'transfer' })
    }
  }
}

// ---------------------------------------------------------------------------
// Content replacement
// ---------------------------------------------------------------------------

/**
 * Replace a tab's content with text read from disk (conflict dialog "load
 * disk version", a clean tab gone stale on focus, a reMarkable re-sync). The
 * active tab's editor follows through the store. Records the baseline.
 */
export function reloadTabFromDisk(tabId: string, doc: ParsedDocument): void {
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) return
  useTabStore.getState().updateTab(tabId, {
    content: doc.content,
    frontmatter: doc.frontmatter,
    isDirty: false
  })
  if (tabId === useTabStore.getState().activeTabId) {
    useEditorStore.getState().setDocument({
      documentId: tab.documentId,
      path: tab.path,
      content: doc.content,
      frontmatter: doc.frontmatter,
      isDirty: false
    })
  }
  if (tab.path) void recordDiskBaseline(tab.path)
}

/**
 * Convert a tab's file between `.md` and `.txt`: rename on disk, write the
 * converted text, move the identity, reload the content. Returns false when
 * the tab has no path of the other kind.
 */
export async function convertTab(tabId: string, to: 'txt' | 'md'): Promise<boolean> {
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab?.path || !window.api) return false
  const from = to === 'txt' ? /\.md$/ : /\.txt$/
  if (!from.test(tab.path)) return false
  const newPath = tab.path.replace(from, `.${to}`)
  const isActive = tabId === useTabStore.getState().activeTabId
  const editor = liveEditor()
  if (isActive) flushEditorWrite()
  const current =
    isActive && useEditorStore.getState().document.documentId === tab.documentId
      ? useEditorStore.getState().document
      : { content: tab.content ?? '', frontmatter: tab.frontmatter ?? {} }

  let fileText: string
  let nextContent: string
  let nextFrontmatter: Record<string, unknown>
  if (to === 'txt') {
    const plainText =
      isActive && editor ? editor.getText({ blockSeparator: '\n' }) : current.content
    fileText = plainText
    nextContent = plainText
    nextFrontmatter = {}
  } else {
    fileText = serializeMarkdown(current.content, current.frontmatter)
    nextContent = current.content
    nextFrontmatter = current.frontmatter
  }

  await window.api.renameFile(tab.path, newPath)
  await window.api.saveFile(newPath, fileText)
  await setTabIdentity(tabId, { path: newPath })
  if (to === 'txt' && isActive && editor) {
    // The plain-text document, re-read the way a .txt open prepares it.
    editor.commands.setContent(prepareTextContent(nextContent))
  }
  reloadTabFromDisk(tabId, { content: nextContent, frontmatter: nextFrontmatter })
  useFileListStore.getState().loadFiles()
  return true
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * Restore a saved session: add every tab, then arrive at the active one.
 * App resolves each draft against the disk first (missing, stale, conflict).
 */
export async function restoreTabs(restored: RestoredTab[], activeTabId: string | null): Promise<void> {
  const tabStore = useTabStore.getState()
  for (const entry of restored) {
    tabStore.addTab({
      id: entry.draft.tabId,
      documentId: entry.draft.documentId,
      path: entry.path,
      title: entry.draft.title,
      baseTitle: entry.draft.baseTitle,
      isDirty: entry.isDirty,
      content: entry.content,
      frontmatter: entry.frontmatter,
      cursorPosition: entry.draft.cursorPosition,
      viewState: entry.draft.viewState
    })
  }
  const active =
    (activeTabId && restored.find((e) => e.draft.tabId === activeTabId)) ||
    restored[restored.length - 1]
  if (!active) return
  const tab = useTabStore.getState().getTabById(active.draft.tabId)
  if (!tab) return
  await arriveTab(tab, { activeChatId: active.draft.activeChatId, fromDisk: active.fromDisk })
}

/** Restore a legacy single-document draft (pre-session builds). */
export async function hydrateDraft(draft: DraftState): Promise<void> {
  useEditorStore.getState().hydrateFromDraft(draft)
  setCurrentDocumentId(draft.document.documentId)

  const title = draft.document.path ? titleFromPath(draft.document.path) : 'Untitled'
  useTabStore.getState().addTab({
    documentId: draft.document.documentId,
    path: draft.document.path,
    title,
    isDirty: draft.document.isDirty,
    content: draft.document.content,
    cursorPosition: draft.cursorPosition
  })

  if (draft.fileList) {
    useFileListStore.setState({
      viewMode: draft.fileList.viewMode,
      rootPath: draft.fileList.rootPath,
      expandedFolders: new Set(draft.fileList.expandedFolders),
      selectedPath: draft.fileList.selectedPath
    })
    if (draft.fileList.rootPath) useFileListStore.getState().loadFiles()
  }

  const conversations = await loadConversations(draft.document.documentId)
  useChatStore.setState({
    conversations,
    activeConversationId: draft.activeChatId ?? conversations[0]?.id ?? null,
    messages:
      conversations.find((c) => c.id === draft.activeChatId)?.messages ??
      conversations[0]?.messages ??
      []
  })
}

// ---------------------------------------------------------------------------
// Store → tab mirror (until the session projection replaces it)
// ---------------------------------------------------------------------------

/**
 * Keep the active tab's cached content, dirty flag and title in step with the
 * editor store, which the Editor writes on its 500 ms debounce. The tab bar's
 * dirty dot and the saved session (which reads tab content) depend on it.
 * Typing in a preview promotes it. Identity (path, documentId) is never
 * synced from here; the identity flows above write both sides themselves.
 */
function syncActiveTabWithDocument(): void {
  const activeTab = useTabStore.getState().getActiveTab()
  if (!activeTab) return
  const { document } = useEditorStore.getState()
  if (document.documentId !== activeTab.documentId) return

  if (activeTab.isPreview && document.isDirty) promotePreview()

  if (activeTab.isDirty !== document.isDirty || activeTab.content !== document.content) {
    useTabStore.getState().updateTab(activeTab.id, {
      isDirty: document.isDirty,
      content: document.content,
      frontmatter: document.frontmatter
    })
  }
}

useEditorStore.subscribe((state) => state.document, syncActiveTabWithDocument)
