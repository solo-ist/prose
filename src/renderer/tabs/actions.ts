/**
 * Tab lifecycle actions (#1145, per-tab document sessions).
 *
 * Every way a document enters a tab, leaves it, or changes identity goes
 * through one of these functions: the tab bar, the menus, the explorer, the
 * reMarkable buttons, the chat tools (`select_tab`, `open_file`, `new_file`,
 * `save_file`), the converters and the launch restore. `useTabs` is a thin
 * React binding over them so components keep their names.
 *
 * Every flow has the same two halves. The *leaving* step runs for the tab the
 * editor currently holds: land the session's pending projections, save the
 * conversation, persist the three record sets under the leaving tab's own id,
 * cache the status-bar cursor into the tab record. The *arriving* step opens
 * the tab's session if it has none (from the tab's cached text, lazily), puts
 * its state into the view (document/session.ts activateSession: the stores
 * become mirrors of its records, the editor store gets its document, preview
 * and read-only state derive from the tab), then loads its conversation and
 * reveals it in the explorer. The leaving step always names the tab it
 * flushes, so closing the active tab can no longer write the closed tab's
 * state into its neighbour.
 */

import { useTabStore, generateUntitledTitle, activeTabOf, type Tab, type ClosedTabSnapshot } from '../stores/tabStore'
import { useEditorStore } from '../stores/editorStore'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useFileListStore } from '../stores/fileListStore'
import { parseMarkdown, prepareTextContent, serializeMarkdown } from '../lib/markdown'
import { resolveOpenedFileContent } from '../lib/openDocument'
import { getApi } from '../lib/browserApi'
import { pipelineLog } from '../lib/aiPipelineLog'
import { handleMissingPath, isMissingPathFileError } from '../lib/stalePath'
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
  loadAnnotations,
  loadSuggestions,
  loadComments
} from '../lib/persistence'
import type { DraftState, TabDraft } from '../lib/persistence'
import type { FileAccessOptions } from '../../shared/fileAccess'
import {
  openSession,
  activateSession,
  closeSession,
  hasSession,
  getActiveSession,
  flushActiveProjections,
  persistSessionRecords,
  persistRecords,
  deleteDocumentRecords,
  setSessionIdentity,
  markTabClosing,
  replaceSessionDocument,
  markFrontmatterChanged,
  recordSaved,
  saveSnapshot,
  enterSource,
  exitSource,
  getSession,
  type SaveSnapshot
} from '../document/session'
import { isPlainTextPath } from '../document/identity'

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
    viewState: tab.viewState,
    mode: tab.mode
  }
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
    flushActiveProjections()
    const current = useEditorStore.getState().document
    if (current.documentId === tab.documentId) content = current.content
  }
  const trimmed = content.trim()
  if (trimmed === '') return true
  // TipTap may leave empty content as empty tags like <p></p>
  return trimmed.replace(/<[^>]*>/g, '').trim() === ''
}

/**
 * A tab leaves the store: its session is closed (records written one last
 * time, or every stored set deleted for a discarded untitled document).
 */
async function retireTab(tab: Tab, opts: { discard: boolean }): Promise<void> {
  // A chat turn bound to a discarded document finishes without writing (#1148).
  if (opts.discard) useChatStore.getState().discardDocument(tab.documentId)
  const hadSession = await closeSession(tab.id, { discard: opts.discard })
  if (!hadSession && opts.discard) await deleteDocumentRecords(tab.documentId)
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
  const { tabs } = useTabStore.getState()
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
 * The leaving step for the tab the editor currently holds. A no-op for any
 * other tab (a background tab has nothing to flush) and when the editor store
 * holds a different document than the tab says (never cache one document's
 * text into another tab). `persist: false` skips the conversation and record
 * writes for a tab whose stored data is about to be deleted.
 */
async function leaveTab(tab: Tab, opts: { persist?: boolean } = {}): Promise<void> {
  const persist = opts.persist ?? true
  if (tab.id !== useTabStore.getState().activeTabId) return
  flushActiveProjections()
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
    await persistSessionRecords(tab.id)
  }

  // The projection keeps the record's content, frontmatter and dirty flag
  // current (#1151); land a pending one (typing may have continued through
  // the awaits) and cache the status-bar cursor.
  flushActiveProjections()
  const fresh = useEditorStore.getState()
  if (fresh.document.documentId !== tab.documentId) return
  useTabStore.getState().updateTab(tab.id, { cursorPosition: fresh.cursorPosition })
}

interface ArriveOptions {
  /** A brand-new untitled document: reset the chat instead of loading one. */
  fresh?: boolean
  /** Launch restore: the conversation that was open in this tab. */
  activeChatId?: string | null
  /** The tab's content was just read from disk: record the disk baseline (#843). */
  fromDisk?: boolean
  /** Add the path to the recent-files list. */
  recent?: boolean
}

/**
 * The arriving step. Opens the tab's session when it has none (lazily, from
 * the tab's cached text and its saved view), puts it into the view, then
 * loads the conversation and settles the UI around it.
 */
async function arriveTab(tab: Tab, opts: ArriveOptions = {}): Promise<void> {
  if (!hasSession(tab.id)) {
    await openSession(tab, tab.content ?? '', { viewState: tab.viewState })
  }
  const current = useTabStore.getState().getTabById(tab.id)
  if (!current) return
  // A tab that was in source mode (a relaunch, a reopen) comes back in it (#1150).
  if (current.mode === 'source' && !getSession(current.id)?.source) enterSource(current.id)
  activateSession(current.id)

  // The conversations are loaded before anything saves under the new id:
  // the list carries the document it belongs to (#1148).
  if (opts.fresh) {
    useChatStore.getState().resetForNewDocument(current.documentId)
  } else {
    await useChatStore.getState().loadForDocument(current.documentId)
    if (opts.activeChatId) {
      const conversation = useChatStore.getState().conversations.find((c) => c.id === opts.activeChatId)
      if (conversation) {
        useChatStore.setState({ activeConversationId: conversation.id, messages: conversation.messages })
      }
    }
  }

  syncPreviewMode()
  useEditorStore.getState().setEditing(true)

  if (current.path) {
    useFileListStore.getState().revealAndSelectPath(current.path)
    if (opts.recent) useSettingsStore.getState().addRecentFile(current.path)
    if (opts.fromDisk) void recordDiskBaseline(current.path)
  }
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
    await retireTab(previewTab, { discard: false })
    useTabStore.getState().updateTab(previewTab.id, placed)
    tabId = previewTab.id
  } else if (activeTab && isEmptyUntitled(activeTab)) {
    await retireTab(activeTab, { discard: true })
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
  await retireTab(tab, { discard: tab.path === null })
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
 * `new_file` tool). Tolerates a click event as `init` (explorer button).
 */
export async function newTab(init?: NewTabInit): Promise<string> {
  // A block in the given text (the `new_file` tool) is the tab's frontmatter,
  // never body text: no record carries one (#1151).
  const parsed = parseMarkdown(typeof init?.content === 'string' ? init.content : '')
  const content = parsed.content
  const frontmatter = {
    ...(init?.frontmatter && typeof init.frontmatter === 'object' ? init.frontmatter : {}),
    ...parsed.frontmatter
  }
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

/**
 * Open a file in a tab that is not shown (#1148): a chat turn whose document
 * was closed mid-turn gets it back from disk and finishes there. A path
 * already open is returned as is. Null when the file cannot be read.
 */
export async function openInBackground(path: string): Promise<{ tabId: string; documentId: string } | null> {
  const existing = useTabStore.getState().getTabByPath(path)
  if (existing) return { tabId: existing.id, documentId: existing.documentId }
  const documentId = await generateIdFromPath(path)
  const disk = await readDocumentFromDisk(path)
  if (!disk) return null
  const tabId = useTabStore.getState().addTab(
    {
      documentId,
      path,
      title: titleFromPath(path),
      isDirty: false,
      content: disk.content,
      frontmatter: disk.frontmatter,
      cursorPosition: { line: 1, column: 1 }
    },
    { activate: false }
  )
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) throw new Error('Tab vanished while opening in the background')
  await openSession(tab, disk.content)
  recordDiskBaseline(path).catch(() => {})
  pipelineLog('tab:background-open', { tabId, documentId, path })
  return { tabId, documentId }
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

  pipelineLog('tab:switch', { toTabId: tabId, toDocId: target.documentId })

  const tab = useTabStore.getState().getTabById(tabId)
  if (tab) await arriveTab(tab)
}

/**
 * Close a tab. Returns false when the tab is dirty and `force` is not set
 * (the caller confirms). The closing tab is flushed and its session closed
 * under its own id before it leaves the store; its neighbour then arrives
 * with no leaving step of its own.
 */
export async function closeTab(tabId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const tabStore = useTabStore.getState()
  let tab = tabStore.getTabById(tabId)
  if (!tab) return true
  if (tab.isDirty && !opts.force) return false

  const wasActive = tabId === tabStore.activeTabId
  const untitled = tab.path === null
  // A chat turn bound to this tab must not find it half-closed (session gone,
  // record still there) and open an orphan session (#1148).
  markTabClosing(tabId, true)
  try {
    if (wasActive) {
      await leaveTab(tab, { persist: !untitled })
      tab = useTabStore.getState().getTabById(tabId) ?? tab
    }

    if (!tab.isPreview) useTabStore.getState().pushClosedTab(snapshotOf(tab))
    await retireTab(tab, { discard: untitled })
    useTabStore.getState().removeTab(tabId)
  } finally {
    markTabClosing(tabId, false)
  }

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
  // Stored data is dropped only for clean untitled documents.
  for (const tab of removing) markTabClosing(tab.id, true)
  try {
    for (const tab of removing) {
      await retireTab(tab, { discard: !tab.isDirty && !tab.path })
    }
    useTabStore.getState().closeOtherTabs(keepTabId)
  } finally {
    for (const tab of removing) markTabClosing(tab.id, false)
  }
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
  for (const tab of tabs) markTabClosing(tab.id, true)
  try {
    for (const tab of tabs) {
      await retireTab(tab, { discard: !tab.isDirty && !tab.path })
    }
    useTabStore.getState().closeAllTabs()
  } finally {
    for (const tab of tabs) markTabClosing(tab.id, false)
  }
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
 * store and the session (its state's identity, the mirrors, the stored
 * records under the new key; old keys stay, as before) all follow. A tab
 * without a session has its stored records copied in IndexedDB.
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
    if (hasSession(tabId)) {
      await setSessionIdentity(tabId, { documentId, path: next.path, plain: isPlainTextPath(next.path) })
    } else {
      const [annotations, suggestions, comments] = await Promise.all([
        loadAnnotations(oldDocumentId),
        loadSuggestions(oldDocumentId),
        loadComments(oldDocumentId)
      ])
      await Promise.all([
        annotations.length > 0
          ? persistRecords('annotations', documentId, annotations.map((a) => ({ ...a, documentId })))
          : Promise.resolve(),
        suggestions.length > 0 ? persistRecords('suggestions', documentId, suggestions) : Promise.resolve(),
        comments.length > 0 ? persistRecords('comments', documentId, comments) : Promise.resolve()
      ])
    }

    // The shown list, a parked list and any live turn follow the new id in
    // the store; the stored rows are copied for a document that is not shown.
    useChatStore.getState().rekeyDocument(oldDocumentId, documentId)
    if (isActive) {
      const conversations = useChatStore.getState().conversations
      if (conversations.length > 0) await saveConversations(documentId, conversations)
    } else {
      const conversations = await loadConversations(oldDocumentId)
      if (conversations.length > 0) {
        await saveConversations(documentId, conversations.map((c) => ({ ...c, documentId })))
      }
    }
    pipelineLog('tab:identity:migrated', { oldDocId: oldDocumentId, newDocId: documentId })
  } else if (hasSession(tabId) && next.path !== oldPath) {
    await setSessionIdentity(tabId, { documentId, path: next.path, plain: isPlainTextPath(next.path) })
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
export async function markActiveTabSaved(path: string, written?: SaveSnapshot): Promise<void> {
  const activeTabId = useTabStore.getState().activeTabId
  if (!activeTabId) return
  await markTabSaved(activeTabId, path, written)
}

/**
 * A tab's document was written to `path` (the active one, or a background one
 * a chat turn saved, #1148). `written` is the snapshot the save wrote: the
 * session records it and the projection clears the dirty flag, so typing
 * that went on during the write keeps the tab dirty (#1151).
 */
export async function markTabSaved(tabId: string, path: string, written?: SaveSnapshot): Promise<void> {
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) return
  if (tab.path !== path) await setTabIdentity(tabId, { path })
  if (hasSession(tabId)) recordSaved(tabId, written ?? saveSnapshot(tabId))
  else useTabStore.getState().updateTab(tabId, { isDirty: false })
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
 * disk version", a clean tab gone stale on focus, a reMarkable re-sync, a
 * conversion). A tab with a session is re-opened from the new text under the
 * same tab; a lazy tab only has its cache replaced. Records the baseline.
 */
export async function reloadTabFromDisk(tabId: string, doc: ParsedDocument): Promise<void> {
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab) return
  useTabStore.getState().updateTab(tabId, {
    content: doc.content,
    frontmatter: doc.frontmatter,
    isDirty: false
  })
  if (hasSession(tabId)) {
    // The re-open seeds the saved snapshot from the new text (the record is clean).
    await replaceSessionDocument(
      tabId,
      { content: doc.content, body: doc.content, frontmatter: doc.frontmatter },
      { keepHistory: false }
    )
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
  // The typed text first, as a document replace follows (#1150).
  if (getSession(tabId)?.source) exitSource(tabId)
  if (isActive) flushActiveProjections()
  // The record is the truth for both tabs once the projection landed (#1151).
  const fresh = useTabStore.getState().getTabById(tabId) ?? tab
  const current = { content: fresh.content ?? '', frontmatter: fresh.frontmatter ?? {} }

  let fileText: string
  let nextContent: string
  let nextFrontmatter: Record<string, unknown>
  if (to === 'txt') {
    // The document's text, one line per block, as the file; the editor shows
    // it the way a .txt open prepares it.
    const session = isActive ? getActiveSession() : null
    const plainText = session
      ? session.state.doc.textBetween(0, session.state.doc.content.size, '\n')
      : current.content
    fileText = plainText
    nextContent = prepareTextContent(plainText)
    nextFrontmatter = {}
  } else {
    fileText = serializeMarkdown(current.content, current.frontmatter)
    nextContent = current.content
    nextFrontmatter = current.frontmatter
  }

  await window.api.renameFile(tab.path, newPath)
  await window.api.saveFile(newPath, fileText)
  await setTabIdentity(tabId, { path: newPath })
  await reloadTabFromDisk(tabId, { content: nextContent, frontmatter: nextFrontmatter })
  useFileListStore.getState().loadFiles()
  return true
}

// ---------------------------------------------------------------------------
// Frontmatter and source mode (the active tab)
// ---------------------------------------------------------------------------

/**
 * The frontmatter editor, the `edit` tool or the overlay's Accept replaced a
 * tab's frontmatter (#1151): the record is the truth and the projection
 * marks the tab dirty (or clean again) at once. A lazy tab is marked dirty
 * directly; its session reads the record when it opens.
 */
export function setTabFrontmatter(tabId: string, frontmatter: Record<string, unknown>): void {
  const store = useTabStore.getState()
  if (!store.getTabById(tabId)) return
  store.updateTab(tabId, { frontmatter })
  if (hasSession(tabId)) markFrontmatterChanged(tabId)
  else store.updateTab(tabId, { isDirty: true })
}

/** Source mode for a tab, shown or not; refused on a preview or reMarkable tab (#1150). */
export function enterSourceMode(tabId: string | null = useTabStore.getState().activeTabId): boolean {
  if (!tabId) return false
  const tab = useTabStore.getState().getTabById(tabId)
  if (!tab || tab.isPreview || tab.readOnly || !hasSession(tabId)) return false
  enterSource(tabId)
  return true
}

/** Back to the rich editor: the typed text becomes the document in one undo step when it changed. */
export function exitSourceMode(tabId: string | null = useTabStore.getState().activeTabId): void {
  if (tabId) exitSource(tabId)
}

/** The one toggle behind the toolbar, the status bar, the View menu and ⌘⇧E. */
export function toggleSourceMode(): void {
  const tabId = useTabStore.getState().activeTabId
  if (!tabId) return
  if (getSession(tabId)?.source) exitSourceMode(tabId)
  else enterSourceMode(tabId)
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * Restore a saved session: add every tab, then arrive at the active one (the
 * only one that gets a document session before it is clicked). App resolves
 * each draft against the disk first (missing, stale, conflict).
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
      viewState: entry.draft.viewState,
      mode: entry.draft.mode
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
  const title = draft.document.path ? titleFromPath(draft.document.path) : 'Untitled'
  const tabId = useTabStore.getState().addTab({
    documentId: draft.document.documentId,
    path: draft.document.path,
    title,
    isDirty: draft.document.isDirty,
    content: draft.document.content,
    frontmatter: draft.document.frontmatter,
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

  const tab = useTabStore.getState().getTabById(tabId)
  if (tab) await arriveTab(tab, { activeChatId: draft.activeChatId })
}

// ---------------------------------------------------------------------------
// Preview promotion on dirty
// ---------------------------------------------------------------------------

// A preview tab that goes dirty (a write the read-only view did not stop) is
// promoted, as the old store→tab mirror did; the editor store's mirror of the
// active record lives in document/session.ts (#1151).
useTabStore.subscribe(activeTabOf, (tab) => {
  if (tab?.isPreview && tab.isDirty) promotePreview()
})
