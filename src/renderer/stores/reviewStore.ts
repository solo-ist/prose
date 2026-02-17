import { create } from 'zustand'

export type ReviewMode = 'quick' | 'side-by-side'

interface ReviewState {
  reviewMode: ReviewMode | null
  currentSuggestionIndex: number
  setReviewMode: (mode: ReviewMode | null) => void
  setCurrentSuggestionIndex: (index: number) => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  reviewMode: null,
  currentSuggestionIndex: 0,
  setReviewMode: (mode) => set({ reviewMode: mode, currentSuggestionIndex: 0 }),
  setCurrentSuggestionIndex: (index) => set({ currentSuggestionIndex: index }),
}))
