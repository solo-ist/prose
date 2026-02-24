import { create } from 'zustand'
import { useTabStore } from './tabStore'
import { useChatStore } from './chatStore'

export type ReviewMode = 'quick' | 'side-by-side'

interface TabReviewState {
  reviewMode: ReviewMode | null
  currentSuggestionIndex: number
}

interface ReviewStoreState {
  tabStates: Record<string, TabReviewState>
  wasChatOpenBeforeReview: Record<string, boolean>
  previousChatWidth: Record<string, number>
  setReviewMode: (mode: ReviewMode | null) => void
  setCurrentSuggestionIndex: (index: number) => void
  setPreviousChatWidth: (width: number) => void
}

const defaultTabState: TabReviewState = { reviewMode: null, currentSuggestionIndex: 0 }

function getActiveTabId(): string {
  return useTabStore.getState().activeTabId ?? ''
}

export const useReviewStore = create<ReviewStoreState>((set) => ({
  tabStates: {},
  wasChatOpenBeforeReview: {},
  previousChatWidth: {},

  setReviewMode: (mode) => {
    const tabId = getActiveTabId()
    if (!tabId) return
    set((state) => {
      const currentMode = state.tabStates[tabId]?.reviewMode ?? null
      const updates: Partial<ReviewStoreState> = {
        tabStates: {
          ...state.tabStates,
          [tabId]: {
            ...(state.tabStates[tabId] ?? defaultTabState),
            reviewMode: mode,
            currentSuggestionIndex: 0,
          },
        },
      }
      // Snapshot sidebar state when entering review (null → non-null)
      if (!currentMode && mode) {
        updates.wasChatOpenBeforeReview = {
          ...state.wasChatOpenBeforeReview,
          [tabId]: useChatStore.getState().isPanelOpen,
        }
      }
      return updates
    })
  },

  setCurrentSuggestionIndex: (index) => {
    const tabId = getActiveTabId()
    if (!tabId) return
    set((state) => ({
      tabStates: {
        ...state.tabStates,
        [tabId]: {
          ...(state.tabStates[tabId] ?? defaultTabState),
          currentSuggestionIndex: index,
        },
      },
    }))
  },

  setPreviousChatWidth: (width) => {
    const tabId = getActiveTabId()
    if (!tabId) return
    set((state) => ({
      previousChatWidth: {
        ...state.previousChatWidth,
        [tabId]: width,
      },
    }))
  },
}))

/** Review mode for the currently active tab */
export function useReviewMode(): ReviewMode | null {
  const tabId = useTabStore((s) => s.activeTabId)
  return useReviewStore((s) => s.tabStates[tabId ?? '']?.reviewMode ?? null)
}

/** Current suggestion index for the currently active tab */
export function useCurrentSuggestionIndex(): number {
  const tabId = useTabStore((s) => s.activeTabId)
  return useReviewStore((s) => s.tabStates[tabId ?? '']?.currentSuggestionIndex ?? 0)
}

/** Whether the chat sidebar was open before entering review mode (for current tab) */
export function useWasChatOpenBeforeReview(): boolean {
  const tabId = useTabStore((s) => s.activeTabId)
  return useReviewStore((s) => s.wasChatOpenBeforeReview[tabId ?? ''] ?? true)
}

/** Previous chat panel width (percentage) before entering review mode */
export function usePreviousChatWidth(): number | null {
  const tabId = useTabStore((s) => s.activeTabId)
  return useReviewStore((s) => s.previousChatWidth[tabId ?? ''] ?? null)
}
