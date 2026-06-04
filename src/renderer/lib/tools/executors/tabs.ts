/**
 * Tab tool executors - tools for multi-tab navigation.
 */

import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useTabStore } from '../../../stores/tabStore'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../../../stores/chatStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { useSuggestionStore } from '../../../extensions/ai-suggestions/store'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { useCommentStore } from '../../../extensions/comments/store'
import { getComments } from '../../../extensions/comments'
import { useFileListStore } from '../../../stores/fileListStore'
import { serializeMarkdown } from '../../markdown'
import { pipelineLog } from '../../aiPipelineLog'

// Tab summary shape returned to Claude
interface TabSummary {
  tabId: string
  title: string
  path: string | null
  isActive: boolean
  isDirty: boolean
  isPreview: boolean
  documentId: string
}

/**
 * list_tabs - Read-only snapshot of all open tabs.
 * Returns all tabs including preview tabs (marked with isPreview: true).
 */
export function executeListTabs(): ToolResult<{ tabs: TabSummary[] }> {
  const tabState = useTabStore.getState()

  const tabs: TabSummary[] = tabState.tabs.map((tab) => ({
    tabId: tab.id,
    title: tab.title,
    path: tab.path,
    isActive: tab.id === tabState.activeTabId,
    isDirty: tab.isDirty,
    isPreview: tab.isPreview ?? false,
    documentId: tab.documentId
  }))

  return toolSuccess({ tabs })
}

/**
 * select_tab - Switch the active tab.
 * Accepts tabId (exact) or match (case-insensitive substring of title or path basename).
 * Mirrors the switchToTab logic from useTabs.ts, using store APIs directly.
 */
export async function executeSelectTab(args: {
  tabId?: string
  match?: string
}): Promise<ToolResult<{ selected: boolean; tabId: string; title: string; path: string | null }>> {
  const { tabId, match } = args

  if (!tabId && !match) {
    return toolError('Provide either tabId or match', 'INVALID_INPUT')
  }

  const tabState = useTabStore.getState()

  let targetTab = null

  if (tabId) {
    // Exact ID lookup
    targetTab = tabState.tabs.find((t) => t.id === tabId) ?? null
    if (!targetTab) {
      return toolError(`Tab not found: ${tabId}`, 'TAB_NOT_FOUND')
    }
  } else if (match) {
    // Case-insensitive substring match on title and path basename
    const lower = match.toLowerCase()
    const candidates = tabState.tabs.filter((t) => {
      const titleMatch = t.title.toLowerCase().includes(lower)
      const pathMatch = t.path
        ? (t.path.split('/').pop() ?? '').toLowerCase().includes(lower)
        : false
      return titleMatch || pathMatch
    })

    if (candidates.length === 0) {
      return toolError('tab not found', 'TAB_NOT_FOUND')
    }

    if (candidates.length > 1) {
      return toolError(
        JSON.stringify({
          error: 'ambiguous',
          candidates: candidates.map((t) => ({
            tabId: t.id,
            title: t.title,
            path: t.path
          }))
        }),
        'AMBIGUOUS_MATCH'
      )
    }

    targetTab = candidates[0]
  }

  if (!targetTab) {
    return toolError('tab not found', 'TAB_NOT_FOUND')
  }

  // Already the active tab — no-op
  if (targetTab.id === tabState.activeTabId) {
    return toolSuccess({
      selected: true,
      tabId: targetTab.id,
      title: targetTab.title,
      path: targetTab.path
    })
  }

  try {
    // Persist the CURRENT tab's full state before switching (#674). This
    // executor had drifted from useTabs.switchToTab: it saved only the
    // conversation, so agent-driven tab switches silently discarded the
    // active tab's unsaved content, annotations, suggestions, and comments.
    const { document, cursorPosition } = useEditorStore.getState()
    const activeTab = tabState.tabs.find((t) => t.id === tabState.activeTabId)
    // The editor→store content sync is DEBOUNCED (500ms, Editor.tsx
    // onUpdate). An agent accepting an edit and switching tabs in the same
    // breath would snapshot pre-edit content and silently revert the edit on
    // toggle-back — so serialize the LIVE editor state here instead of
    // trusting editorStore.document.content.
    const liveEditor = useEditorInstanceStore.getState().editor
    const liveContent = liveEditor?.storage?.markdown?.getMarkdown != null
      ? serializeMarkdown(liveEditor.storage.markdown.getMarkdown(), document.frontmatter)
      : document.content
    if (activeTab) {
      useTabStore.getState().updateTab(activeTab.id, {
        content: liveContent,
        frontmatter: document.frontmatter,
        cursorPosition,
        isDirty: document.isDirty || liveContent !== document.content
      })
    }
    await useChatStore.getState().saveCurrentConversation(document.documentId)

    // Await any in-flight annotation write, then persist (#674 save race)
    const pendingSave = useAnnotationStore.getState().pendingSave
    if (pendingSave) await pendingSave
    await useAnnotationStore.getState().saveAnnotations()

    if (liveEditor && activeTab?.documentId) {
      await useSuggestionStore.getState().saveSuggestions(activeTab.documentId, getAISuggestions(liveEditor))
      await useCommentStore.getState().saveComments(activeTab.documentId, getComments(liveEditor))
    }

    pipelineLog('tab:switch', {
      via: 'select_tab',
      toTabId: targetTab.id,
      toDocId: targetTab.documentId,
      fromDocId: useAnnotationStore.getState().documentId,
      annotationCountBefore: useAnnotationStore.getState().annotations.length,
    })

    // Pause annotation position updates during document loading
    useAnnotationStore.getState().setLoadingDocument(true)

    // Pre-set the annotation store's documentId before setDocument so the
    // Editor.tsx recovery effect doesn't fire a competing load (#674).
    const newDocumentId = targetTab.documentId
    useAnnotationStore.getState().setDocumentId(newDocumentId)

    // Activate the new tab
    useTabStore.getState().setActiveTab(targetTab.id)

    // Load target tab's document into editorStore
    useEditorStore.getState().setDocument({
      documentId: newDocumentId,
      path: targetTab.path,
      content: targetTab.content ?? '',
      frontmatter: targetTab.frontmatter ?? {},
      isDirty: targetTab.isDirty
    })

    if (targetTab.cursorPosition) {
      useEditorStore.getState().setCursorPosition(
        targetTab.cursorPosition.line,
        targetTab.cursorPosition.column
      )
    }

    // Load conversations, annotations, suggestions, and comments for the new document
    setCurrentDocumentId(newDocumentId)
    await useChatStore.getState().loadForDocument(newDocumentId)
    await useAnnotationStore.getState().loadAnnotations(newDocumentId)
    await useSuggestionStore.getState().loadSuggestions(newDocumentId)
    await useCommentStore.getState().loadComments(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    useEditorStore.getState().setEditing(true)

    // Update file list selection if file has path
    if (targetTab.path) {
      useFileListStore.getState().revealAndSelectPath(targetTab.path)
    }

    // Resume annotation position updates
    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)

    return toolSuccess({
      selected: true,
      tabId: targetTab.id,
      title: targetTab.title,
      path: targetTab.path
    })
  } catch (e) {
    return toolError(`Failed to switch tab: ${e}`, 'SWITCH_FAILED')
  }
}
