import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import { EditorState } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import { FocusMode } from '../../lib/focusMode'
import { DiffSuggestion } from '../../extensions/diff-suggestions'
import { Comment } from '../../extensions/comments'
import { AISuggestion } from '../../extensions/ai-suggestions'
import { useSuggestionStore } from '../../extensions/ai-suggestions/store'
import { SESSION_ID } from '../../lib/persistence'
import { AIAnnotations, useAnnotationStore } from '../../extensions/ai-annotations'
import { NodeIds } from '../../extensions/node-ids'
import { SearchHighlight } from '../../extensions/search-highlight'
import { LinkHover } from '../../extensions/link-hover'
import { PlainTextMode } from '../../extensions/plain-text-mode'
import { ImageWithUpload } from '../../extensions/image'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { usePanelLayoutContext } from '../../hooks/usePanelLayout'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useFileListStore } from '../../stores/fileListStore'
import { useTabStore } from '../../stores/tabStore'
import { promoteCurrentPreview } from '../../hooks/useTabs'
import { FindBar } from './FindBar'
import { SelectionPopover } from './SelectionPopover'
import { AddCommentDialog } from './AddCommentDialog'
import { EmptyState } from '../layout/EmptyState'
import { FrontmatterDisplay, hasFrontmatter, getContentWithoutFrontmatter, getFrontmatterRaw } from './FrontmatterDisplay'
import { FrontmatterEditor, serializeFrontmatter } from './FrontmatterEditor'
import { serializeMarkdown, parseMarkdown } from '../../lib/markdown'
import { TransformAnimation, useTransformAnimation } from './TransformAnimation'
import { AISuggestionPopover } from '../AISuggestionPopover'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import type { AISuggestionData } from '../../extensions/ai-suggestions/types'
import { LinkPopover } from './LinkPopover'
import { SourceEditor, SourceEditorHandle } from './SourceEditor'

export function Editor() {
  const { document, setContent, openFile, saveFile } = useEditor()
  const isEditing = useEditorStore((state) => state.isEditing)
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const isPreviewTab = useEditorStore((state) => state.isPreviewTab)
  const annotationsVisible = useEditorStore((state) => state.annotationsVisible)
  const toggleAnnotationsVisible = useEditorStore((state) => state.toggleAnnotationsVisible)
  const sourceMode = useEditorStore((state) => state.sourceMode)
  const setSourceMode = useEditorStore((state) => state.setSourceMode)
  const { settings, setDialogOpen, setShortcutsDialogOpen, setModelPickerOpen } = useSettings()
  const { setContext, agentMode, setAgentMode } = useChat()
  const { isChatOpen, isFileListOpen, toggleChat, toggleFileList, setChatOpen, setFileListOpen } = usePanelLayoutContext()
  const setEditorInstance = useEditorInstanceStore((state) => state.setEditor)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUpdatingFromStore = useRef(false)
  const frontmatterRef = useRef<string>('')
  const lastDocumentIdRef = useRef<string>(document.documentId)
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [isAddCommentOpen, setIsAddCommentOpen] = useState(false)
  const [pendingCommentSelection, setPendingCommentSelection] = useState<{
    from: number
    to: number
    text: string
  } | null>(null)
  const { isTransforming, startTransform, completeTransform } = useTransformAnimation()

  // Source mode: holds markdown content while CodeMirror is mounted
  const [sourceContent, setSourceContent] = useState<string>('')
  // Preserve AI suggestions across source mode round-trips
  const savedSuggestionsRef = useRef<AISuggestionData[]>([])
  const sourceEditorRef = useRef<SourceEditorHandle>(null)

  // Track if current file is linked to a reMarkable notebook (for showing "View Original" button)
  const [linkedNotebookId, setLinkedNotebookId] = useState<string | null>(null)

  // Link popover state
  const [linkPopover, setLinkPopover] = useState<{
    isOpen: boolean
    position: { top: number; left: number }
    initialUrl?: string
  }>({ isOpen: false, position: { top: 0, left: 0 } })

  // Extract and store frontmatter on initial load
  const initialContent = useMemo(() => {
    frontmatterRef.current = getFrontmatterRaw(document.content)
    return getContentWithoutFrontmatter(document.content)
  }, []) // Only run once on mount

  const editor = useTipTapEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
        }
      }),
      Placeholder.configure({
        placeholder: 'Start writing...'
      }),
      Link.configure({
        openOnClick: false, // We handle CMD+Click in LinkHover extension
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      }),
      Underline,
      Table.configure({
        resizable: false,
        HTMLAttributes: {
          class: 'prose-table'
        }
      }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: '-',
        transformPastedText: true,
        transformCopiedText: true
      }),
      FocusMode,
      DiffSuggestion.configure({
        className: 'diff-suggestion',
        showButtons: true,
        buttons: {
          accept: '✓',
          reject: '✗',
        },
      }),
      Comment,
      AISuggestion,
      AIAnnotations.configure({
        showTooltip: true,
      }),
      NodeIds,
      SearchHighlight,
      LinkHover,
      PlainTextMode,
      ImageWithUpload.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: 'editor-image'
        }
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full'
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
    // Note: No onCreate needed - editor is created with initial content,
    // so history naturally starts from that state
    onUpdate: ({ editor }) => {
      if (isUpdatingFromStore.current) return

      console.log('[Editor:onUpdate] Content changed, scheduling save')

      // Capture the current document ID so we can discard the update if the
      // user switches tabs before the debounce fires (prevents cross-tab dirty state)
      const capturedDocumentId = useEditorStore.getState().document.documentId

      // Debounce content updates to store
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        // If the active document changed since this was scheduled (tab switch),
        // discard the update to avoid marking the wrong tab as dirty
        if (useEditorStore.getState().document.documentId !== capturedDocumentId) {
          console.log('[Editor:onUpdate] Document changed, discarding stale content update')
          return
        }

        const markdown = editor.storage.markdown.getMarkdown()
        // Prepend frontmatter if present
        const fullContent = frontmatterRef.current + markdown
        console.log('[Editor:onUpdate] Saving content to store:', {
          length: fullContent.length,
          preview: fullContent.substring(0, 100).replace(/\n/g, '\\n'),
          hasTable: fullContent.includes('|')
        })
        setContent(fullContent)
      }, 500)
    }
  })

  // Helper to open comment dialog with current selection
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

  // Sync content from store to editor when document changes externally
  useEffect(() => {
    if (!editor) return

    // Extract frontmatter and body from the new content
    const newFrontmatter = getFrontmatterRaw(document.content)
    const newBody = getContentWithoutFrontmatter(document.content)

    // Get current editor content (without frontmatter since we strip it)
    const currentMarkdown = editor.storage.markdown?.getMarkdown() || ''

    // Check if this is a new document (different documentId)
    const isNewDocument = lastDocumentIdRef.current !== document.documentId
    if (isNewDocument) {
      lastDocumentIdRef.current = document.documentId
    }

    // Check if body content differs (comparing without frontmatter)
    if (newBody !== currentMarkdown) {
      isUpdatingFromStore.current = true
      frontmatterRef.current = newFrontmatter

      // Sync plain text mode BEFORE setContent so appendTransaction
      // doesn't flatten markdown content on tab switches
      const isPlainText = !!document.path?.endsWith('.txt')
      editor.storage.plainTextMode.enabled = isPlainText

      // If source mode is active, sync content directly to the source editor
      // (the TipTap editor is hidden, so we update sourceContent too)
      if (useEditorStore.getState().sourceMode) {
        setSourceContent(newBody)
      }

      if (isNewDocument) {
        // Create a fresh EditorState when loading a new document.
        // This resets the undo history so users can't undo past the initial document state.
        // Note: TipTap's clearHistory() doesn't exist - ProseMirror requires recreating the state.

        // First, set the content to let tiptap-markdown parse it
        editor.commands.setContent(newBody)

        // Now create a fresh state with the parsed document (this clears history)
        const newState = EditorState.create({
          doc: editor.state.doc,
          plugins: editor.state.plugins,
          schema: editor.state.schema,
        })
        editor.view.updateState(newState)
      } else {
        // Normal content update - preserve history so user can undo their edits
        editor.commands.setContent(newBody)
      }

      isUpdatingFromStore.current = false

      // Scroll to top when new content is loaded
      const editorContainer = editor.view.dom.closest('.overflow-auto')
      if (editorContainer) {
        editorContainer.scrollTop = 0
      }
    } else if (newFrontmatter !== frontmatterRef.current) {
      // Just update frontmatter ref if only frontmatter changed
      frontmatterRef.current = newFrontmatter
    }
  }, [editor, document.content, document.documentId])

  // Register editor instance in store for cross-component access
  useEffect(() => {
    setEditorInstance(editor)
    return () => setEditorInstance(null)
  }, [editor, setEditorInstance])

  // Cache selection on selectionUpdate for read_selection fallback
  // This preserves the selection when chat input steals focus
  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      const { from, to, empty } = editor.state.selection
      if (!empty) {
        const text = editor.state.doc.textBetween(from, to)
        useEditorStore.getState().setLastSelection({ text, from, to })
      }
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  // Update editor editability when read-only mode changes (reMarkable or preview tab)
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isRemarkableReadOnly && !isPreviewTab)
  }, [editor, isRemarkableReadOnly, isPreviewTab])

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

  // Subscribe to annotations reactively for restoration
  const annotations = useAnnotationStore((state) => state.annotations)
  const annotationStoreDocumentId = useAnnotationStore((state) => state.documentId)

  // Load and restore annotations when document changes
  useEffect(() => {
    if (!editor || !document.documentId) return

    const annotationStore = useAnnotationStore.getState()

    // Set document ID and load annotations if needed
    if (annotationStoreDocumentId !== document.documentId) {
      annotationStore.setDocumentId(document.documentId)
      annotationStore.loadAnnotations(document.documentId)
    }

    // Force decoration rebuild when annotations change
    // Small delay to ensure editor content is fully loaded
    if (annotations.length > 0 && annotationStoreDocumentId === document.documentId) {
      console.log(`[Editor:${SESSION_ID}] Restoring annotations:`, {
        documentId: document.documentId,
        count: annotations.length
      })
      const timer = setTimeout(() => {
        editor.view.dispatch(editor.state.tr)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [editor, document.documentId, annotations, annotationStoreDocumentId])

  // Subscribe to pending suggestions reactively for restoration
  const pendingSuggestions = useSuggestionStore((state) => state.pendingSuggestions)
  const suggestionStoreDocumentId = useSuggestionStore((state) => state.documentId)

  // Restore AI suggestions when document changes or pending suggestions are loaded
  useEffect(() => {
    if (!editor || !document.documentId) return

    // Only restore if there are pending suggestions and they match current document
    if (pendingSuggestions.length > 0 && suggestionStoreDocumentId === document.documentId) {
      console.log(`[Editor:${SESSION_ID}] Restoring suggestions:`, {
        documentId: document.documentId,
        count: pendingSuggestions.length
      })

      // Small delay to ensure editor content is fully loaded
      const timer = setTimeout(() => {
        editor.commands.restoreAISuggestions(pendingSuggestions)
        // Clear pending suggestions after restoring
        useSuggestionStore.getState().clearSuggestions()
      }, 100)

      return () => clearTimeout(timer)
    }
  }, [editor, document.documentId, pendingSuggestions, suggestionStoreDocumentId])

  // Auto-focus editor once when document loads (not on every content change)
  const hasFocusedRef = useRef(false)
  useEffect(() => {
    // Reset focus tracking when document changes
    hasFocusedRef.current = false
  }, [document.documentId])

  useEffect(() => {
    // Only focus once per document load
    if (hasFocusedRef.current) return
    // Don't steal focus during preview tab navigation
    if (useEditorStore.getState().isPreviewTab) return

    const shouldShowEmptyState = !isEditing && !document.path && !document.content && !document.isDirty
    if (editor && !shouldShowEmptyState) {
      hasFocusedRef.current = true
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        editor.commands.focus('start')
        // Scroll editor container to top
        const editorContainer = editor.view.dom.closest('.overflow-auto')
        if (editorContainer) {
          editorContainer.scrollTop = 0
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [editor, isEditing, document.path, document.content, document.isDirty])

  // Sync content when toggling source mode (layout effect to avoid flash of empty content)
  const prevSourceModeRef = useRef(sourceMode)
  useLayoutEffect(() => {
    if (!editor) return
    const prev = prevSourceModeRef.current
    prevSourceModeRef.current = sourceMode

    if (sourceMode && !prev) {
      // WYSIWYG → Source: save suggestions then serialize with frontmatter
      savedSuggestionsRef.current = getAISuggestions(editor)
      const md = editor.storage.markdown?.getMarkdown?.() ?? ''
      const fm = useEditorStore.getState().document.frontmatter ?? {}
      setSourceContent(serializeMarkdown(md, fm))
    } else if (!sourceMode && prev) {
      // Source → WYSIWYG: parse frontmatter back out from raw source
      const liveContent = sourceEditorRef.current?.getContent() ?? sourceContent
      const { content: bodyOnly, frontmatter: parsedFm } = parseMarkdown(liveContent)
      useEditorStore.getState().setFrontmatter(parsedFm)
      editor.commands.setContent(bodyOnly)
      if (savedSuggestionsRef.current.length > 0) {
        // Small delay to ensure content is fully parsed before restoring marks
        setTimeout(() => {
          editor.commands.restoreAISuggestions(savedSuggestionsRef.current)
          savedSuggestionsRef.current = []
        }, 50)
      }
    }
  }, [sourceMode, editor])

  // Reset source mode when switching documents
  useEffect(() => {
    setSourceMode(false)
  }, [document.documentId, setSourceMode])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

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
      saveFile()
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
        navigator.clipboard.writeText(content)
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
      setIsFindOpen(true)
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
      // Shift+Tab: Toggle agent mode
      e.preventDefault()
      setAgentMode(!agentMode)
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
    } else if (isMod && e.altKey && e.key.toLowerCase() === 't') {
      // Cmd+Option+T: Insert 3x3 table
      e.preventDefault()
      if (editor) {
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'x') {
      // Cmd+Shift+X: Strikethrough
      e.preventDefault()
      if (editor) {
        editor.chain().focus().toggleStrike().run()
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
  }, [openFile, saveFile, setDialogOpen, setShortcutsDialogOpen, setModelPickerOpen, editor, setContext, setChatOpen, setFileListOpen, toggleChat, toggleFileList, isChatOpen, isFileListOpen, isFindOpen, openAddCommentDialog, openLinkPopover, agentMode, setAgentMode, toggleAnnotationsVisible])

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

  // Listen for search:show event from tools (e.g., search_document)
  useEffect(() => {
    const handleSearchShow = () => setIsFindOpen(true)
    window.addEventListener('search:show', handleSearchShow)
    return () => window.removeEventListener('search:show', handleSearchShow)
  }, [])

  // Show empty state when document is empty, untitled, and user hasn't started editing
  const showEmptyState = !isEditing && !document.path && !document.content && !document.isDirty

  // Check if document has frontmatter to display
  const showFrontmatter = useMemo(() => {
    // Check the parsed frontmatter object first (works for files loaded via parseMarkdown)
    if (document.frontmatter && Object.keys(document.frontmatter).length > 0) return true
    // Fall back to checking raw content (for content that still has --- markers)
    return hasFrontmatter(document.content)
  }, [document.content, document.frontmatter])

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

  // Source mode onChange handler: update state + store
  const handleSourceChange = useCallback((newContent: string) => {
    setSourceContent(newContent)
    // Source mode includes frontmatter — parse it out before saving to store
    const { content: body, frontmatter: fm } = parseMarkdown(newContent)
    setContent(body)
    useEditorStore.getState().setDocument({ frontmatter: fm })
  }, [setContent])

  // Frontmatter editor save handler: update store and content
  const setFrontmatter = useEditorStore((state) => state.setFrontmatter)
  const handleFrontmatterSave = useCallback((newFrontmatter: Record<string, unknown>) => {
    if (!editor) return
    setFrontmatter(newFrontmatter)
    // Clear frontmatterRef so onUpdate doesn't re-prepend raw frontmatter.
    // The store's document.frontmatter is the source of truth now;
    // buildSaveContent/serializeMarkdown adds the --- block on save.
    frontmatterRef.current = ''
    // Store body only
    const currentBody = editor.storage.markdown?.getMarkdown() ?? ''
    setContent(currentBody)
  }, [setFrontmatter, setContent, editor])

  const effectiveTheme = settings.theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : settings.theme

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
                  const { remarkableNotebookId, setRemarkableReadOnly } = useEditorStore.getState()
                  const syncDir = useSettingsStore.getState().settings.remarkable?.syncDirectory
                  if (remarkableNotebookId && syncDir && window.api) {
                    const editablePath = await window.api.remarkableCreateEditableVersion(remarkableNotebookId, syncDir)
                    if (editablePath) {
                      // Clear read-only state first
                      setRemarkableReadOnly(false, null)

                      // Switch to File Explorer mode - notebooks panel is for reading cloud state,
                      // File Explorer is for editing
                      const { setViewMode, setRootPath, selectFile } = useFileListStore.getState()
                      setViewMode('folder')
                      setRootPath(syncDir)
                      selectFile(editablePath)

                      // Open the new editable file
                      const content = await window.api.readFile(editablePath)
                      if (content) {
                        const { parseMarkdown } = await import('../../lib/markdown')
                        const { generateIdFromPath } = await import('../../lib/persistence')
                        const parsed = parseMarkdown(content)
                        const newDocumentId = await generateIdFromPath(editablePath)
                        useEditorStore.getState().setDocument({
                          documentId: newDocumentId,
                          path: editablePath,
                          content: parsed.content,
                          frontmatter: parsed.frontmatter,
                          isDirty: false
                        })
                        useEditorStore.getState().setEditing(true)

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

                      // Set read-only mode
                      useEditorStore.getState().setRemarkableReadOnly(true, notebookIdToUse)

                      // Open the OCR file
                      const content = await window.api.readFile(ocrPath)
                      if (content) {
                        const { parseMarkdown } = await import('../../lib/markdown')
                        const { generateIdFromPath } = await import('../../lib/persistence')
                        const parsed = parseMarkdown(content)
                        const newDocumentId = await generateIdFromPath(ocrPath)
                        useEditorStore.getState().setDocument({
                          documentId: newDocumentId,
                          path: ocrPath,
                          content: parsed.content,
                          frontmatter: parsed.frontmatter,
                          isDirty: false
                        })
                      }
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
                  : <FrontmatterEditor key={document.path || 'new'} frontmatter={document.frontmatter ?? {}} onSave={handleFrontmatterSave} />
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
      <AddCommentDialog
        editor={editor}
        isOpen={isAddCommentOpen}
        selection={pendingCommentSelection}
        onClose={() => {
          setIsAddCommentOpen(false)
          setPendingCommentSelection(null)
        }}
      />
      {editor && <AISuggestionPopover editor={editor} />}
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
