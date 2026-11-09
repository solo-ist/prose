import { useEffect, useState, useCallback, useRef } from 'react'
import { useSharePullSync } from '../../lib/shareSync'
import { useShareContentSync } from '../../lib/shareContentSync'
import { downloadSkillWithAlert } from '../../lib/skillDownload'
import { Toolbar } from './Toolbar'
import { UpdateBanner } from './UpdateBanner'
import { StatusBar } from './StatusBar'
import { Editor } from '../editor/Editor'
import { SidebarPanel } from '../sidebar/SidebarPanel'
import { FileListPanel } from '../files/FileListPanel'
import { SettingsDialog } from '../settings/SettingsDialog'
import { RecoveryDialog } from './RecoveryDialog'
import { RecoveryModal } from '../RecoveryModal'
import { DefaultHandlerPrompt } from './DefaultHandlerPrompt'
import { KeyboardShortcutsDialog } from '../settings/KeyboardShortcutsDialog'
import { AboutDialog } from '../settings/AboutDialog'
import { ModelPickerDialog } from '../ModelPickerDialog'
import { APP_VERSION } from '../../buildInfo.generated'
import { OnboardingDialog } from '../onboarding/OnboardingDialog'
import { AppStoreImportConfirm, AppStoreImportOffer, AppStoreImportSummary, useAppStoreImportStore, useAppStoreImportSummaryDue } from '../appStoreImport/AppStoreImportDialogs'
import { ReleaseNotesDialog } from '../releaseNotes/ReleaseNotesDialog'
import { releaseNotesIds } from '../releaseNotes/notesId'
import { EnableLoggingDialog } from '../EnableLoggingDialog'
import { Notifications } from './Notifications'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '../ui/resizable'
import { TooltipProvider } from '../ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog'
import { buttonVariants } from '../ui/button'
import { cn } from '../../lib/utils'
import { useChat } from '../../hooks/useChat'
import { useSummaryStore } from '../../stores/summaryStore'
import { useEditor } from '../../hooks/useEditor'
import { useTabs } from '../../hooks/useTabs'
import { hydrateDraft, restoreTabs, convertTab, type RestoredTab, toggleSourceMode, markTabSaved } from '../../tabs/actions'
import { landProjections, activeSessionState, subscribeActiveSession, hasSession, serializeFinal } from '../../document/session'
import { trackedChangesIn } from '../../extensions/tracked-changes/changes'
import { useSettings } from '../../hooks/useSettings'
import { usePanelLayout, PanelLayoutProvider } from '../../hooks/usePanelLayout'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { getApi } from '../../lib/browserApi'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore, restoreSession, clearSavedSession, hasUnsavedTabs } from '../../stores/tabStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useSettingsStore, AI_CONSENT_VERSION } from '../../stores/settingsStore'
import { useAutosave } from '../../hooks/useAutosave'
import {
  loadDraft,
  clearDraft,
  deleteConversations
} from '../../lib/persistence'
import { extractFirstH1 } from '../../lib/markdown'
import {
  readDocumentFromDisk,
  loadDiskVersionIntoTab,
  notifyExternalEditConflict,
  isDiskNewerThanBaseline,
  recordDiskBaseline,
  useSaveConflictStore
} from '../../lib/diskSync'
import { handleMissingPath } from '../../lib/stalePath'
import { useNotificationStore } from '../../stores/notificationStore'
import type { DraftState, SessionState } from '../../lib/persistence'
import { executeTool } from '../../lib/tools'
import { splitMcpTarget } from '../../lib/tools/mcpTarget'
import { mcpActorFrom, LAUNCH_CONNECTION_ID, DEFAULT_CONNECTION_LABEL } from '../../../shared/mcp/actor'
import { isMcpToolName } from '../../../shared/tools/registry'
import { REMOTE_TOOL_NAMES } from '../../../shared/mcp/remoteScopes'
import { useReviewMode, useWasChatOpenBeforeReview, usePreviousChatWidth, useReviewStore, type ReviewMode } from '../../stores/reviewStore'
import { chatOpenDefaultPct, reviewChatWidthPct } from '../../hooks/usePanelLayout'

/**
 * True when `path` was modified on disk after the session snapshot was taken
 * (#829). Errors (no stat API, transient fs failure) read as "not stale" so
 * restore falls back to the snapshot exactly as before.
 */
async function isSnapshotStale(path: string, savedAt: number): Promise<boolean> {
  if (!window.api?.fileStat) return false
  try {
    const stat = await window.api.fileStat(path)
    return new Date(stat.modifiedAt).getTime() > savedAt
  } catch {
    return false
  }
}

/**
 * Surface a restore conflict (#829): the tab holds an unsaved draft AND the
 * file changed on disk while Prose was closed. Nothing is lost yet — the
 * draft stays in the tab; this persistent toast warns that saving overwrites
 * the disk edits and offers loading the disk version instead.
 */
function notifyRestoreConflict(tabId: string, path: string) {
  const fileName = path.split('/').pop() ?? path
  useNotificationStore.getState().notify({
    id: `restore-conflict:${path}`,
    durationMs: 0,
    message: `"${fileName}" changed on disk while Prose was closed, and this tab holds unsaved edits from before that change. Saving will overwrite the disk edits.`,
    actionLabel: 'Load disk version',
    onAction: () => {
      void loadDiskVersionIntoTab(tabId, path)
    },
  })
}

export function App() {
  useChat() // Initialize stream listeners

  // Panel refs for imperative collapse/expand
  const fileListPanelRef = useRef<ImperativePanelHandle>(null)
  const chatPanelRef = useRef<ImperativePanelHandle>(null)

  const panelLayout = usePanelLayout({ fileListPanelRef, chatPanelRef })
  const { isChatOpen, isFileListOpen, toggleChat, toggleFileList, setChatOpen, panelSizes } = panelLayout

  // Pull reviewer comments for published docs — background poll + focus (#769)
  useSharePullSync()
  // Content push engine: auto-mode background pushes + share-dirty tracking (#769)
  useShareContentSync()
  const { openFile, openFileFromPath, saveFile, saveFileAs, newFile } = useEditor()
  const { createNewTab, openFileInTab, reopenLastClosedTab } = useTabs()
  const { setDialogOpen, isShortcutsDialogOpen, setShortcutsDialogOpen, isAboutDialogOpen, setAboutDialogOpen, isModelPickerOpen, setModelPickerOpen, settings, effectiveTheme, effectiveColor, autosaveActive, isLoaded: settingsLoaded } = useSettings()
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<DraftState | null>(null)
  const [pendingSession, setPendingSession] = useState<SessionState | null>(null)
  const tabsInitialized = useRef(false)

  const documentPath = useEditorStore((state) => state.document.path)
  const isDirty = useEditorStore((state) => state.document.isDirty)
  const editor = useEditorInstanceStore((state) => state.editor)
  const tabs = useTabStore((state) => state.tabs)
  const initFileWatcher = useFileListStore((state) => state.initFileWatcher)

  // Initialize autosave functionality
  useAutosave()

  // Subscribe to filesystem events from the main process for live File Explorer updates
  useEffect(() => {
    const unsubscribe = initFileWatcher()
    return unsubscribe
  }, [initFileWatcher])

  // External-edit focus check (#843): when the window regains focus, compare
  // each open tab's file against its disk baseline. Clean tabs whose file
  // changed reload silently; dirty ones get the persistent conflict toast.
  // Catches the common flow (edit in another app, come back to Prose) without
  // per-file watchers — those remain #843's full scope.
  useEffect(() => {
    let running = false
    const checkOpenTabs = async () => {
      if (running) return
      running = true
      try {
        const { tabs } = useTabStore.getState()
        for (const tab of tabs) {
          if (!tab.path) continue
          if (!(await isDiskNewerThanBaseline(tab.path))) continue
          // Typing inside the projection delay must not be reloaded over (#885).
          landProjections(tab.id)
          const fresh = useTabStore.getState().getTabById(tab.id)
          if (!fresh) continue
          if (fresh.isDirty) {
            notifyExternalEditConflict(tab.id, tab.path)
          } else {
            await loadDiskVersionIntoTab(tab.id, tab.path)
          }
        }
      } finally {
        running = false
      }
    }
    window.addEventListener('focus', checkOpenTabs)
    return () => window.removeEventListener('focus', checkOpenTabs)
  }, [])

  // Manual-save conflict dialog state (#843) — set by useEditor's save guard.
  const saveConflict = useSaveConflictStore((s) => s.conflict)
  const clearSaveConflict = useSaveConflictStore((s) => s.clearConflict)
  const handleConflictOverwrite = useCallback(async () => {
    const conflict = useSaveConflictStore.getState().conflict
    clearSaveConflict()
    if (!conflict || !window.api) return
    try {
      await window.api.saveFile(conflict.path, conflict.content)
      // The tab records what the held text held; typing since keeps it dirty (#1151).
      const { tabs } = useTabStore.getState()
      const tab =
        (conflict.tabId ? tabs.find((t) => t.id === conflict.tabId) : undefined) ??
        tabs.find((t) => t.path === conflict.path)
      if (tab) await markTabSaved(tab.id, conflict.path, conflict.snapshot)
      else void recordDiskBaseline(conflict.path)
    } catch (error) {
      console.error('[DiskSync] Overwrite save failed:', error)
      useNotificationStore.getState().notify({
        id: `save-failed:${conflict.path}`,
        message: 'Could not save the file. Use Save As to keep your edits.',
        durationMs: 0
      })
    }
  }, [clearSaveConflict])
  const handleConflictLoadDisk = useCallback(async () => {
    const conflict = useSaveConflictStore.getState().conflict
    clearSaveConflict()
    if (!conflict) return
    const tab = useTabStore.getState().tabs.find((t) => t.path === conflict.path)
    if (tab) await loadDiskVersionIntoTab(tab.id, conflict.path)
  }, [clearSaveConflict])

  // Review mode: auto-open sidebar, resize for mode, restore on exit
  const reviewMode = useReviewMode()
  const wasChatOpenBeforeReview = useWasChatOpenBeforeReview()
  const previousChatWidth = usePreviousChatWidth()
  const setPreviousChatWidth = useReviewStore((s) => s.setPreviousChatWidth)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const prevReviewMode = useRef<ReviewMode | null>(null)
  const prevTabId = useRef(activeTabId)

  useEffect(() => {
    const tabChanged = activeTabId !== prevTabId.current
    const prev = prevReviewMode.current
    prevReviewMode.current = reviewMode
    prevTabId.current = activeTabId

    // Tab switch: sync the ref, don't take panel actions
    if (tabChanged) return

    // Same tab, entering or switching review mode
    if (reviewMode && reviewMode !== prev) {
      // Snapshot current width before first resize (entering from null)
      if (!prev) {
        const currentWidth = chatPanelRef.current?.getSize()
        if (currentWidth !== undefined) {
          setPreviousChatWidth(currentWidth)
        }
      }
      setChatOpen(true)
      // Size for the active review mode (side-by-side 60%, Comment Review
      // 50%/33%, Quick ~370px). Shared with usePanelLayout's open-resize so the
      // two don't fight when the chat opens from closed.
      const fileListPct = isFileListOpen ? (fileListPanelRef.current?.getSize() ?? 0) : 0
      chatPanelRef.current?.resize(
        reviewChatWidthPct({
          reviewMode,
          fileListPct,
          isFileListOpen,
          windowWidth: window.innerWidth,
          chatMin: panelSizes.chatMin,
          chatMax: panelSizes.chatMax
        })
      )
    } else if (!reviewMode && prev) {
      // Exiting review: restore previous state
      if (!wasChatOpenBeforeReview) {
        setChatOpen(false)
      } else if (previousChatWidth !== null) {
        chatPanelRef.current?.resize(previousChatWidth)
      } else {
        const fileListPct = isFileListOpen ? (fileListPanelRef.current?.getSize() ?? 0) : 0
        chatPanelRef.current?.resize(
          chatOpenDefaultPct({ fileListPct, chatMin: panelSizes.chatMin, chatMax: panelSizes.chatMax })
        )
      }
    }
  }, [reviewMode, activeTabId, wasChatOpenBeforeReview, previousChatWidth, setChatOpen, chatPanelRef, setPreviousChatWidth])

  // Update window title based on document state
  const isAutoSaving = settings.autosave?.mode === 'auto' && autosaveActive && !!documentPath
  const documentContent = useEditorStore((state) => state.document.content)
  useEffect(() => {
    let fileName: string
    if (documentPath) {
      fileName = documentPath.split('/').pop() || 'Untitled'
    } else {
      // For untitled documents, use the first H1 heading if present
      fileName = extractFirstH1(documentContent) ?? 'Untitled'
    }
    const dirtyIndicator = isDirty && !isAutoSaving ? ' *' : ''
    document.title = `${fileName}${dirtyIndicator} — Prose`
  }, [documentPath, documentContent, isDirty, isAutoSaving])

  // Recover a legacy single-document draft (pre-session builds)
  const recoverDraft = useCallback(async (draft: DraftState) => {
    await hydrateDraft(draft)
    tabsInitialized.current = true
  }, [])

  // Discard draft and cleanup if it was an unsaved document
  const discardDraft = useCallback(async (draft: DraftState) => {
    await clearDraft()
    // If the draft was for an unsaved document, clean up its chat history
    if (!draft.document.path) {
      await deleteConversations(draft.document.documentId)
    }
  }, [])

  // Recover session (multiple tabs). Each draft is resolved against the disk
  // here (missing, stale, conflict); the tab action adds the tabs and arrives
  // at the active one.
  const recoverSessionState = useCallback(async (session: SessionState) => {
    const restored: RestoredTab[] = []
    for (const tabDraft of session.tabs) {
      let restoredPath = tabDraft.path
      let restoredIsDirty = tabDraft.isDirty
      let restoredContent = tabDraft.content
      let restoredFrontmatter = tabDraft.frontmatter
      let fromDisk = false

      if (tabDraft.path && window.api) {
        const exists = await window.api.fileExists(tabDraft.path).catch(() => false)
        if (!exists) {
          handleMissingPath(tabDraft.path, 'restore')
          restoredPath = null
          restoredIsDirty = true
        } else if (await isSnapshotStale(tabDraft.path, session.savedAt)) {
          // The file changed on disk after this session was saved — e.g. an
          // external editor, git, or an agent wrote it while Prose was
          // closed. Hydrating the snapshot unconditionally would resurrect
          // stale content, and a save from that tab would clobber the
          // external edits (#829).
          if (!tabDraft.isDirty) {
            // Clean tab: the snapshot has nothing the disk doesn't — load
            // the disk version. Falls back to the snapshot on read failure.
            const disk = await readDocumentFromDisk(tabDraft.path)
            if (disk) {
              restoredContent = disk.content
              restoredFrontmatter = disk.frontmatter
              fromDisk = true
            }
          } else {
            // Dirty tab: unsaved draft AND external disk edits — a genuine
            // conflict. Keep the draft (nothing is lost yet) and let the
            // user choose; silently picking either side guarantees loss.
            notifyRestoreConflict(tabDraft.tabId, tabDraft.path)
            // Baseline = when this draft last agreed with disk, so the
            // save guards keep protecting the disk edits (#843).
            void recordDiskBaseline(tabDraft.path, session.savedAt)
          }
        } else {
          // Disk unchanged since the snapshot — content agrees with disk.
          fromDisk = true
        }
      }

      restored.push({
        draft: tabDraft,
        path: restoredPath,
        isDirty: restoredIsDirty,
        content: restoredContent,
        frontmatter: restoredFrontmatter,
        fromDisk
      })
    }

    // Baselines for the background tabs whose content agrees with disk; the
    // active tab's is recorded when it arrives.
    for (const entry of restored) {
      if (entry.fromDisk && entry.path && entry.draft.tabId !== session.activeTabId) {
        void recordDiskBaseline(entry.path)
      }
    }

    await restoreTabs(restored, session.activeTabId)

    // Restore file list state if present
    if (session.fileList) {
      useFileListStore.setState({
        viewMode: session.fileList.viewMode,
        rootPath: session.fileList.rootPath,
        expandedFolders: new Set(session.fileList.expandedFolders),
        selectedPath: session.fileList.selectedPath
      })
      if (session.fileList.rootPath) {
        useFileListStore.getState().loadFiles()
      }
    }

    tabsInitialized.current = true
  }, [])

  // Discard session
  const discardSession = useCallback(async (session: SessionState) => {
    await clearSavedSession()
    // Clean up chat history for unsaved tabs
    for (const tab of session.tabs) {
      if (!tab.path) {
        await deleteConversations(tab.documentId)
      }
    }
  }, [])

  // Handle recovery dialog actions
  const handleRecover = useCallback(async () => {
    if (pendingSession) {
      await recoverSessionState(pendingSession)
      setPendingSession(null)
    } else if (pendingDraft) {
      await recoverDraft(pendingDraft)
      setPendingDraft(null)
    }
    setRecoveryDialogOpen(false)
    useChatStore.getState().setInitializing(false)
    // Signal renderer ready to main process
    if (window.api?.signalRendererReady) {
      window.api.signalRendererReady()
    }
  }, [pendingSession, pendingDraft, recoverSessionState, recoverDraft])

  const handleDiscard = useCallback(async () => {
    if (pendingSession) {
      await discardSession(pendingSession)
      setPendingSession(null)
    } else if (pendingDraft) {
      await discardDraft(pendingDraft)
      setPendingDraft(null)
    }
    // Create blank tab after discarding
    if (!tabsInitialized.current) {
      await createNewTab({ home: true })
      tabsInitialized.current = true
    }
    setRecoveryDialogOpen(false)
    useChatStore.getState().setInitializing(false)
    // Signal renderer ready to main process
    if (window.api?.signalRendererReady) {
      window.api.signalRendererReady()
    }
  }, [pendingSession, pendingDraft, discardSession, discardDraft, createNewTab])

  // First-run onboarding (#1188): one modal, opened on first launch or when the
  // disclosure version changes. Settings' AI toggle reopens it through the same
  // flag, so the seam is unchanged.
  const setAIConsentDialogOpen = useSettingsStore((s) => s.setAIConsentDialogOpen)
  const isOnboardingOpen = useSettingsStore((s) => s.isAIConsentDialogOpen)
  // Whether consent was already current when settings loaded. The later-launch
  // default-editor prompt ("Remind me later") runs only then, so it never
  // stacks on onboarding nor follows it in the same session.
  const [consentCurrentAtLoad, setConsentCurrentAtLoad] = useState<boolean | null>(null)
  // The App Store edition import (#1243): its first-launch offer comes before
  // onboarding (an import brings the consent along), and its one-time summary
  // holds back the later-launch default-editor prompt.
  useEffect(() => { void useAppStoreImportStore.getState().load() }, [])
  const importOfferPending = useAppStoreImportStore((s) => !s.loaded || s.offerOpen)
  const importSummaryDue = useAppStoreImportSummaryDue()
  useEffect(() => {
    if (!settingsLoaded) return
    const aiConsent = settings.aiConsent
    // The same predicate the gate always had: a record without a version is
    // current (e2e seeds one), only a missing record or a lower version is due.
    const current = !(!aiConsent || aiConsent.version < AI_CONSENT_VERSION)
    setConsentCurrentAtLoad((known) => (known === null ? current : known))
    if (!current && !importOfferPending) setAIConsentDialogOpen(true)
  }, [settingsLoaded, settings.aiConsent, setAIConsentDialogOpen, importOfferPending])
  // Done closes the modal onto the home screen: the blank launch tab shows the
  // empty state (mark, shortcuts, New Document / Open File).
  const handleOnboardingFinish = useCallback(() => setAIConsentDialogOpen(false), [setAIConsentDialogOpen])

  // Post-update release notes (#1058). Deliberately not updater-driven: the updater
  // is disabled on MAS and in dev, and `updater:update-available` fires BEFORE
  // restart, so it cannot show a post-update modal. Compare a stored version
  // instead, the same shape as the aiConsent gate above.
  const [releaseNotesMarkdown, setReleaseNotesMarkdown] = useState<string | null>(null)
  const setReleaseNotesOpen = useSettingsStore((s) => s.setReleaseNotesOpen)
  const setLastSeenVersion = useSettingsStore((s) => s.setLastSeenVersion)
  // "Has this version been seen" is decided once per launch. Without this latch the
  // effect re-runs on any settings change — including the write it makes itself —
  // and re-opens the dialog under the user's cursor, detaching the button they are
  // mid-click on.
  const releaseNotesChecked = useRef(false)
  const importStatusLoaded = useAppStoreImportStore((s) => s.loaded)
  useEffect(() => {
    if (!settingsLoaded) return
    // Wait for the App Store import status: an import is welcomed by its own
    // summary (#1243), not by this build's notes.
    if (!importStatusLoaded) return
    if (releaseNotesChecked.current) return
    releaseNotesChecked.current = true

    const seen = settings.lastSeenVersion
    if (seen === APP_VERSION) return

    // A fresh install is mid-onboarding and has nothing to catch up on — it is
    // identified by the consent dialog being due, which is exactly the condition
    // the effect above tests. Record the version silently so the next real update
    // is the first one that shows notes.
    const consentDue = !settings.aiConsent || settings.aiConsent.version < AI_CONSENT_VERSION
    // The same for a profile just imported from the App Store edition (#1243).
    const imported = useAppStoreImportStore.getState().status?.result
    const justImported = imported?.state === 'imported' && !imported.acknowledged
    if (consentDue || justImported) {
      setLastSeenVersion(APP_VERSION)
      return
    }

    let cancelled = false
    void (async () => {
      // No notes bundled for this build (a local build, a hotfix tag) is a normal
      // outcome: record the version and stay quiet rather than show an empty modal.
      let notes: { markdown: string } | null = null
      for (const id of releaseNotesIds(APP_VERSION, getApi().isMasBuild === true)) {
        notes = (await getApi().getReleaseNotes?.(id).catch(() => null)) ?? null
        if (notes?.markdown) break
      }
      if (cancelled) return
      if (!notes?.markdown) {
        setLastSeenVersion(APP_VERSION)
        return
      }
      setReleaseNotesMarkdown(notes.markdown)
      setReleaseNotesOpen(true)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads settings once,
    // behind the latch above; adding them back re-opens the dialog mid-click.
  }, [settingsLoaded, importStatusLoaded, setReleaseNotesOpen, setLastSeenVersion])

  // Check for session/draft recovery after settings are loaded
  useEffect(() => {
    if (!settingsLoaded) return

    const checkForRecovery = async () => {
      try {
        // First, try to restore session (multi-tab)
        const session = await restoreSession()

        if (session && session.tabs.length > 0) {
          // Check if any tabs need recovery (have unsaved content)
          const needsRecovery = hasUnsavedTabs(session)
          const recoveryMode = settings?.recovery?.mode ?? 'silent'

          if (needsRecovery && recoveryMode === 'prompt') {
            // Show recovery dialog for session
            setPendingSession(session)
            setRecoveryDialogOpen(true)
            return
          }

          // Silent recovery - restore the session
          await recoverSessionState(session)
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
          return
        }

        // Fall back to legacy single-draft recovery for backward compatibility
        const draft = await loadDraft()
        if (!draft) {
          // No draft to recover - create blank tab and complete initialization
          if (!tabsInitialized.current) {
            await createNewTab({ home: true })
            tabsInitialized.current = true
          }
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
          return
        }

        // Only recover if there's actual content
        if (!draft.document.content && !draft.document.isDirty) {
          await clearDraft()
          if (!tabsInitialized.current) {
            await createNewTab({ home: true })
            tabsInitialized.current = true
          }
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
          return
        }

        const recoveryMode = settings?.recovery?.mode ?? 'silent'

        if (recoveryMode === 'silent') {
          await recoverDraft(draft)
          useChatStore.getState().setInitializing(false)
          if (window.api?.signalRendererReady) {
            window.api.signalRendererReady()
          }
        } else {
          // For 'ask' mode, keep initializing until user decides
          setPendingDraft(draft)
          setRecoveryDialogOpen(true)
        }
      } catch (error) {
        console.error('Failed to check for recovery:', error)
        // Create blank tab on error
        if (!tabsInitialized.current) {
          await createNewTab({ home: true })
          tabsInitialized.current = true
        }
        useChatStore.getState().setInitializing(false)
        if (window.api?.signalRendererReady) {
          window.api.signalRendererReady()
        }
      }
    }

    checkForRecovery()
    // Only run once when settings are loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded])

  // Handle menu actions from main process
  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onMenuAction((action) => {
      switch (action) {
        case 'new':
          createNewTab()
          break
        case 'open':
          // Open file dialog and open in tab
          if (window.api) {
            window.api.openFile().then(async (result) => {
              if (result) {
                await openFileInTab(result.path)
              }
            }).catch((error) => {
              console.error('[App] Failed to open file from menu:', error)
            })
          }
          break
        case 'save':
          saveFile().catch((error) => {
            console.error('[App] Failed to save from menu:', error)
          })
          break
        case 'saveAs':
          saveFileAs().catch((error) => {
            console.error('[App] Failed to save as from menu:', error)
          })
          break
        case 'exportHtml':
          // Delegate to Toolbar, which owns the export handler
          window.dispatchEvent(new CustomEvent('menu:exportHtml'))
          break
        case 'convertToTxt':
        case 'convertToMarkdown': {
          const tabId = useTabStore.getState().activeTabId
          if (!tabId) break
          convertTab(tabId, action === 'convertToTxt' ? 'txt' : 'md').catch((e) => {
            console.error(`Failed to convert document (${action}):`, e)
          })
          break
        }
        case 'settings':
          setDialogOpen(true)
          break
        case 'toggleChat':
          toggleChat()
          break
        case 'toggleFileList':
          toggleFileList()
          break
        case 'copyMarkdown': {
          const content = useEditorStore.getState().document.content
          if (content) getApi().copyToClipboard(content)
          break
        }
        case 'copyWithChanges': {
          // The text as if every pending tracked change were accepted (#891).
          const tabId = useTabStore.getState().activeTabId
          if (tabId && hasSession(tabId)) getApi().copyToClipboard(serializeFinal(tabId))
          break
        }
        case 'addComment':
          window.dispatchEvent(new CustomEvent('menu:addComment'))
          break
        case 'insertTable':
          window.dispatchEvent(new CustomEvent('menu:insertTable'))
          break
        case 'toggleSourceView':
          toggleSourceMode()
          break
        case 'find':
          // Dispatch custom event for Editor to handle
          window.dispatchEvent(new CustomEvent('menu:find'))
          break
        case 'shortcuts':
          setShortcutsDialogOpen(true)
          break
        case 'about':
          setAboutDialogOpen(true)
          break
        case 'undo':
          editor?.commands.undo()
          break
        case 'redo':
          editor?.commands.redo()
          break
        case 'closeTab':
          // Delegate to Toolbar which handles the dirty-state confirmation dialog
          window.dispatchEvent(new CustomEvent('menu:closeTab'))
          break
        case 'reopenClosedTab':
          reopenLastClosedTab()
          break
        case 'showRecentFiles':
          // Open the file list panel and switch to recent view
          useFileListStore.getState().setViewMode('recent')
          if (!isFileListOpen) toggleFileList()
          break
        case 'clearRecentFiles':
          // Main process already cleared settings.json — just update in-memory state
          useSettingsStore.setState((state) => ({
            settings: { ...state.settings, recentFiles: [] }
          }))
          break
        case 'downloadSkill':
          downloadSkillWithAlert()
          break
        default:
          // Handle openRecentFile:${path} actions
          if (action.startsWith('openRecentFile:')) {
            const filePath = action.slice('openRecentFile:'.length)
            openFileInTab(filePath).catch((error) => {
              console.error('[App] Failed to open recent file from menu:', error)
            })
          }
          break
      }
    })

    return unsubscribe
  }, [openFileInTab, saveFile, saveFileAs, createNewTab, setDialogOpen, toggleChat, toggleFileList, isFileListOpen, setShortcutsDialogOpen, setAboutDialogOpen, editor, reopenLastClosedTab])

  // Show the native "Copy with changes" items (Edit menu, editor context menu)
  // only while the active tab has pending tracked changes (#891, design §5).
  useEffect(() => {
    const api = getApi()
    let shown: boolean | null = null
    const push = () => {
      const state = activeSessionState()
      const available = state ? trackedChangesIn(state.doc).length > 0 : false
      if (available === shown) return
      shown = available
      void api.setCopyWithChangesAvailable(available)
    }
    push()
    return subscribeActiveSession(push)
  }, [])

  // Keep the native "Reopen Closed Tab" menu item enabled only while the
  // session-only closed-tab stack has entries. Push the current emptiness to
  // the main process on mount and whenever it flips (no-op in web mode).
  useEffect(() => {
    const api = getApi()
    api.setReopenClosedTabEnabled(useTabStore.getState().closedTabs.length > 0)
    return useTabStore.subscribe(
      (state) => state.closedTabs.length > 0,
      (hasClosedTabs) => {
        api.setReopenClosedTabEnabled(hasClosedTabs)
      }
    )
  }, [])

  // Handle menu:new custom event (dispatched by Editor keyboard handler for Cmd+N in web mode)
  useEffect(() => {
    const handleMenuNew = () => createNewTab()
    window.addEventListener('menu:new', handleMenuNew)
    return () => window.removeEventListener('menu:new', handleMenuNew)
  }, [createNewTab])

  // Handle file open from OS (double-click .md file)
  useEffect(() => {
    if (!window.api) return
    const unsubscribe = window.api.onFileOpenExternal(async (path) => {
      // Use tab system to open external files
      const shouldDescribe = await openFileInTab(path)
      tabsInitialized.current = true
      if (shouldDescribe) {
        const { document } = useEditorStore.getState()
        useSummaryStore.getState().generateSummary(document.documentId, document.content)
      }
    })
    return unsubscribe
  }, [openFileInTab])

  // Handle prose://open?content=... URL scheme — create a new document from the payload.
  // Content is baked into the new tab via createNewTab's init options before the editor
  // mounts, so the editor reads the right content from its initial state. No setContent
  // race with the editor instance ref.
  useEffect(() => {
    if (!window.api?.onOpenFromUrl) return
    const unsubscribe = window.api.onOpenFromUrl(async (content: string) => {
      try {
        const { parseMarkdown } = await import('../../lib/markdown')
        const parsed = parseMarkdown(content)
        await createNewTab({
          content: parsed.content,
          frontmatter: parsed.frontmatter,
          isDirty: true
        })
      } catch (err) {
        console.error('[prose:openFromUrl] Handler threw:', err)
      }
    })
    return unsubscribe
  }, [createNewTab])

  // Handle MCP tool invocations (only active in MCP server mode)
  useEffect(() => {
    if (!window.api?.onMcpToolInvoke) return
    const unsubscribe = window.api.onMcpToolInvoke(async (requestId, toolName, args, sentActor) => {
      try {
        // A `document` argument targets an open tab (#1237); without one the
        // call acts on the active tab. Either way it keeps the writer's
        // selection and focus, and only tab-changing tools change the tab.
        // The bridge checks the allowlist in main; check it here too, so a call
        // that reaches the renderer some other way can't run an unlisted tool
        // (accept_diff and reject_diff stay the writer's, #607).
        if (!isMcpToolName(toolName)) {
          window.api.sendMcpToolResult(requestId, { success: false, error: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' })
          return
        }
        // A remote client (the relay, #1239) only ever gets the remote tools:
        // open documents, never files or the writer's view. Main enforces each
        // connection's approved scopes; this is the floor beneath them.
        const actor = mcpActorFrom(sentActor)
        if (actor?.via === 'relay' && !REMOTE_TOOL_NAMES.has(toolName)) {
          window.api.sendMcpToolResult(requestId, { success: false, error: `${toolName} is not available to remote clients`, code: 'UNKNOWN_TOOL' })
          return
        }
        const target = splitMcpTarget(toolName, args, requestId)
        if ('error' in target) {
          window.api.sendMcpToolResult(requestId, target.error)
          return
        }
        const documentId = target.binding?.documentId ?? useEditorStore.getState().document.documentId
        const result = await executeTool(
          toolName,
          target.args,
          'create',
          {
            model: 'Claude (MCP)',
            conversationId: requestId,
            messageId: requestId,
            documentId: documentId ?? '',
            // Who the call is from: main builds it from the connection the
            // token resolved to, or the stdio bridge's clientInfo (#1236).
            // Never from the tool arguments; without one (a call sent by
            // hand), the per-launch connection, as before.
            actor: actor ?? { kind: 'mcp-agent', connectionId: LAUNCH_CONNECTION_ID, connectionLabel: DEFAULT_CONNECTION_LABEL },
          },
          target.binding,
          { preserveView: true }
        )
        window.api.sendMcpToolResult(requestId, result)
      } catch (error) {
        window.api.sendMcpToolResult(requestId, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          code: 'EXECUTION_ERROR'
        })
      }
    })
    return unsubscribe
  }, [])

  // Remote access (#1239): an assistant asked to use Prose through the relay.
  // Nothing reaches it until the writer approves it, so say where.
  useEffect(() => {
    return window.api?.onMcpRemoteChanged?.((change) => {
      if (change.reason !== 'pending') return
      useNotificationStore.getState().notify({
        id: 'remote-access-pending',
        message: `${change.clientName.slice(0, 80)} asked to use Prose. Approve it in Settings → Integrations → Connections.`,
        actionLabel: 'Review',
        onAction: () => useSettingsStore.getState().setDialogOpen(true, 'integrations'),
        durationMs: 15000,
      })
    })
  }, [])

  return (
    <PanelLayoutProvider value={panelLayout}>
    <TooltipProvider delayDuration={300}>
      <div
        className={[
          'flex h-screen flex-col bg-background text-foreground',
          effectiveColor === 'termy' && effectiveTheme === 'dark' ? 'termy-scanline-scope' : '',
        ].filter(Boolean).join(' ')}
        data-color={effectiveColor}
      >
        <Toolbar />
        {/* The App Store updates the MAS build; its updater never starts (#1222). */}
        {!getApi().isMasBuild && <UpdateBanner />}

        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="prose-panels"
          >
            <ResizablePanel
              ref={fileListPanelRef}
              id="file-list"
              order={1}
              defaultSize={0}
              minSize={isFileListOpen ? panelSizes.fileListMin : 0}
              maxSize={panelSizes.fileListMax}
              className="h-full overflow-hidden"
            >
              {isFileListOpen && <FileListPanel />}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="editor" order={2} minSize={panelSizes.editorMin}>
              <Editor />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              ref={chatPanelRef}
              id="chat"
              order={3}
              defaultSize={0}
              minSize={isChatOpen ? panelSizes.chatMin : 0}
              maxSize={reviewMode === 'side-by-side' ? 70 : panelSizes.chatMax}
              className="h-full overflow-hidden"
            >
              {isChatOpen && <SidebarPanel />}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <StatusBar />
        <SettingsDialog />
        <RecoveryDialog
          open={recoveryDialogOpen}
          onRecover={handleRecover}
          onDiscard={handleDiscard}
        />
        <RecoveryModal />
        <KeyboardShortcutsDialog
          open={isShortcutsDialogOpen}
          onOpenChange={setShortcutsDialogOpen}
        />
        <AboutDialog
          open={isAboutDialogOpen}
          onOpenChange={setAboutDialogOpen}
        />
        <ModelPickerDialog
          open={isModelPickerOpen}
          onOpenChange={setModelPickerOpen}
        />
        {consentCurrentAtLoad === true && !importSummaryDue && <DefaultHandlerPrompt />}
        <AppStoreImportOffer />
        <AppStoreImportConfirm />
        <AppStoreImportSummary blocked={isOnboardingOpen} />
        <OnboardingDialog
          open={isOnboardingOpen}
          startAt={settings.aiConsent ? 'ai' : 'welcome'}
          onFinish={handleOnboardingFinish}
        />
        {releaseNotesMarkdown && <ReleaseNotesDialog markdown={releaseNotesMarkdown} />}
        <EnableLoggingDialog />
        <Notifications />

        {/* External-edit save conflict (#843): a manual save landed on a file
            that changed on disk since it was loaded/last saved */}
        <AlertDialog open={saveConflict !== null} onOpenChange={(open) => { if (!open) clearSaveConflict() }}>
          <AlertDialogContent className="sm:max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>File changed on disk</AlertDialogTitle>
              <AlertDialogDescription>
                {`"${saveConflict?.path.split('/').pop() ?? ''}" was modified outside Prose after you opened it. Saving now will overwrite those changes.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {/* Cancel left, the two real choices right; destructive styling on
                the draft-discarding action so it can't be mistaken for Cancel.
                Wrap-safe for narrow widths (same pattern as the paste dialog). */}
            <AlertDialogFooter className="sm:flex-wrap sm:gap-2 sm:space-x-0">
              <AlertDialogCancel className="sm:mr-auto">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={cn(buttonVariants({ variant: 'destructive' }))}
                onClick={() => { void handleConflictLoadDisk() }}
              >
                Discard &amp; Load Disk
              </AlertDialogAction>
              <AlertDialogAction onClick={() => { void handleConflictOverwrite() }}>
                Overwrite &amp; Save
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
    </PanelLayoutProvider>
  )
}
