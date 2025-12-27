import { useEffect, useRef, useCallback, useState } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { FocusMode } from '../../lib/focusMode'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'
import { FindBar } from './FindBar'

export function Editor() {
  const { document, setContent, openFile, saveFile } = useEditor()
  const { settings, setDialogOpen, setShortcutsDialogOpen } = useSettings()
  const { setContext, togglePanel, setPanelOpen } = useChat()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUpdatingFromStore = useRef(false)
  const [isFindOpen, setIsFindOpen] = useState(false)

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
      FocusMode
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
    } else if (isMod && e.shiftKey && e.key === 'k') {
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
    } else if (isMod && e.shiftKey && e.key === 'l') {
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
    } else if (isMod && e.shiftKey && e.key === '?') {
      // Cmd+?: Show keyboard shortcuts
      e.preventDefault()
      setShortcutsDialogOpen(true)
    }
  }, [openFile, saveFile, setDialogOpen, setShortcutsDialogOpen, editor, setContext, setPanelOpen, togglePanel, isFindOpen])

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

  return (
    <div className="h-full flex flex-col relative">
      <FindBar
        editor={editor}
        isOpen={isFindOpen}
        onClose={() => setIsFindOpen(false)}
      />
      <div
        className="flex-1 overflow-auto p-8 md:p-12 lg:p-16"
        style={{
          fontSize: `${settings.editor.fontSize}px`,
          lineHeight: settings.editor.lineHeight,
          fontFamily: settings.editor.fontFamily
        }}
      >
        <div className="max-w-3xl mx-auto prose-editor">
          <EditorContent
            editor={editor}
            className="min-h-full"
          />
        </div>
      </div>
    </div>
  )
}
