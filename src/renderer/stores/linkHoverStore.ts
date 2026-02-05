import { create } from 'zustand'

interface LinkHoverState {
  hoveredUrl: string | null
  setHoveredUrl: (url: string | null) => void
}

export const useLinkHoverStore = create<LinkHoverState>((set) => ({
  hoveredUrl: null,
  setHoveredUrl: (url) => set({ hoveredUrl: url })
}))
