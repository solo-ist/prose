import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useState,
  createElement,
  type RefObject,
  type ReactNode
} from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { useChatStore } from '../stores/chatStore'
import { useFileListStore } from '../stores/fileListStore'

// --- Constants ---

const FILE_LIST_MIN_PX = 280
const FILE_LIST_MAX_PX = 500
export const CHAT_MIN_PX = 280
const CHAT_MAX_PX = 610
const EDITOR_MIN_PX = 360
const BOTH_PANELS_MIN_WIDTH = 1000
const FILE_LIST_DEFAULT_PCT = 20
export const CHAT_DEFAULT_PCT = 50

// --- Types ---

interface PanelSizes {
  fileListMin: number
  fileListMax: number
  editorMin: number
  chatMin: number
  chatMax: number
}

interface PanelLayoutValue {
  isChatOpen: boolean
  isFileListOpen: boolean
  toggleChat: () => void
  toggleFileList: () => void
  setChatOpen: (open: boolean) => void
  setFileListOpen: (open: boolean) => void
  panelSizes: PanelSizes
  canOpenBothPanels: boolean
}

// --- Context ---

const PanelLayoutContext = createContext<PanelLayoutValue | null>(null)

export function usePanelLayoutContext(): PanelLayoutValue {
  const ctx = useContext(PanelLayoutContext)
  if (!ctx) {
    throw new Error('usePanelLayoutContext must be used within PanelLayoutProvider')
  }
  return ctx
}

// --- Helper ---

function calcPanelSizes(windowWidth: number): PanelSizes {
  return {
    fileListMin: (FILE_LIST_MIN_PX / windowWidth) * 100,
    fileListMax: (FILE_LIST_MAX_PX / windowWidth) * 100,
    editorMin: (EDITOR_MIN_PX / windowWidth) * 100,
    chatMin: (CHAT_MIN_PX / windowWidth) * 100,
    chatMax: (CHAT_MAX_PX / windowWidth) * 100
  }
}

// --- Hook ---

interface UsePanelLayoutOpts {
  fileListPanelRef: RefObject<ImperativePanelHandle | null>
  chatPanelRef: RefObject<ImperativePanelHandle | null>
}

export function usePanelLayout({ fileListPanelRef, chatPanelRef }: UsePanelLayoutOpts): PanelLayoutValue {
  // Store state
  const isChatOpen = useChatStore((s) => s.isPanelOpen)
  const isFileListOpen = useFileListStore((s) => s.isPanelOpen)
  const storeChatSetOpen = useChatStore((s) => s.setPanelOpen)
  const storeFileListSetOpen = useFileListStore((s) => s.setPanelOpen)

  const [panelSizes, setPanelSizes] = useState(() => calcPanelSizes(window.innerWidth))
  const [canOpenBothPanels, setCanOpenBothPanels] = useState(
    () => window.innerWidth >= BOTH_PANELS_MIN_WIDTH
  )

  // --- Public API (store-only; imperative resize handled by useLayoutEffect) ---

  const setChatOpen = useCallback(
    (open: boolean) => {
      if (open && window.innerWidth < BOTH_PANELS_MIN_WIDTH && isFileListOpen) {
        storeFileListSetOpen(false)
      }
      storeChatSetOpen(open)
    },
    [isFileListOpen, storeChatSetOpen, storeFileListSetOpen]
  )

  const setFileListOpen = useCallback(
    (open: boolean) => {
      if (open && window.innerWidth < BOTH_PANELS_MIN_WIDTH && isChatOpen) {
        storeChatSetOpen(false)
      }
      storeFileListSetOpen(open)
    },
    [isChatOpen, storeChatSetOpen, storeFileListSetOpen]
  )

  const toggleChat = useCallback(() => {
    setChatOpen(!isChatOpen)
  }, [isChatOpen, setChatOpen])

  const toggleFileList = useCallback(() => {
    setFileListOpen(!isFileListOpen)
  }, [isFileListOpen, setFileListOpen])

  // --- Reactive sync: store → imperative resize ---
  // Fires after React re-renders (so minSize is already updated), before browser paint.
  // Handles both direct callers (toggleChat) and external callers.

  const prevChatOpen = useRef(isChatOpen)
  const prevFileListOpen = useRef(isFileListOpen)

  useLayoutEffect(() => {
    if (isChatOpen !== prevChatOpen.current) {
      if (isChatOpen) {
        chatPanelRef.current?.resize(CHAT_DEFAULT_PCT)
      } else {
        chatPanelRef.current?.resize(0)
      }
    }

    if (isFileListOpen !== prevFileListOpen.current) {
      if (isFileListOpen) {
        fileListPanelRef.current?.resize(FILE_LIST_DEFAULT_PCT)
      } else {
        fileListPanelRef.current?.resize(0)
      }
    }

    prevChatOpen.current = isChatOpen
    prevFileListOpen.current = isFileListOpen
  }, [isChatOpen, isFileListOpen, chatPanelRef, fileListPanelRef])

  // --- Mount: force panels to match store state ---
  // react-resizable-panels restores persisted sizes from localStorage
  // (autoSaveId), which may give closed panels non-zero width.
  useEffect(() => {
    if (!isChatOpen) {
      chatPanelRef.current?.resize(0)
    }
    if (!isFileListOpen) {
      fileListPanelRef.current?.resize(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Mount only

  // --- Window resize listener ---

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    const handleResize = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        const width = window.innerWidth
        setPanelSizes(calcPanelSizes(width))
        setCanOpenBothPanels(width >= BOTH_PANELS_MIN_WIDTH)

        // If both panels open and window shrunk below threshold, close file list
        const chatOpen = useChatStore.getState().isPanelOpen
        const fileListOpen = useFileListStore.getState().isPanelOpen
        if (chatOpen && fileListOpen && width < BOTH_PANELS_MIN_WIDTH) {
          useFileListStore.getState().setPanelOpen(false)
        }
      }, 150)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return {
    isChatOpen,
    isFileListOpen,
    toggleChat,
    toggleFileList,
    setChatOpen,
    setFileListOpen,
    panelSizes,
    canOpenBothPanels
  }
}

// --- Provider ---

export function PanelLayoutProvider({
  value,
  children
}: {
  value: PanelLayoutValue
  children: ReactNode
}) {
  return createElement(PanelLayoutContext.Provider, { value }, children)
}
