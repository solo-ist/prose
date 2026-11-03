import { useTabStore } from '../stores/tabStore'
import * as actions from '../tabs/actions'

/**
 * Promote the current preview tab to permanent and restore UI state.
 * Can be called from outside the hook (e.g., Editor mousedown handler).
 */
export { promotePreview as promoteCurrentPreview } from '../tabs/actions'

async function openFileInTab(filePath: string): Promise<boolean> {
  try {
    return (await actions.openFile(filePath)).shouldDescribe
  } catch (error) {
    console.error('[useTabs] Failed to open file:', error)
    return false
  }
}

async function openFileInPreviewTab(filePath: string): Promise<boolean> {
  try {
    return (await actions.openFile(filePath, { preview: true })).shouldDescribe
  } catch (error) {
    console.error('[useTabs] Failed to preview file:', error)
    return false
  }
}

async function closeTab(tabId: string): Promise<boolean> {
  return actions.closeTab(tabId)
}

async function forceCloseTab(tabId: string): Promise<void> {
  await actions.closeTab(tabId, { force: true })
}

/**
 * React binding over the tab lifecycle actions (`tabs/actions.ts`). The
 * flows live there, as plain functions shared with the chat tools and the
 * launch restore; this hook only adds the store subscriptions components
 * render from. Every returned function is module-stable.
 */
export function useTabs() {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)

  return {
    tabs,
    activeTabId,
    createNewTab: actions.newTab,
    openFileInTab,
    openFileInPreviewTab,
    switchToTab: actions.switchToTab,
    closeTab,
    forceCloseTab,
    closeOtherTabs: actions.closeOtherTabs,
    closeAllTabs: actions.closeAllTabs,
    renameTab: actions.renameTab,
    reopenLastClosedTab: actions.reopenLastClosedTab
  }
}
