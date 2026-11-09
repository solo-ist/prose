import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './components/layout/App'
import {
  initDB,
  loadAnnotations as loadAnnotationsFromDB,
  loadComments as loadCommentsFromDB,
  loadReviewLog,
  loadSuggestions as loadSuggestionsFromDB,
  loadTracked
} from './lib/persistence'
import { getSessionTabIds, getProjectionStats, getActiveSession, getSession } from './document/session'
import { sourceFolds, sourceSelection, sourceText } from './extensions/source/state'
import { getIdentity } from './document/identity'
import { useCommandHistoryStore } from './stores/commandHistoryStore'
import { seedEmojiCache } from './lib/emojiService'
import { ErrorBoundary } from './lib/sentry'
import { dumpPipelineLog, clearPipelineLog } from './lib/aiPipelineLog'
import { executeTool } from './lib/tools'
import { annotationsOf } from './extensions/ai-annotations'
import { threadsOf, threadPluginState } from './extensions/comments'
import { getAISuggestions } from './extensions/ai-suggestions'
import { reviewLogOf } from './extensions/review-log'
import { trackedChangesIn, isSuggesting } from './extensions/tracked-changes'
import { renameTab } from './tabs/actions'
import { useTabStore } from './stores/tabStore'
import { useSettingsStore } from './stores/settingsStore'
import { useChatStore } from './stores/chatStore'
import { useEditorStore } from './stores/editorStore'
import { syncShareComments } from './lib/shareSync'
// Registers the share-push performer with the session layer (#1147).
import './lib/sharePush'
import type { ChatMessage } from './types'
import { getApi } from './lib/browserApi'
import './lib/remarkableBridge'
import './index.css'

// Debug + test seams — same always-on tier as window.__prose_editor
// (editorInstanceStore.ts). __prose_debug is the bug-report workflow for the
// AI pipeline log (#672); __prose_tools lets Playwright drive the real tool
// pipeline (executors, mode checks, schema validation) with zero LLM
// involvement and inspect annotation state live and from IndexedDB.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_debug = {
  exportLog: dumpPipelineLog,
  clearLog: clearPipelineLog,
  copyLog: async () => {
    await getApi().copyToClipboard(dumpPipelineLog())
  },
}
// Empty-state seam for e2e (#1063): the About dialog's prose-mark spec needs
// the editor out of its empty state without a document.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_setEditing = (v: boolean) => useEditorStore.setState({ isEditing: v })
// Tab-bar rename seam (#1145): the inline rename is a double-click → input →
// keyboard dance; specs call the action. Same always-on tier as __prose_tools.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_renameTab = renameTab
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_about = (open = true) =>
  useSettingsStore.getState().setAboutDialogOpen(open)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_tools = {
  executeTool,
  // The active document's records, from its own state (#1146); a copy, so a
  // spec cannot mutate plugin state.
  getAnnotations: () => {
    const session = getActiveSession()
    return session ? [...annotationsOf(session.state)] : []
  },
  getAnnotationDocId: () => {
    const session = getActiveSession()
    return session ? getIdentity(session.state).documentId : null
  },
  // A record is added inside the transaction that creates it; nothing ever
  getActiveTabId: () => useTabStore.getState().activeTabId,
  // The tab record is the truth for the dirty flag (#1151).
  getDocumentIsDirty: () => useTabStore.getState().getActiveTab()?.isDirty ?? false,
  loadAnnotationsFromDB,
  loadCommentsFromDB,
  loadSuggestionsFromDB,
  // The active document's comment threads, from its own state (#699, #1147);
  // a copy, so a spec cannot mutate plugin state.
  getCommentStore: () => {
    const session = getActiveSession()
    return session ? [...threadsOf(session.state)] : []
  },
  getCommentDocId: () => {
    const session = getActiveSession()
    return session ? getIdentity(session.state).documentId : null
  },
  // A background tab's threads and the ids its document carries as marks
  // (document-sessions case 6: a share pull into a tab that is not shown).
  getSessionThreads: (tabId: string) => {
    const session = getSession(tabId)
    if (!session) return null
    return {
      threads: [...threadsOf(session.state)],
      markIds: [...(threadPluginState(session.state)?.marks.keys() ?? [])]
    }
  },
  // A tab's document as its state holds it, shown or not (document-sessions
  // cases 11 and 12: a chat turn landing in a tab that is not shown, #1148).
  getSessionState: (tabId: string) => {
    const session = getSession(tabId)
    if (!session) return null
    return {
      documentId: getIdentity(session.state).documentId,
      text: session.state.doc.textContent,
      annotations: [...annotationsOf(session.state)],
      suggestionIds: getAISuggestions({ state: session.state }).map((s) => s.id)
    }
  },
  // A tab's source mode and, when open, its CodeMirror text, selection and
  // folds (document-sessions case 3, #1150); the active tab without an id.
  getSourceState: (tabId?: string) => {
    const session = tabId ? getSession(tabId) : getActiveSession()
    if (!session) return null
    const source = session.source
    if (!source) return { mode: 'rich', text: null, selection: null, folds: [] }
    return { mode: 'source', text: sourceText(source.state), selection: sourceSelection(source.state), folds: sourceFolds(source.state) }
  },
  // Session seams (#1145): which tabs hold a state, and how much work the
  // sessions have done (serialisations are what a switch must not cost).
  getSessionTabIds,
  getProjectionStats,
  // A tab's review log (#1233), from its own state; the active tab without an
  // id. A copy, so a spec cannot mutate plugin state.
  getReviewLog: (tabId?: string) => {
    const session = tabId ? getSession(tabId) : getActiveSession()
    return session ? JSON.parse(JSON.stringify(reviewLogOf(session.state))) : null
  },
  loadReviewLogFromDB: loadReviewLog,
  // A tab's pending tracked changes (#891), from its own state; the active
  // tab without an id. Plain objects, so a spec cannot mutate plugin state.
  getTrackedChanges: (tabId?: string) => {
    const session = tabId ? getSession(tabId) : getActiveSession()
    return session ? JSON.parse(JSON.stringify(trackedChangesIn(session.state.doc))) : null
  },
  isSuggesting: (tabId?: string) => {
    const session = tabId ? getSession(tabId) : getActiveSession()
    return session ? isSuggesting(session.state) : false
  },
  loadTrackedFromDB: loadTracked,
}
// Account seam for e2e (#1059) — same always-on tier as __prose_tools. Settings
// opens from the app menu, which Playwright cannot click, so this is the
// equivalent of choosing Settings → Account. It deliberately exposes no auth
// actions: the tests drive the real form, because the point of the issue is that
// both surfaces render one store.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_account = {
  openSettings: () => useSettingsStore.getState().setDialogOpen(true, 'account'),
  closeSettings: () => useSettingsStore.getState().setDialogOpen(false),
}

// Share-sync seam for e2e (#915) — same always-on tier as __prose_tools.
// `sync` drives the REAL pull-merge (the exact path the ShareStatusPopover's
// open-pull takes: fresh entry lookup → syncShareComments) without the
// interval/debounce, so tests control when each pull happens; with a
// `documentId` it addresses that document's tab, shown or not (#1147).
// `deleteThread` is CommentPopover's handleRemove without the share removal
// push (#903) — the author-deletion gesture whose non-resurrection the
// seenRowIds ledger guarantees (#905); the row stays served, and that push
// is covered through the shareRemoveComment IPC directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_share = {
  sync: async (documentId?: string) => {
    // The tab record, shown or not (#1151); the active tab without an id.
    const target = documentId
      ? useTabStore.getState().tabs.find((t) => t.documentId === documentId)
      : useTabStore.getState().getActiveTab()
    if (!target?.path || !target.documentId) return { ok: false, error: 'no document open' }
    const res = await getApi().shareGetForPath(target.path)
    if (!res.ok || res.entries.length === 0) return { ok: false, error: 'no share entry' }
    const entry = res.entries.find((e) => !e.revokedAt)
    if (!entry) return { ok: false, error: 'revoked' }
    return syncShareComments(entry, target.documentId)
  },
  deleteThread: (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (window as any).__prose_editor
    editor?.commands.removeThread(id, { push: false })
  },
}
// Test seam — INTENTIONALLY always-on, same tier as __prose_tools/__prose_debug.
// Lets Playwright drive the chat surface with zero LLM: seed a conversation and
// inject messages to render deterministic chat states (e.g. an assistant turn
// whose content carries a request_mode_switch tool-result tag → the real card),
// used by the marketing screenshot generator (e2e/electron.screenshot-chat.spec.ts).
// Note: addMessage can synthesize assistant turns with actionable tool-result
// tags — that's deliberate. Reachable only from the app's own renderer scripts
// (contextIsolation: true; the window only ever loads the local bundle, no remote
// content), so the surface is bounded. Kept minimal: only what the generator needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__prose_chat = {
  addConversation: (d: string) => useChatStore.getState().addConversation(d),
  addMessage: (m: ChatMessage) => useChatStore.getState().addMessage(m),
  // The chat's turns and conversations, shown and parked, as copies (#1148).
  getState: () => {
    const s = useChatStore.getState()
    return {
      activeConversationId: s.activeConversationId,
      conversationsDocumentId: s.conversationsDocumentId,
      isStreaming: s.isStreaming,
      turns: Object.fromEntries(Object.entries(s.turns).map(([id, t]) => [id, { streamId: t.streamId, messageId: t.messageId, binding: { ...t.binding } }])),
      conversations: s.conversations.map((c) => ({ id: c.id, documentId: c.documentId, messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })) })),
      parked: Object.fromEntries(Object.entries(s.parked).map(([doc, list]) => [doc, list.map((c) => ({ id: c.id, documentId: c.documentId, messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })) }))]))
    }
  },
}

function SentryFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-background text-foreground">
      <div className="text-center space-y-4 max-w-md px-4">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground">
          An unexpected error occurred. Try restarting Prose.
        </p>
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  )
}

// Initialize IndexedDB before React renders to ensure
// schema migrations complete before plugins access stores
initDB().then(async () => {
  // Load command history and emoji cache from IndexedDB
  await Promise.all([
    useCommandHistoryStore.getState().loadFromStorage(),
    seedEmojiCache()
  ])

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary fallback={SentryFallback}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
})
