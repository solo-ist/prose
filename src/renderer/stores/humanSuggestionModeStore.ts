import { create } from 'zustand'

export type HumanEditingMode = 'editing' | 'suggesting'

interface HumanSuggestionModeState {
  mode: HumanEditingMode
  setMode: (mode: HumanEditingMode) => void
  toggleMode: () => void
}

/**
 * Local authoring mode for the one-human/one-agent review workflow.
 *
 * This is intentionally session-local rather than document data. It controls
 * how the next human edit is captured and never changes MCP suggestion state.
 */
export const useHumanSuggestionModeStore = create<HumanSuggestionModeState>((set) => ({
  mode: 'editing',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((state) => ({
    mode: state.mode === 'editing' ? 'suggesting' : 'editing',
  })),
}))

export function isHumanSuggesting(): boolean {
  return useHumanSuggestionModeStore.getState().mode === 'suggesting'
}
