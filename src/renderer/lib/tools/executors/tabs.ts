/**
 * Tab tool executors - tools for multi-tab navigation.
 */

import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useTabStore } from '../../../stores/tabStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { pipelineLog } from '../../aiPipelineLog'
import { switchToTab } from '../../../tabs/actions'

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
 * Runs the shared switchToTab flow (tabs/actions.ts).
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
    pipelineLog('tab:switch', {
      via: 'select_tab',
      toTabId: targetTab.id,
      toDocId: targetTab.documentId,
      fromDocId: useAnnotationStore.getState().documentId,
      annotationCountBefore: useAnnotationStore.getState().annotations.length,
    })

    // One implementation for every switch: the tab bar, the explorer and this
    // tool all run the same leaving and arriving steps (#1145).
    await switchToTab(targetTab.id)

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
