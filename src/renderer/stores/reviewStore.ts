import { create } from 'zustand'
import { useTabStore } from './tabStore'
import { useChatStore } from './chatStore'

// 'comments' is the comment-thread counterpart to 'quick'/'side-by-side' — a
// top-level review takeover (a peer of Quick Review, not a child of the Activity
// tab) so the two can toggle between each other through the single mode slot.
export type ReviewMode = 'quick' | 'side-by-side' | 'comments'

interface TabReviewState {
  reviewMode: ReviewMode | null
  currentSuggestionIndex: number
}

interface ReviewStoreState {
  tabStates: Record<string, TabReviewState>
  wasChatOpenBeforeReview: Record<string, boolean>
  previousChatWidth: Record<string, number>
  /** Thread to open Comment Review focused on (from a card/popover expand icon); null = start at 0. Transient, global. */
  commentReviewTargetId: string | null
  /** Enter a review mode, optionally selecting its initial suggestion index. */
  setReviewMode: (mode: ReviewMode | null, initialSuggestionIndex?: number) => void
  setCurrentSuggestionIndex: (index: number) => void
  setPreviousChatWidth: (width: number) => void
  /** Enter Comment Review (optionally focused on a thread). The single entry point. */
  enterCommentReview: (threadId?: string) => void
}

const defaultTabState: TabReviewState = { reviewMode: null, currentSuggestionIndex: 0 }

function getActiveTabId(): string {
  return useTabStore.getState().activeTabId ?? ''
}

export const useReviewStore = create<ReviewStoreState>((set, get) => ({
  tabStates: {},
  wasChatOpenBeforeReview: {},
  previousChatWidth: {},
  commentReviewTargetId: null,

  setReviewMode: (mode, initialSuggestionIndex) => {
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
            currentSuggestionIndex: initialSuggestionIndex ?? 0,
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

  enterCommentReview: (threadId) => {
    set({ commentReviewTargetId: threadId ?? null })
    // Reuse setReviewMode so the snapshot / panel-open / resize logic (and the
    // App-level effect keyed on reviewMode) treats Comment Review exactly like
    // Quick Review.
    get().setReviewMode('comments')
  },
}))

/** Review mode for the currently active tab */
export function useReviewMode(): ReviewMode | null {
  const tabId = useTabStore((s) => s.activeTabId)
  return useReviewStore((s) => s.tabStates[tabId ?? '']?.reviewMode ?? null)
}

/** Non-reactive read of the active tab's review mode (for use inside effects). */
export function getActiveReviewMode(): ReviewMode | null {
  return useReviewStore.getState().tabStates[getActiveTabId()]?.reviewMode ?? null
}

/** The thread Comment Review should open focused on (null = start at first). */
export function useCommentReviewTargetId(): string | null {
  return useReviewStore((s) => s.commentReviewTargetId)
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
