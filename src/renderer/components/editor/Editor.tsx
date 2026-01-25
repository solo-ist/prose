import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { FocusMode } from '../../lib/focusMode'
import { DiffSuggestion } from '../../extensions/diff-suggestions'
import { Comment } from '../../extensions/comments'
import { AISuggestion } from '../../extensions/ai-suggestions'
import { AIAnnotations, useAnnotationStore } from '../../extensions/ai-annotations'
import { NodeIds } from '../../extensions/node-ids'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useFileListStore } from '../../stores/fileListStore'
import { FindBar } from './FindBar'
import { SelectionPopover } from './SelectionPopover'
import { AddCommentDialog } from './AddCommentDialog'
import { EmptyState } from '../layout/EmptyState'
import { FrontmatterDisplay, hasFrontmatter, getContentWithoutFrontmatter, getFrontmatterRaw } from './FrontmatterDisplay'
import { TransformAnimation, useTransformAnimation } from './TransformAnimation'
import { AISuggestionPopover } from '../AISuggestionPopover'

export function Editor() {
  const { document, setContent, openFile, saveFile } = useEditor()
  const isEditing = useEditorStore((state) => state.isEditing)
  const isRemarkableReadOnly = useEditorStore((state) => state.isRemarkableReadOnly)
  const { settings, setDialogOpen, setShortcutsDialogOpen } = useSettings()
  const { setContext, togglePanel, setPanelOpen, agentMode, setAgentMode, includeDocument, setIncludeDocument } = useChat()
  const setEditorInstance = useEditorInstanceStore((state) => state.setEditor)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUpdatingFromStore = useRef(false)
  const frontmatterRef = useRef<string>('')
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [isAddCommentOpen, setIsAddCommentOpen] = useState(false)
  const [pendingCommentSelection, setPendingCommentSelection] = useState<{
    from: number
    to: number
    text: string
  } | null>(null)
  const { isTransforming, startTransform, completeTransform } = useTransformAnimation()

  // Track if current file is linked to a reMarkable notebook (for showing "View Original" button)
  const [linkedNotebookId, setLinkedNotebookId] = useState<string | null>(null)

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
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      }),
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
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full'
      }
    },
    onUpdate: ({ editor }) => {
      if (isUpdatingFromStore.current) return

      // Debounce content updates to store
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        const markdown = editor.storage.markdown.getMarkdown()
        // Prepend frontmatter if present
        const fullContent = frontmatterRef.current + markdown
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

  // Sync content from store to editor when document changes externally
  useEffect(() => {
    if (!editor) return

    // Extract frontmatter and body from the new content
    const newFrontmatter = getFrontmatterRaw(document.content)
    const newBody = getContentWithoutFrontmatter(document.content)

    // Get current editor content (without frontmatter since we strip it)
    const currentMarkdown = editor.storage.markdown?.getMarkdown() || ''

    // Check if body content differs (comparing without frontmatter)
    if (newBody !== currentMarkdown) {
      isUpdatingFromStore.current = true
      frontmatterRef.current = newFrontmatter
      editor.commands.setContent(newBody)
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
  }, [editor, document.content])

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

  // Update editor editability when reMarkable read-only mode changes
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isRemarkableReadOnly)
  }, [editor, isRemarkableReadOnly])

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

  // Load annotations when document changes and force decoration refresh
  useEffect(() => {
    const annotationStore = useAnnotationStore.getState()
    if (document.documentId) {
      annotationStore.setDocumentId(document.documentId)
      annotationStore.loadAnnotations(document.documentId).then(() => {
        // Force the editor to rebuild decorations after annotations load
        if (editor) {
          // Dispatch an empty transaction to trigger decoration rebuild
          editor.view.dispatch(editor.state.tr)
        }
      })
    }
  }, [document.documentId, editor])

  // Auto-focus editor once when document loads (not on every content change)
  const hasFocusedRef = useRef(false)
  useEffect(() => {
    // Reset focus tracking when document changes
    hasFocusedRef.current = false
  }, [document.documentId])

  useEffect(() => {
    // Only focus once per document load
    if (hasFocusedRef.current) return

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

    if (isMod && e.key === 'o' && !e.shiftKey) {
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
            setPanelOpen(true)
          }
        }
      }
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'c') {
      // Cmd+Shift+C: Add comment to selection
      e.preventDefault()
      openAddCommentDialog()
    } else if (isMod && e.shiftKey && e.key.toLowerCase() === 'l') {
      // Cmd+Shift+L: Toggle chat panel
      e.preventDefault()
      togglePanel()
    } else if (e.key === 'Escape') {
      // Escape: Close find bar or chat panel
      if (isFindOpen) {
        setIsFindOpen(false)
      } else {
        setPanelOpen(false)
      }
    } else if (isMod && e.key === 'f' && !e.shiftKey) {
      // Cmd+F: Open find bar
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
      // Cmd+K: Toggle full context
      e.preventDefault()
      setIncludeDocument(!includeDocument)
    }
  }, [openFile, saveFile, setDialogOpen, setShortcutsDialogOpen, editor, setContext, setPanelOpen, togglePanel, isFindOpen, openAddCommentDialog, agentMode, setAgentMode, includeDocument, setIncludeDocument])

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

  // Show empty state when document is empty, untitled, and user hasn't started editing
  const showEmptyState = !isEditing && !document.path && !document.content && !document.isDirty

  // Check if document has frontmatter to display
  const showFrontmatter = useMemo(() => hasFrontmatter(document.content), [document.content])

  // Focus editor when transitioning from empty state to editing
  useEffect(() => {
    if (!showEmptyState && editor) {
      // Small delay to ensure editor is mounted and ready
      requestAnimationFrame(() => {
        editor.commands.focus()
      })
    }
  }, [showEmptyState, editor])

  return (
    <div className="h-full flex flex-col relative">
      <FindBar
        editor={editor}
        isOpen={isFindOpen}
        onClose={() => setIsFindOpen(false)}
      />
      {showEmptyState ? (
        <EmptyState />
      ) : (
        <div
          className="flex-1 overflow-auto px-8 py-6"
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
            <div className={`max-w-3xl prose-editor ${isRemarkableReadOnly && !isTransforming ? 'opacity-80 select-none' : ''}`}>
              {showFrontmatter && (
                <FrontmatterDisplay content={document.content} />
              )}
              <EditorContent
                editor={editor}
                className="min-h-full"
              />
            </div>
          </TransformAnimation>
        </div>
      )}
      <SelectionPopover
        editor={editor}
        onAddComment={openAddCommentDialog}
      />
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
    </div>
  )
}
