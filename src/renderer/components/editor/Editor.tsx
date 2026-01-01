import { useEffect, useRef, useCallback, useState } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { FocusMode } from '../../lib/focusMode'
import { DiffSuggestion } from '../../extensions/diff-suggestions'
import { Comment } from '../../extensions/comments'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useEditorStore } from '../../stores/editorStore'
import { FindBar } from './FindBar'
import { SelectionPopover } from './SelectionPopover'
import { AddCommentDialog } from './AddCommentDialog'
import { EmptyState } from '../layout/EmptyState'

export function Editor() {
  const { document, setContent, openFile, saveFile } = useEditor()
  const isEditing = useEditorStore((state) => state.isEditing)
  const { settings, setDialogOpen, setShortcutsDialogOpen } = useSettings()
  const { setContext, togglePanel, setPanelOpen, agentMode, setAgentMode, includeDocument, setIncludeDocument } = useChat()
  const setEditorInstance = useEditorInstanceStore((state) => state.setEditor)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUpdatingFromStore = useRef(false)
  const [isFindOpen, setIsFindOpen] = useState(false)
  const [isAddCommentOpen, setIsAddCommentOpen] = useState(false)
  const [pendingCommentSelection, setPendingCommentSelection] = useState<{
    from: number
    to: number
    text: string
  } | null>(null)

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
    ],
    content: document.content,
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
        setContent(markdown)
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

    const currentMarkdown = editor.storage.markdown?.getMarkdown() || ''
    if (document.content !== currentMarkdown) {
      isUpdatingFromStore.current = true
      editor.commands.setContent(document.content)
      isUpdatingFromStore.current = false
    }
  }, [editor, document.content])

  // Register editor instance in store for cross-component access
  useEffect(() => {
    setEditorInstance(editor)
    return () => setEditorInstance(null)
  }, [editor, setEditorInstance])

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
          <div className="max-w-3xl prose-editor">
            <EditorContent
              editor={editor}
              className="min-h-full"
            />
          </div>
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
    </div>
  )
}
