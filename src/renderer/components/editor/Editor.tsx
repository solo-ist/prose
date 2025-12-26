import { useEffect, useRef, useCallback } from 'react'
import { useEditor as useTipTapEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { FocusMode } from '../../lib/focusMode'
import { useEditor } from '../../hooks/useEditor'
import { useSettings } from '../../hooks/useSettings'
import { useChat } from '../../hooks/useChat'

export function Editor() {
  const { document, setContent, openFile, saveFile } = useEditor()
  const { settings, setDialogOpen } = useSettings()
  const { setContext, togglePanel, setPanelOpen } = useChat()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUpdatingFromStore = useRef(false)

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
    }
  }, [openFile, saveFile, setDialogOpen, editor, setContext, setPanelOpen, togglePanel])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="h-full flex flex-col">
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
