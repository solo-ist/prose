import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import type { Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { pushNewThreadToShare } from '../../lib/sharePush'
import { useNotificationStore } from '../../stores/notificationStore'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { usePanelLayoutContext } from '../../hooks/usePanelLayout'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useTabStore, scheduleSaveSession } from '../../stores/tabStore'
import { promoteCurrentPreview } from '../../hooks/useTabs'
import { openInTab, setActiveFrontmatter, updateFromSource } from '../../tabs/actions'
import { attachEditor, enterSourceMode, exitSourceMode } from '../../document/session'
import { createEditorExtensions } from './extensions'
import { FindBar } from './FindBar'
import { ShareStatusIcon } from '../share/ShareStatusIcon'
import { ShareStatusPopover } from '../share/ShareStatusPopover'
import { useShareStore } from '../../stores/shareStore'
import { useWebPlatformEnabled } from '../../lib/featureFlags'
import { SelectionPopover } from './SelectionPopover'
import { TableControls } from './TableControls'
import { insertTable } from '../../lib/tableCommands'
import { AddCommentDialog } from './AddCommentDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { EmptyState } from '../layout/EmptyState'
import { FrontmatterDisplay, hasFrontmatter } from './FrontmatterDisplay'
import { FrontmatterEditor, serializeFrontmatter } from './FrontmatterEditor'
import { TransformAnimation, useTransformAnimation } from './TransformAnimation'
import { AISuggestionPopover } from '../AISuggestionPopover'
import { CommentPopover } from '../CommentPopover'
import { useCommentStore } from '../../extensions/comments/store'
import { LinkPopover } from './LinkPopover'
import { SourceEditor, SourceEditorHandle } from './SourceEditor'
import { getApi } from '../../lib/browserApi'

const AI_PASTE_PROMPT_MIN_CHARS = 200

interface PendingPasteAnnotation {
  documentId: string
  from: number
  to: number
  text: string
}

/**
 * Plain-text clipboard serialization (#1054).
 *
 * tiptap-markdown registers a `clipboardTextSerializer` that serializes
 * `slice.content` directly, discarding the slice's open depths. Because
 * `Selection.content()` slices with `includeParents`, a caret-level selection
 * inside a bullet arrives as `bulletList > listItem > paragraph > "ected te"`
 * with `openStart === openEnd === 3`, and the serializer re-emits those
 * wrappers as whole blocks — putting `* ected te` on the clipboard. The same
 * mechanism adds `>` for blockquotes and `#` for headings.
 *
 * A view-level prop takes precedence over a plugin's, so registering this in
 * `editorProps` overrides tiptap-markdown without forking it.
 *
 * It must never return a falsy value: ProseMirror's `someProp` treats that as
 * "no answer" and falls through to the next registered prop — which is
 * tiptap-markdown's, reinstating the bug.
 */
function serializeSelectionAsText(slice: Slice, view: EditorView): string {
  const plain = () => slice.content.textBetween(0, slice.content.size, '\n\n')

  // A selection inside a single text block carries no block structure worth
  // preserving, so plain text is the honest answer — and it is exactly what
  // ProseMirror emits when no serializer is registered at all.
  const { $from, $to } = view.state.selection
  if ($from.sameParent($to)) return plain()

  // Otherwise markdown-serialize, first peeling redundant wrappers the same
  // way prosemirror-view does for the HTML flavor (clipboard.ts:9-16).
  // Without this a selection spanning several bullets re-emits its enclosing
  // list and gains a level of nesting.
  let content = slice.content
  let openStart = slice.openStart
  let openEnd = slice.openEnd
  while (
    openStart > 1 &&
    openEnd > 1 &&
    content.childCount === 1 &&
    content.firstChild?.childCount === 1
  ) {
    openStart--
    openEnd--
    content = content.firstChild.content
  }

  const markdownStorage = useEditorInstanceStore.getState().editor?.storage?.markdown as
    | { serializer?: { serialize: (content: unknown) => string } }
    | undefined
  const markdown = markdownStorage?.serializer?.serialize(content)
  return markdown || plain()
}

function shouldPromptForAIPaste(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return trimmed.length >= AI_PASTE_PROMPT_MIN_CHARS || trimmed.includes('\n')
}

/**
 * Return focus to the editor with the caret at the nearest valid text position
 * at-or-before `pos`. A paste ending on a block boundary (multi-paragraph or
 * list content) makes the raw range-end an invalid text position — a caret set
 * there renders as a dead full-width gap that swallows typing, and Enter there
 * crashes ProseMirror ("Cannot join taskList onto paragraph", Sentry PROSE-Q).
 */
function focusEditorAtPasteEnd(pos: number): void {
  const activeEditor = useEditorInstanceStore.getState().editor
  if (!activeEditor) return
  const clamped = Math.max(0, Math.min(pos, activeEditor.state.doc.content.size))
  const target = TextSelection.near(activeEditor.state.doc.resolve(clamped), -1).from
  activeEditor.chain().focus().setTextSelection(target).run()
}

// Session-scoped flag that suppresses the AI-paste prompt for the remainder of the
// app session when the user clicks "Dismiss this Session". Not persisted — follows
// the same in-memory, session-lifetime idiom as useAnnotationStore's createdThisSession set.
let pasteAnnotationDismissedThisSession = false

export function Editor() {
  const { document, openFile, saveFile } = useEditor()
  const isEditing = useEditorStore((state) => state.isEditing)
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const isPreviewTab = useEditorStore((state) => state.isPreviewTab)
  const annotationsVisible = useEditorStore((state) => state.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((state) => state.toggleAnnotationsVisible)
  const sourceMode = useEditorStore((state) => state.sourceMode)
  const { settings, effectiveTheme, setDialogOpen, setShortcutsDialogOpen, setModelPickerOpen } = useSettings()
  const { setContext, cycleToolMode } = useChat()
  const { isChatOpen, isFileListOpen, toggleChat, toggleFileList, setChatOpen, setFileListOpen } = usePanelLayoutContext()
  const setEditorInstance = useEditorInstanceStore((state) => state.setEditor)
  // The source editor's text as of its last change, kept synchronously: on
  // exit its ref is already detached and the sourceContent state can lag (#1102).
  const latestSourceRef = useRef<string>('')
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [isAddCommentOpen, setIsAddCommentOpen] = useState(false)
  const webPlatformEnabled = useWebPlatformEnabled()
  const shareEntry = useShareStore((s) => s.entry)
  const sharePopoverOpen = useShareStore((s) => s.popoverOpen)
  const [pendingCommentSelection, setPendingCommentSelection] = useState<{
    from: number
    to: number
    text: string
  } | null>(null)
  const [pendingPasteAnnotation, setPendingPasteAnnotation] = useState<PendingPasteAnnotation | null>(null)
  const { isTransforming, startTransform, completeTransform } = useTransformAnimation()

  // Source mode: holds markdown content while CodeMirror is mounted
  const [sourceContent, setSourceContent] = useState<string>('')
  const sourceEditorRef = useRef<SourceEditorHandle>(null)

  // Track if current file is linked to a reMarkable notebook (for showing "View Original" button)
  const [linkedNotebookId, setLinkedNotebookId] = useState<string | null>(null)

  // Link popover state
  const [linkPopover, setLinkPopover] = useState<{
    isOpen: boolean
    position: { top: number; left: number }
    initialUrl?: string
  }>({ isOpen: false, position: { top: 0, left: 0 } })

  // Stable frontmatter for the editor UI — re-syncs on documentId change AND on
  // shallow-value changes from the store. The shallow-value check lets external
  // writes (e.g., AI-applied frontmatter via MCP suggest_edit) surface in the UI
  // while still ignoring transient new-object references that don't change values
  // (which was the original body-edit-ripple bug this state was added to solve).
  const [stableFrontmatter, setStableFrontmatter] = useState<Record<string, unknown>>(
    () => document.frontmatter ?? {}
  )
  // A document change re-syncs during render, not in an effect: an effect lands
  // one commit late, so the returning tab's first paint built the frontmatter
  // block from the previous tab's fields and it grew a frame later. Above a
  // restored scroll offset the browser's scroll anchoring compensated for that
  // growth and the next re-apply undid it — a visible 48px hop (#1103). React
  // re-renders before committing when state is set during render.
  const [stableFrontmatterDocId, setStableFrontmatterDocId] = useState(document.documentId)
  if (stableFrontmatterDocId !== document.documentId) {
    setStableFrontmatterDocId(document.documentId)
    setStableFrontmatter(document.frontmatter ?? {})
  }

  useEffect(() => {
    if (stableFrontmatterDocId !== document.documentId) return // the render-time sync owns this case
    const next = document.frontmatter ?? {}
    // Same doc — only re-sync if the values actually differ (not just identity)
    const nextKeys = Object.keys(next)
    const currentKeys = Object.keys(stableFrontmatter)
    let differs = nextKeys.length !== currentKeys.length
    if (!differs) {
      for (const k of nextKeys) {
        if ((next as Record<string, unknown>)[k] !== (stableFrontmatter as Record<string, unknown>)[k]) {
          differs = true
          break
        }
      }
    }
    if (differs) setStableFrontmatter(next)
  }, [document.documentId, document.frontmatter, stableFrontmatter, stableFrontmatterDocId])

  const editor = useTipTapEditor({
    extensions: createEditorExtensions({
      bulletListMarker: settings.editor.bulletListMarker ?? '*',
      // Mirror every newly-created comment mark into the persistence store so
      // replies/resolve can find it by ID immediately — without waiting for a
      // tab-switch save. Catches both the UI (AddCommentDialog) and tool
      // (add_comment) paths, since both go through setComment. Restoration
      // uses tr.addMark directly and does NOT fire this, so no double-add.
      onCommentAdded: (commentData) => {
        const store = useCommentStore.getState()
        if (store.pendingComments.some((c) => c.id === commentData.id)) return
        const updated = [
          ...store.pendingComments,
          { ...commentData, replies: [], resolved: false },
        ]
        useCommentStore.setState({ pendingComments: updated })
        if (store.documentId) store.saveComments(store.documentId, updated)
        // Live new-thread push (#769): the conversation is always live — a
        // comment created here becomes a server row on the publication
        // immediately. No-op when the document isn't published.
        pushNewThreadToShare(commentData.id)
      },
      // setComment refuses ranges that would swallow an existing thread's
      // mark (#830) — tell the user to reply on that thread instead.
      onCommentBlocked: () => {
        useNotificationStore.getState().notify({
          id: 'comment-overlap-blocked',
          message: 'This text already has a comment — reply to the existing thread instead of adding a new one.',
        })
      },
    }),
    // The document arrives through the session layer (document/session.ts),
    // which swaps one EditorState per tab into this view.
    content: '',
    editorProps: {
      attributes: {
        class: 'outline-hidden min-h-full'
      },
      clipboardTextSerializer: serializeSelectionAsText,
      handlePaste: (view, event) => {
        const pastedText = event.clipboardData?.getData('text/plain') ?? ''
        if (!shouldPromptForAIPaste(pastedText)) return false

        const editorState = useEditorStore.getState()
        if (
          editorState.sourceMode ||
          editorState.isRemarkableReadOnly ||
          editorState.isPreviewTab ||
          !editorState.document.documentId
        ) {
          return false
        }

        const documentId = editorState.document.documentId
        const selectionFrom = view.state.selection.from
        const selectionTo = view.state.selection.to
        const replacedSize = selectionTo - selectionFrom
        const sizeBefore = view.state.doc.content.size

        setTimeout(() => {
          const activeEditor = useEditorInstanceStore.getState().editor
          const activeDocumentId = useEditorStore.getState().document.documentId
          if (!activeEditor || activeDocumentId !== documentId) return

          const sizeAfter = activeEditor.state.doc.content.size
          const insertedSize = Math.max(0, sizeAfter - sizeBefore + replacedSize)
          const selectionEnd = activeEditor.state.selection.from
          const fallbackTo = selectionFrom + insertedSize
          const annotationTo = Math.min(
            activeEditor.state.doc.content.size,
            Math.max(selectionEnd, fallbackTo)
          )

          if (annotationTo > selectionFrom && !pasteAnnotationDismissedThisSession) {
            setPendingPasteAnnotation({
              documentId,
              from: selectionFrom,
              to: annotationTo,
              text: pastedText,
            })
          }
        }, 0)

        return false
      },
      handleDOMEvents: {
        mousedown: () => {
          // Clicking the editor while in preview mode promotes the tab
          if (useEditorStore.getState().isPreviewTab) {
            promoteCurrentPreview()
          }
          return false
        }
      }
    },
  })

  // Helper to open comment dialog with current selection (add-new mode)
  const openAddCommentDialog = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return // No selection
    const text = editor.state.doc.textBetween(from, to, ' ')
    setPendingCommentSelection({ from, to, text })
    setIsAddCommentOpen(true)
  }, [editor])

  // Helper to open inline link popover
  const openLinkPopover = useCallback(() => {
    if (!editor) return
    const { to } = editor.state.selection
    const coords = editor.view.coordsAtPos(to)
    const previousUrl = editor.getAttributes('link').href || ''
    setLinkPopover({
      isOpen: true,
      position: { top: coords.bottom + 4, left: coords.left },
      initialUrl: previousUrl,
    })
  }, [editor])

  // Register the editor instance for cross-component access and attach it to
  // the session layer, which holds one EditorState per tab and swaps them
  // into this view (#1145).
  useEffect(() => {
    setEditorInstance(editor)
    attachEditor(editor)
    // Moving the caret or scrolling re-arms the session save (1s debounce), so
    // the active tab's live view reaches the saved session for a relaunch; the
    // save only ran on tab-store changes before, which neither of these is (#1103).
    // Scroll is listened for on the window (capture): the scroll container is
    // re-created around a source-mode toggle, so a listener on it would be lost.
    const rearmSessionSave = () => scheduleSaveSession()
    editor?.on('selectionUpdate', rearmSessionSave)
    window.addEventListener('scroll', rearmSessionSave, { capture: true, passive: true })
    return () => {
      editor?.off('selectionUpdate', rearmSessionSave)
      window.removeEventListener('scroll', rearmSessionSave, { capture: true })
      attachEditor(null)
      setEditorInstance(null)
    }
  }, [editor, setEditorInstance])

  // Cache selection on selectionUpdate for read_selection fallback
  // This preserves the selection when chat input steals focus.
  // Also computes and pushes the live cursor position to editorStore (#564).
  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      const { from, to, empty } = editor.state.selection
      if (!empty) {
        const text = editor.state.doc.textBetween(from, to)
        useEditorStore.getState().setLastSelection({ text, from, to })
      }

      // Update cursor position for status bar (#564)
      const headPos = editor.state.selection.$head.pos
      const textBefore = editor.state.doc.textBetween(0, headPos, '\n')
      const lines = textBefore.split('\n')
      useEditorStore.getState().setCursorPosition(lines.length, (lines[lines.length - 1]?.length ?? 0) + 1)
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  // Update editor editability when read-only mode changes (reMarkable or preview tab)
  useEffect(() => {
    if (!editor) return
    // No `update` emitted: editability is not a content change.
    editor.setEditable(!isRemarkableReadOnly && !isPreviewTab, false)
  }, [editor, isRemarkableReadOnly, isPreviewTab])

  // Sync bulletListMarker setting without requiring an editor remount.
  // tiptap-markdown shallow-copies its options into editor.storage.markdown
  // during onBeforeCreate, and the bullet-list serializer reads that copy at
  // serialize time — mutating the extension's own options has no effect, so
  // the storage copy is the object that must be updated.
  useEffect(() => {
    if (!editor) return
    const markdownStorage = editor.storage.markdown as { options?: { bulletListMarker?: string } } | undefined
    if (markdownStorage?.options) {
      markdownStorage.options.bulletListMarker = settings.editor.bulletListMarker ?? '*'
    }
  }, [editor, settings.editor.bulletListMarker])

  // Check if current file is linked to a reMarkable notebook
  useEffect(() => {
    const checkLinkedNotebook = async () => {
      const syncDir = useSettingsStore.getState().settings.remarkable?.syncDirectory
      if (!document.path || !syncDir || !window.api?.remarkableFindNotebookByFilePath) {
        setLinkedNotebookId(null)
        return
      }

      // Only check files in the sync directory (not hidden OCR files)
      if (!document.path.includes(syncDir.replace('~', ''))) {
        setLinkedNotebookId(null)
        return
      }

      const notebookId = await window.api.remarkableFindNotebookByFilePath(document.path, syncDir)
      setLinkedNotebookId(notebookId)
    }

    checkLinkedNotebook()
  }, [document.path])

  // Auto-focus editor once when document loads (not on every content change)
  const hasFocusedRef = useRef(false)
  useEffect(() => {
    // Reset focus tracking when document changes
    hasFocusedRef.current = false
  }, [document.documentId])

  useEffect(() => {
    // Only focus once per document load
    if (hasFocusedRef.current) return
    // Don't steal focus during preview tab navigation. Mark focus as handled so a
    // later promotion to a permanent tab (e.g. the user clicks mid-document) doesn't
    // re-run this effect and yank the caret/scroll back to the top (#729).
    if (useEditorStore.getState().isPreviewTab) {
      hasFocusedRef.current = true
      return
    }

    const shouldShowEmptyState = !isEditing && !document.path && !document.content && !document.isDirty
    if (editor && !shouldShowEmptyState) {
      hasFocusedRef.current = true
      // The session put the selection and the scroll offset back on
      // activation (#1103, #1145): focus without moving either, then re-apply
      // the offset once layout has settled.
      const timer = setTimeout(() => {
        editor.commands.focus(undefined, { scrollIntoView: false })
        const container = editor.view.dom.closest('.overflow-auto')
        if (container) {
          container.scrollTop = useTabStore.getState().getActiveTab()?.viewState?.scrollTop ?? 0
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [editor, isEditing, document.path, document.content, document.isDirty])

  // Source mode: the session serialises the document on entry and takes the
  // typed text back as one undo step on exit (document/session.ts). A switch
  // away while it is open runs the exit on the leaving session first. Layout
  // effect to avoid a flash of empty content.
  const prevSourceModeRef = useRef(sourceMode)
  useLayoutEffect(() => {
    if (!editor) return
    const prev = prevSourceModeRef.current
    prevSourceModeRef.current = sourceMode

    if (sourceMode && !prev) {
      const text = enterSourceMode(() => sourceEditorRef.current?.getContent() ?? latestSourceRef.current)
      latestSourceRef.current = text
      setSourceContent(text)
    } else if (!sourceMode && prev) {
      exitSourceMode()
    }
  }, [sourceMode, editor])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey

    if (isMod && e.key === 'n' && !e.shiftKey) {
      // Cmd+N: New document — prevent browser's "new window" in web mode
      e.preventDefault()
      // Dispatch to useTabs via a custom event (Toolbar/App owns createNewTab)
      window.dispatchEvent(new CustomEvent('menu:new'))
    } else if (isMod && e.key === 'o' && !e.shiftKey) {
      e.preventDefault()
      openFile()
    } else if (isMod && e.key === 's' && !e.shiftKey) {
      e.preventDefault()
      saveFile().catch((error) => {
        console.error('[Editor] Failed to save from shortcut:', error)
      })
    } else if (isMod && e.key === ',') {
      e.preventDefault()
      setDialogOpen(true)
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'k') {
      // Cmd+Shift+K: Add selection as context
      e.preventDefault()
      if (editor) {
        const { from, to } = editor.state.selection
        if (from !== to) {
          const selectedText = editor.state.doc.textBetween(from, to, '\n')
          if (selectedText.trim()) {
            setContext(selectedText)
            setChatOpen(true)
          }
        }
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'c') {
      // Cmd+Shift+C: Copy Markdown
      e.preventDefault()
      const content = useEditorStore.getState().document.content
      if (content) {
        getApi().copyToClipboard(content)
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'h') {
      // Cmd+Shift+H: Toggle file list (JS fallback for macOS menu accelerator)
      e.preventDefault()
      toggleFileList()
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'l') {
      // Cmd+Shift+L: Toggle chat panel
      e.preventDefault()
      toggleChat()
    } else if (e.key === 'Escape') {
      // Escape cascade: find bar → chat → file list → exit fullscreen
      if (isFindOpen) {
        setIsFindOpen(false)
      } else if (isChatOpen) {
        setChatOpen(false)
      } else if (isFileListOpen) {
        setFileListOpen(false)
      } else if (window.api?.exitFullScreen) {
        window.api.exitFullScreen()
      }
    } else if (isMod && e.key === 'f' && !e.shiftKey) {
      // Cmd+F: Open find bar (skip in source mode — CodeMirror handles its own)
      if (useEditorStore.getState().sourceMode) return
      e.preventDefault()
      if (isFindOpen) {
        // Bar already open — refocus and select the input so the user can type a new term
        window.dispatchEvent(new CustomEvent('find:focus'))
      } else {
        setIsFindOpen(true)
      }
    } else if (isMod && e.key === 'l' && !e.shiftKey) {
      // Cmd+L: Select current line
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const start = $from.start()
        const end = $from.end()
        editor.commands.setTextSelection({ from: start, to: end })
      }
    } else if (isMod && e.key === 'd' && !e.shiftKey) {
      // Cmd+D: Duplicate current line
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const start = $from.start()
        const end = $from.end()
        const lineText = editor.state.doc.textBetween(start, end, '\n')
        editor.chain()
          .setTextSelection(end)
          .insertContent('\n' + lineText)
          .run()
      }
    } else if (isMod && e.shiftKey && e.key === 'Backspace') {
      // Cmd+Shift+Backspace: Delete current line
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const start = $from.start()
        const end = $from.end()
        // Delete from start of line to end, including the newline before if not first line
        const deleteFrom = start > 1 ? start - 1 : start
        editor.chain()
          .setTextSelection({ from: deleteFrom, to: end })
          .deleteSelection()
          .run()
      }
    } else if (isMod && e.key === '/' && !e.shiftKey) {
      // Cmd+/: Toggle HTML comment
      e.preventDefault()
      if (editor) {
        const { from, to } = editor.state.selection
        const selectedText = editor.state.doc.textBetween(from, to, '\n')

        if (selectedText.startsWith('<!--') && selectedText.endsWith('-->')) {
          // Uncomment: remove comment markers
          const uncommented = selectedText.slice(4, -3).trim()
          editor.chain()
            .setTextSelection({ from, to })
            .insertContent(uncommented)
            .run()
        } else {
          // Comment: wrap in comment markers
          const commented = `<!-- ${selectedText} -->`
          editor.chain()
            .setTextSelection({ from, to })
            .insertContent(commented)
            .run()
        }
      }
    } else if (e.key === 'F1') {
      // F1: Show keyboard shortcuts
      e.preventDefault()
      setShortcutsDialogOpen(true)
    } else if (e.shiftKey && e.key === 'Tab' && !isMod) {
      // Shift+Tab: Cycle through tool modes (chat → editor → create → chat).
      // Editor must be reachable via keyboard — it's the new safe-by-default
      // mode, and the previous binary agentMode toggle skipped it.
      e.preventDefault()
      cycleToolMode()
    } else if (isMod && e.key === 'k' && !e.shiftKey) {
      // Cmd+K: Insert/edit link
      e.preventDefault()
      if (editor) {
        openLinkPopover()
      }
    } else if (isMod && e.key === 'u' && !e.shiftKey) {
      // Cmd+U: Underline
      e.preventDefault()
      if (editor) {
        editor.chain().focus().toggleUnderline().run()
      }
    } else if (isMod && e.shiftKey && e.code === 'Period') {
      // Cmd+Shift+.: Superscript
      e.preventDefault()
      if (editor) {
        editor.chain().focus().unsetSubscript().toggleSuperscript().run()
      }
    } else if (isMod && e.shiftKey && e.code === 'Comma') {
      // Cmd+Shift+,: Subscript
      e.preventDefault()
      if (editor) {
        editor.chain().focus().unsetSuperscript().toggleSubscript().run()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'x') {
      // Cmd+Shift+X: Strikethrough
      e.preventDefault()
      if (editor) {
        editor.chain().focus().toggleStrike().run()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'f') {
      // Cmd+Shift+F: Insert footnote citation. Collapse any active selection to
      // its end first — addFootnote inserts at the selection anchor without
      // clearing it, so otherwise a subsequent Enter deletes the selected text.
      // Collapsing (vs deleting) keeps the text and drops the marker after it.
      e.preventDefault()
      if (editor) {
        const { to } = editor.state.selection
        editor.chain().focus().setTextSelection(to).addFootnote().run()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'e') {
      // Cmd+Shift+E: Toggle source view (disabled in read-only mode)
      e.preventDefault()
      const { isRemarkableReadOnly: rmReadOnly, isPreviewTab: previewTab } = useEditorStore.getState()
      if (!rmReadOnly && !previewTab) {
        useEditorStore.getState().toggleSourceMode()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'a') {
      // Cmd+Shift+A: Add comment to selection
      e.preventDefault()
      openAddCommentDialog()
    } else if (e.altKey && !isMod && e.key === 'ArrowUp') {
      // Alt+Up: Move line up
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const currentLine = $from.before($from.depth)
        if (currentLine > 1) {
          // Get the previous line's position
          const prevLineStart = editor.state.doc.resolve(currentLine - 1).before($from.depth)
          const currentLineEnd = $from.after($from.depth)
          const currentLineContent = editor.state.doc.textBetween($from.start(), $from.end(), '\n')
          const prevLineContent = editor.state.doc.textBetween(
            editor.state.doc.resolve(currentLine - 1).start(),
            editor.state.doc.resolve(currentLine - 1).end(),
            '\n'
          )
          // Swap the lines
          editor.chain()
            .setTextSelection({ from: prevLineStart, to: currentLineEnd })
            .insertContent(currentLineContent + '\n' + prevLineContent)
            .setTextSelection({ from: prevLineStart, to: prevLineStart + currentLineContent.length })
            .run()
        }
      }
    } else if (e.altKey && !isMod && e.key === 'ArrowDown') {
      // Alt+Down: Move line down
      e.preventDefault()
      if (editor) {
        const { $from } = editor.state.selection
        const currentLineEnd = $from.after($from.depth)
        const docSize = editor.state.doc.content.size
        if (currentLineEnd < docSize - 1) {
          // Get the next line's position
          const nextLineEnd = editor.state.doc.resolve(currentLineEnd + 1).after($from.depth)
          const currentLineStart = $from.before($from.depth)
          const currentLineContent = editor.state.doc.textBetween($from.start(), $from.end(), '\n')
          const nextLineContent = editor.state.doc.textBetween(
            editor.state.doc.resolve(currentLineEnd + 1).start(),
            editor.state.doc.resolve(currentLineEnd + 1).end(),
            '\n'
          )
          // Swap the lines
          editor.chain()
            .setTextSelection({ from: currentLineStart, to: nextLineEnd })
            .insertContent(nextLineContent + '\n' + currentLineContent)
            .setTextSelection({
              from: currentLineStart + nextLineContent.length + 1,
              to: currentLineStart + nextLineContent.length + 1 + currentLineContent.length
            })
            .run()
        }
      }
    }
  }, [openFile, saveFile, setDialogOpen, setShortcutsDialogOpen, setModelPickerOpen, editor, setContext, setChatOpen, setFileListOpen, toggleChat, toggleFileList, isChatOpen, isFileListOpen, isFindOpen, openAddCommentDialog, openLinkPopover, cycleToolMode, toggleAnnotationsVisible])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Listen for menu:find event from main process (via App.tsx)
  useEffect(() => {
    const handleMenuFind = () => setIsFindOpen(true)
    window.addEventListener('menu:find', handleMenuFind)
    return () => window.removeEventListener('menu:find', handleMenuFind)
  }, [])

  // Listen for menu:addComment event from main process (via App.tsx)
  useEffect(() => {
    const handleMenuAddComment = () => openAddCommentDialog()
    window.addEventListener('menu:addComment', handleMenuAddComment)
    return () => window.removeEventListener('menu:addComment', handleMenuAddComment)
  }, [openAddCommentDialog])

  // Listen for menu:insertTable (#1060). Inserted with a header row, the only
  // shape tiptap-markdown serializes as a pipe table.
  useEffect(() => {
    const handleMenuInsertTable = () => {
      if (!editor || !editor.isEditable || useEditorStore.getState().sourceMode) return
      insertTable(editor)
    }
    window.addEventListener('menu:insertTable', handleMenuInsertTable)
    return () => window.removeEventListener('menu:insertTable', handleMenuInsertTable)
  }, [editor])

  // Listen for search:show event from tools (e.g., search_document)
  useEffect(() => {
    const handleSearchShow = () => setIsFindOpen(true)
    window.addEventListener('search:show', handleSearchShow)
    return () => window.removeEventListener('search:show', handleSearchShow)
  }, [])


  // Show empty state when document is empty, untitled, and user hasn't started editing
  const showEmptyState = !isEditing && !document.path && !document.content && !document.isDirty

  const pendingFrontmatter = useEditorStore((state) => state.pendingFrontmatter)

  // Check if document has frontmatter to display — uses stableFrontmatter so the
  // visibility decision doesn't flip during body edits. Also shows when there is a
  // pending AI suggestion even if the document has no existing frontmatter. On
  // editable docs without frontmatter, mount the FrontmatterEditor anyway so it
  // can render the "+ Add frontmatter" affordance (suppress for empty state,
  // read-only modes, and preview tabs).
  const showFrontmatter = useMemo(() => {
    if (pendingFrontmatter !== null) return true
    if (stableFrontmatter && Object.keys(stableFrontmatter).length > 0) return true
    if (hasFrontmatter(document.content)) return true
    if (!showEmptyState && !isRemarkableReadOnly && !isPreviewTab) return true
    return false
  }, [document.content, stableFrontmatter, pendingFrontmatter, showEmptyState, isRemarkableReadOnly, isPreviewTab])

  // Focus editor when transitioning from empty state to editing
  // (skip during preview tab navigation — editor is non-editable)
  useEffect(() => {
    if (!showEmptyState && editor && !isPreviewTab) {
      // Small delay to ensure editor is mounted and ready
      requestAnimationFrame(() => {
        editor.commands.focus()
      })
    }
  }, [showEmptyState, editor, isPreviewTab])

  // Source mode onChange handler: the store and the tab follow the text; the
  // session's state waits for the exit (#1102).
  const handleSourceChange = useCallback((newContent: string) => {
    latestSourceRef.current = newContent
    setSourceContent(newContent)
    updateFromSource(newContent)
  }, [])

  // Frontmatter editor save handler: the store's object is the truth from
  // here; the session drops the raw block from the projected content.
  const handleFrontmatterSave = useCallback((newFrontmatter: Record<string, unknown>) => {
    setActiveFrontmatter(newFrontmatter)
    setStableFrontmatter(newFrontmatter)
  }, [])

  const handleConfirmPasteAI = useCallback(() => {
    if (!pendingPasteAnnotation) return

    const activeDocumentId = useEditorStore.getState().document.documentId
    const activeEditor = useEditorInstanceStore.getState().editor
    if (activeDocumentId !== pendingPasteAnnotation.documentId || !activeEditor) {
      setPendingPasteAnnotation(null)
      return
    }

    const annotationTo = Math.min(
      pendingPasteAnnotation.to,
      activeEditor.state.doc.content.size
    )
    if (annotationTo > pendingPasteAnnotation.from) {
      const messageId = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      activeEditor.commands.addAIAnnotations([
        {
          type: 'insertion',
          from: pendingPasteAnnotation.from,
          to: annotationTo,
          content: pendingPasteAnnotation.text,
          provenance: { model: 'External AI', conversationId: 'paste', messageId },
          explanation: 'Marked pasted text as AI-authored',
        },
      ])
    }

    setPendingPasteAnnotation(null)
    // Restore cursor to the end of the pasted range so the user can keep typing.
    focusEditorAtPasteEnd(annotationTo)
  }, [pendingPasteAnnotation])

  // Sets the session-level suppression flag and closes the dialog, so the AI-paste
  // prompt will not appear again until the app/window is restarted.
  const handleDismissThisSession = useCallback(() => {
    const toPos = pendingPasteAnnotation?.to ?? null
    pasteAnnotationDismissedThisSession = true
    setPendingPasteAnnotation(null)
    if (toPos !== null) {
      focusEditorAtPasteEnd(toPos)
    }
  }, [pendingPasteAnnotation])

  return (
    <div className="h-full flex flex-col relative">
      {/* Hide FindBar in source mode — CodeMirror has built-in Ctrl+F */}
      {!sourceMode && (
        <FindBar
          editor={editor}
          isOpen={isFindOpen}
          onClose={() => setIsFindOpen(false)}
        />
      )}
      {/* Share status ◎ (#769) — pinned to the document surface when the doc
          is published. FindBar owns this corner while open (D8). */}
      {webPlatformEnabled && shareEntry && !isFindOpen && !showEmptyState && (
        <div className="absolute right-3 top-2 z-10 flex flex-col items-end gap-2.5">
          <ShareStatusIcon />
          {sharePopoverOpen && <ShareStatusPopover />}
        </div>
      )}
      {showEmptyState ? (
        <EmptyState />
      ) : sourceMode ? (
        <div className="flex-1 overflow-auto px-12 py-6"
          style={{
            fontSize: `${settings.editor.fontSize}px`,
            lineHeight: settings.editor.lineHeight,
            fontFamily: settings.editor.fontFamily
          }}
        >
          <div className="max-w-3xl mx-auto">
            <SourceEditor
              ref={sourceEditorRef}
              content={sourceContent}
              onChange={handleSourceChange}
              fontSize={settings.editor.fontSize}
              lineHeight={settings.editor.lineHeight}
              fontFamily={settings.editor.fontFamily}
              isDark={effectiveTheme === 'dark'}
              readOnly={isRemarkableReadOnly || isPreviewTab}
            />
          </div>
        </div>
      ) : (
        <div
          className="flex-1 overflow-auto px-12 py-6"
          style={{
            fontSize: `${settings.editor.fontSize}px`,
            lineHeight: settings.editor.lineHeight,
            fontFamily: settings.editor.fontFamily
          }}
        >
          {/* reMarkable read-only indicator */}
          {isRemarkableReadOnly && !isTransforming && (
            <div className="max-w-3xl mx-auto mb-4 px-4 py-2 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground flex items-center justify-between">
              <span>Viewing reMarkable OCR (read-only)</span>
              <button
                className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={async () => {
                  // Start the animation
                  startTransform()

                  // Transform to editable version
                  const { remarkableNotebookId } = useEditorStore.getState()
                  const syncDir = useSettingsStore.getState().settings.remarkable?.syncDirectory
                  if (remarkableNotebookId && syncDir && window.api) {
                    const editablePath = await window.api.remarkableCreateEditableVersion(remarkableNotebookId, syncDir)
                    if (editablePath) {
                      // Switch to File Explorer mode - notebooks panel is for reading cloud state,
                      // File Explorer is for editing
                      const { setViewMode, setRootPath, selectFile } = useFileListStore.getState()
                      setViewMode('folder')
                      setRootPath(syncDir)
                      selectFile(editablePath)

                      // Open the editable copy in this tab. Read-only state is
                      // derived from the path, so the editable copy is editable.
                      const activeTabId = useTabStore.getState().activeTabId
                      if (activeTabId) {
                        await openInTab(activeTabId, editablePath)
                        // Set linkedNotebookId immediately to prevent CLS from async lookup
                        setLinkedNotebookId(remarkableNotebookId)
                      }
                    }
                  }
                }}
              >
                Edit
              </button>
            </div>
          )}
          {/* reMarkable editable indicator - show when editing a file linked to a notebook */}
          {!isRemarkableReadOnly && linkedNotebookId && !isTransforming && (
            <div className="max-w-3xl mx-auto mb-4 px-4 py-2 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground flex items-center justify-between">
              <span>Editing reMarkable notebook</span>
              <button
                className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                onClick={async () => {
                  // Start the animation
                  startTransform()

                  // Clear linkedNotebookId immediately to prevent CLS
                  const notebookIdToUse = linkedNotebookId
                  setLinkedNotebookId(null)

                  // Switch back to viewing OCR in Notebooks panel
                  const syncDir = useSettingsStore.getState().settings.remarkable?.syncDirectory
                  if (notebookIdToUse && syncDir && window.api) {
                    const ocrPath = await window.api.remarkableGetOCRPath(notebookIdToUse, syncDir)
                    if (ocrPath) {
                      // Switch to Notebooks panel
                      const { setViewMode, selectFile } = useFileListStore.getState()
                      setViewMode('notebooks')
                      selectFile(ocrPath)

                      // Open the OCR file in this tab; the hidden `.remarkable/`
                      // path makes it read-only.
                      const activeTabId = useTabStore.getState().activeTabId
                      if (activeTabId) await openInTab(activeTabId, ocrPath)
                    }
                  }
                }}
              >
                View Original
              </button>
            </div>
          )}
          <TransformAnimation isTransforming={isTransforming} onComplete={completeTransform}>
            <div className={`max-w-3xl mx-auto prose-editor ${isRemarkableReadOnly && !isTransforming ? 'opacity-80 select-none' : ''} ${!annotationsVisible ? 'hide-annotations' : ''}`}>
              {showFrontmatter && (
                isRemarkableReadOnly || isPreviewTab
                  ? <FrontmatterDisplay content={document.content} frontmatter={document.frontmatter} />
                  : <FrontmatterEditor key={document.documentId} frontmatter={stableFrontmatter} onSave={handleFrontmatterSave} />
              )}
              <EditorContent
                editor={editor}
                className="min-h-full"
              />
            </div>
          </TransformAnimation>
        </div>
      )}
      {!sourceMode && (
        <SelectionPopover
          editor={editor}
          onAddComment={openAddCommentDialog}
          onToggleLink={openLinkPopover}
        />
      )}
      {/* Table rails/grips. Hidden in source mode with the rest of the rich-text
          affordances, and the component itself bails when the editor is not
          editable (reMarkable OCR view, preview tabs). */}
      {!sourceMode && <TableControls editor={editor} />}
      <AddCommentDialog
        editor={editor}
        isOpen={isAddCommentOpen}
        selection={pendingCommentSelection}
        onClose={() => {
          setIsAddCommentOpen(false)
          setPendingCommentSelection(null)
        }}
      />
      <Dialog
        open={pendingPasteAnnotation !== null}
        onOpenChange={(open) => {
          if (!open) {
            // Handles Escape key and clicking the overlay — button-click paths
            // call setPendingPasteAnnotation(null) themselves and restore focus there.
            const toPos = pendingPasteAnnotation?.to ?? null
            setPendingPasteAnnotation(null)
            if (toPos !== null) {
              focusEditorAtPasteEnd(toPos)
            }
          }
        }}
      >
        <DialogContent
          className="sm:max-w-xl"
          onOpenAutoFocus={(e) => {
            // Radix focuses the first button ("Dismiss this Session") on open,
            // and after a keyboard paste that paints it with the focus-visible
            // ring — the least important action reads as selected. Focus the
            // dialog itself instead; Tab still reaches the buttons and Escape
            // still closes.
            e.preventDefault()
            ;(e.target as HTMLElement | null)?.focus()
          }}
          onCloseAutoFocus={(e) => {
            // Radix restores focus to the pre-open element AFTER close, which
            // runs later than our handlers' editor.focus() calls and strands
            // the caret outside the editor. Take over: the handlers have
            // already placed the selection; just re-enter the editor here.
            e.preventDefault()
            useEditorInstanceStore.getState().editor?.commands.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Mark pasted text as AI-authored?</DialogTitle>
            <DialogDescription>
              Save provenance for this pasted block in the document activity.
            </DialogDescription>
          </DialogHeader>
          {/* Three buttons in a mono font outgrow the default footer row —
              keep the dismiss action left, the decision pair right, and let
              the pair wrap to its own right-aligned row when space is tight. */}
          <DialogFooter className="sm:flex-wrap sm:gap-2 sm:space-x-0">
            <Button
              variant="ghost"
              onClick={handleDismissThisSession}
            >
              Dismiss this Session
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => {
                  const toPos = pendingPasteAnnotation?.to ?? null
                  setPendingPasteAnnotation(null)
                  if (toPos !== null) {
                    focusEditorAtPasteEnd(toPos)
                  }
                }}
              >
                Not now
              </Button>
              <Button onClick={handleConfirmPasteAI}>
                Mark as AI-authored
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editor && <AISuggestionPopover editor={editor} />}
      {editor && <CommentPopover editor={editor} />}
      {editor && (
        <LinkPopover
          editor={editor}
          isOpen={linkPopover.isOpen}
          onClose={() => setLinkPopover(prev => ({ ...prev, isOpen: false }))}
          position={linkPopover.position}
          initialUrl={linkPopover.initialUrl}
        />
      )}
    </div>
  )
}
